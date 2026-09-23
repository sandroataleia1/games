import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { withLock } from "./distributed-lock.js";
import { DomainError } from "@quizarena/database";
import { EVENTS, lobbySchemas } from "@quizarena/contracts";

const DEFAULT_TTL_SECONDS = 60 * 60 * 6;
const RATE_LIMITS = Object.freeze({ enter: [20, 60], resume: [10, 60], command: [60, 60] });
const INDEX_CHANNEL = "rooms:index";
const RECOVERY_LIMIT = 200;

function channel(roomNumber) { return `room:${roomNumber}`; }
function indexChannel(gameKey) { return `${INDEX_CHANNEL}:${gameKey}`; }
function presenceKeyPrefix(roomNumber) { return `quizarena:room:presence:${roomNumber}:`; }
function presenceKey(roomNumber, accountId) { return `${presenceKeyPrefix(roomNumber)}${accountId}`; }
function rateKey(prefix, kind, identity) { return `${prefix}:${kind}:${identity}`; }
function memberKey(roomNumber, accountId) { return `${roomNumber}:${accountId}`; }
function errorMessage(code) {
  return { INVALID_PAYLOAD: "Dados inválidos.", QUIZ_NOT_FOUND: "Quiz não encontrado.", QUIZ_NOT_PUBLISHED: "O quiz não está publicado.", ROOM_NOT_FOUND: "Sala não encontrada.", ROOM_NOT_WAITING: "A sala já está em uma partida.", GAME_UNAVAILABLE: "Este jogo não está disponível no momento.", GAME_UNKNOWN: "Sala não encontrada.", GAME_ADAPTER_MISSING: "Este jogo não está disponível no momento.", RATE_LIMITED: "Muitas tentativas. Aguarde um pouco.", DEPENDENCY_UNAVAILABLE: "O serviço realtime está temporariamente indisponível.", UNAUTHENTICATED: "É necessário entrar com sua conta.", PARTICIPANT_ALREADY_JOINED: "Você já está participando desta sala.", UNAUTHORIZED: "Sua conexão foi reiniciada. Aguarde reconectar e tente de novo.", INVALID_STATE: "A partida mudou de estado. Atualize a página.", NO_PARTICIPANTS: "É preciso pelo menos um participante para iniciar.", NO_QUESTIONS: "Este quiz não tem perguntas.", QUESTION_EXPIRED: "O tempo desta pergunta já acabou.", PARTICIPANT_NOT_ACTIVE: "Você não está ativo nesta sala no momento.", INVALID_ANSWER: "Não foi possível registrar essa resposta.", TRANSACTION_CONFLICT: "Muitas ações ao mesmo tempo. Tente de novo.", PARTICIPANT_INVALID: "Não foi possível identificar você nesta sala.", REFERENCE_CONFLICT: "Este item não existe mais.", COORDINATION_UNAVAILABLE: "O serviço está temporariamente indisponível.", INTERNAL_ERROR: "Não foi possível concluir a operação." }[code] ?? "Não foi possível concluir a operação.";
}
function ackOk(data) { return { ok: true, data }; }
function ackError(code) { return { ok: false, error: { code, message: errorMessage(code) } }; }
function mapError(error) {
  if (error instanceof DomainError) {
    if (error.code === "SESSION_NOT_FOUND") return "ROOM_NOT_FOUND";
    if (error.code === "QUIZ_INVALID") return "QUIZ_NOT_PUBLISHED";
    return error.code;
  }
  return "INTERNAL_ERROR";
}

// The GENERIC realtime host. It owns what every game shares - Redis coordination,
// rooms, entering/leaving, presence, reconnection, authorization, the room index,
// starting a match, distributed locks and recovery - and resolves the game of a
// room by its gameKey through the runtime registry. Everything game-specific
// (its events, timers, projections, recovery) is the game's realtime hook set,
// registered by the composition root. There is no game-specific code and no
// per-game branching here, and deliberately no universal "game command" event.
export function createLobbyRuntime({ io, database, redisUrl, ttlSeconds = DEFAULT_TTL_SECONDS, rateLimitPrefix = "quizarena:lobby:rate", logger = console }) {
  const { platform, runtimes } = database;
  const publisher = createClient({ url: redisUrl, disableOfflineQueue: true });
  const subscriber = publisher.duplicate();
  let ready = false;
  let closingState = false;
  const activeMembers = new Map();
  const boundEvents = new Set();
  let closing;
  // A process serving a single game answers clients that do not say which game
  // they mean (clients older than gameKey) with that game.
  const defaultGameKey = runtimes.keys().length === 1 ? runtimes.keys()[0] : null;

  async function connect() {
    await Promise.all([publisher.connect(), subscriber.connect()]);
    io.adapter(createAdapter(publisher, subscriber));
    ready = true;
    await recoverActiveMatches();
  }
  // Generic recovery: live matches come from PostgreSQL only; each game rebuilds
  // its own pending work. One bad match never stops the others.
  async function recoverActiveMatches() {
    for (const { match, room } of await platform.matches.live({ limit: RECOVERY_LIMIT })) {
      const runtime = runtimes.get(match.gameKey);
      if (!runtime) { logger.error(`[lobby] recovery: no runtime for game of match ${match.id}`); continue; }
      try { await runtime.realtime.recoverMatch({ match, room }); }
      catch (error) { logger.error(`[lobby] recovery of match ${match.id} failed: ${mapError(error)}`); }
    }
  }
  async function ensureReady() {
    if (!ready || !publisher.isReady) throw new DomainError("DEPENDENCY_UNAVAILABLE");
  }
  async function rateLimit(kind, identity) {
    await ensureReady();
    const [limit, ttl] = RATE_LIMITS[kind];
    const key = rateKey(rateLimitPrefix, kind, identity || "unknown");
    const count = await publisher.incr(key);
    if (count === 1) await publisher.expire(key, ttl);
    if (count > limit) throw new DomainError("RATE_LIMITED");
  }
  async function setPresence(roomNumber, accountId, displayName) {
    await publisher.set(presenceKey(roomNumber, accountId), JSON.stringify({ displayName }), { EX: ttlSeconds });
  }
  async function clearPresence(roomNumber, accountId) {
    await publisher.del(presenceKey(roomNumber, accountId));
  }
  async function listPresence(roomNumber) {
    const prefix = presenceKeyPrefix(roomNumber);
    const results = [];
    for await (const batch of publisher.scanIterator({ MATCH: `${prefix}*`, COUNT: 200 })) {
      for (const key of Array.isArray(batch) ? batch : [batch]) {
        const raw = await publisher.get(key);
        if (!raw) continue;
        try { results.push({ accountId: key.slice(prefix.length), ...JSON.parse(raw) }); } catch { /* ignore malformed entry */ }
      }
    }
    return results;
  }
  // The runtime that serves a room, or "room not found": a room of an
  // unregistered game is indistinguishable from a missing one.
  function runtimeFor(room) {
    const runtime = runtimes.get(room.gameKey);
    if (!runtime) throw new DomainError("ROOM_NOT_FOUND");
    return runtime;
  }
  // Public room state: platform fields + the game's own projection.
  async function publicRoomState(roomNumber) {
    const room = await platform.rooms.get(roomNumber);
    const runtime = runtimeFor(room);
    const players = await listPresence(roomNumber);
    const extras = (await runtime.realtime.roomProjection.extras([room])).get(room.number) ?? {};
    return runtime.realtime.roomProjection.schema.parse({ roomNumber: room.number, gameKey: room.gameKey, status: room.status, ...extras, playerCount: players.length, players, serverTime: new Date().toISOString() });
  }
  async function broadcastRoom(roomNumber) {
    const current = await publicRoomState(roomNumber);
    io.to(channel(roomNumber)).emit(EVENTS.ROOM_STATE, current);
    return current;
  }
  // The room index of one game: platform fields + the game's projection. Never
  // carries a room's internal id or the id of its current match.
  async function roomIndex(gameKey) {
    const runtime = runtimes.get(gameKey);
    if (!runtime) return [];
    const rooms = await platform.rooms.list({ gameKey });
    const extras = await runtime.realtime.roomProjection.extras(rooms);
    return Promise.all(rooms.map(async (room) => ({ number: room.number, status: room.status, gameKey: room.gameKey, ...(extras.get(room.number) ?? {}), playerCount: (await listPresence(room.number)).length })));
  }
  async function broadcastIndex(gameKey) {
    const keys = gameKey ? [gameKey] : runtimes.keys();
    for (const key of keys) io.to(indexChannel(key)).emit(EVENTS.ROOM_INDEX, { rooms: await roomIndex(key) });
  }
  function claimMembership(roomNumber, accountId, socket) {
    const key = memberKey(roomNumber, accountId);
    const previous = activeMembers.get(key);
    if (previous && previous !== socket) { previous.data.roomNumber = null; previous.data.player = null; previous.disconnect(true); }
    activeMembers.set(key, socket);
  }

  async function enterRoom(socket, payload) {
    await rateLimit("enter", socket.handshake.address);
    const parsed = lobbySchemas.roomEnter.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    if (!socket.data.organizer) throw new DomainError("UNAUTHENTICATED");
    const account = socket.data.organizer;
    const room = await platform.rooms.get(parsed.data.roomNumber);
    const runtime = runtimeFor(room);
    await socket.join(channel(room.number));
    socket.data.roomNumber = room.number;
    claimMembership(room.number, account.id, socket);
    await setPresence(room.number, account.id, account.name);
    const { match, playing } = await runtime.realtime.onRoomEnter({ socket, room });
    const state = await broadcastRoom(room.number);
    io.to(channel(room.number)).emit(EVENTS.PARTICIPANT_JOINED, { accountId: account.id, displayName: account.name });
    await broadcastIndex(room.gameKey);
    return { room: state, match, playing };
  }
  async function leaveRoomHandler(socket, payload) {
    const parsed = lobbySchemas.roomLeave.safeParse(payload);
    if (!parsed.success || socket.data.roomNumber !== parsed.data.roomNumber) throw new DomainError("INVALID_PAYLOAD");
    const account = socket.data.organizer;
    const roomNumber = socket.data.roomNumber;
    const room = await platform.rooms.get(roomNumber);
    if (account && activeMembers.get(memberKey(roomNumber, account.id)) === socket) activeMembers.delete(memberKey(roomNumber, account.id));
    if (account) await clearPresence(roomNumber, account.id);
    await runtimes.get(room.gameKey)?.realtime.onRoomLeave({ socket, room });
    socket.data.roomNumber = null;
    socket.data.player = null;
    await socket.leave(channel(roomNumber));
    const state = await broadcastRoom(roomNumber);
    if (account) io.to(channel(roomNumber)).emit(EVENTS.PARTICIPANT_LEFT, { accountId: account.id });
    await broadcastIndex(room.gameKey);
    return { room: state };
  }
  async function listRooms(socket, payload) {
    const parsed = lobbySchemas.roomList.safeParse(payload ?? {});
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    if (!socket.data.organizer) throw new DomainError("UNAUTHENTICATED");
    const gameKey = parsed.data.gameKey ?? defaultGameKey;
    if (!gameKey || !runtimes.has(gameKey)) throw new DomainError("INVALID_PAYLOAD");
    await socket.join(indexChannel(gameKey));
    return { rooms: await roomIndex(gameKey) };
  }
  // Generic start: authorization, who is present, the platform's transactional
  // start (which calls the game's persistence hooks), then the game takes over.
  async function matchStart(socket, payload) {
    const parsed = lobbySchemas.matchStart.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    if (!socket.data.organizer) throw new DomainError("UNAUTHENTICATED");
    if (socket.data.roomNumber !== parsed.data.roomNumber) throw new DomainError("UNAUTHORIZED");
    const roomNumber = parsed.data.roomNumber;
    const room = await platform.rooms.get(roomNumber);
    const runtime = runtimeFor(room);
    const presentAccounts = await listPresence(roomNumber);
    const created = await platform.matches.start(roomNumber, presentAccounts.map((entry) => ({ userId: entry.accountId, displayName: entry.displayName })));
    const started = await runtime.realtime.onMatchStarted({ socket, room, match: created });
    await broadcastIndex(room.gameKey);
    return started;
  }

  // What a game's realtime hooks may use. Deliberately small.
  const hostApi = Object.freeze({
    logger,
    platform,
    ensureReady,
    emit: (roomNumber, event, payload) => io.to(channel(roomNumber)).emit(event, payload),
    socketsIn: (roomNumber) => io.in(channel(roomNumber)).fetchSockets(),
    withLock: (key, ttlMs, operation) => withLock(publisher, key, ttlMs, operation),
    releaseRoom: (roomId, matchId) => platform.rooms.release(roomId, matchId),
    broadcastRoom,
    broadcastIndex: async () => broadcastIndex(),
    // Binds a game's own event on every socket: rate-limited, errors mapped to
    // the stable ACK error codes. A second binding of the same event is a bug.
    bindCommand(event, handler) {
      if (boundEvents.has(event)) throw new Error(`lobby: evento já registrado "${event}"`);
      boundEvents.add(event);
      commands.push([event, handler]);
    },
  });
  const commands = [
    [EVENTS.ROOM_LIST, listRooms],
    [EVENTS.ROOM_ENTER, enterRoom],
    [EVENTS.ROOM_LEAVE, leaveRoomHandler],
    [EVENTS.MATCH_START, matchStart],
  ];
  for (const [event] of commands) boundEvents.add(event);
  for (const runtime of runtimes.list()) runtime.realtime.registerHandlers(hostApi);

  function bindCommand(socket, event, handler) {
    socket.on(event, async (payload, acknowledge) => {
      try {
        await rateLimit("command", socket.id);
        const result = await handler(socket, payload);
        acknowledge?.(ackOk(result));
      } catch (error) { const code = mapError(error); logger.error(`[lobby] ${event}: ${code}`); acknowledge?.(ackError(code)); }
    });
  }
  function attach(socket) {
    for (const [event, handler] of commands) bindCommand(socket, event, handler);
    socket.on("disconnect", async () => {
      if (closingState) return;
      const roomNumber = socket.data.roomNumber;
      if (!roomNumber) return;
      const account = socket.data.organizer;
      try {
        if (account && activeMembers.get(memberKey(roomNumber, account.id)) === socket) {
          activeMembers.delete(memberKey(roomNumber, account.id));
          await clearPresence(roomNumber, account.id);
        }
        const room = await platform.rooms.get(roomNumber);
        await runtimes.get(room.gameKey)?.realtime.onSocketDisconnect({ socket, room });
        await broadcastRoom(roomNumber);
        await broadcastIndex(room.gameKey);
      } catch (error) { logger.error(`[lobby] disconnect: ${mapError(error)}`); }
    });
  }
  async function close() {
    closingState = true;
    ready = false;
    for (const runtime of runtimes.list()) runtime.realtime.close?.();
    closing ??= Promise.all([publisher.isOpen ? publisher.quit() : undefined, subscriber.isOpen ? subscriber.quit() : undefined]);
    return closing;
  }
  return { connect, recoverActiveMatches, attach, close, isReady: () => ready };
}
