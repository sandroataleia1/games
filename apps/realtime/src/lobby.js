import { randomBytes } from "node:crypto";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { DomainError } from "@quizarena/database";
import { EVENTS, lobbySchemas, publicLobbyStateSchema } from "@quizarena/contracts";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const DEFAULT_MAX_PLAYERS = 20;
const DEFAULT_TTL_SECONDS = 60 * 60 * 6;
const RATE_LIMITS = Object.freeze({ create: [5, 60], join: [12, 60], resume: [10, 60], command: [60, 60] });

function roomKey(roomCode) { return `quizarena:lobby:room:${roomCode}`; }
function presenceKey(roomCode, participantId) { return `quizarena:lobby:presence:${roomCode}:${participantId}`; }
function rateKey(kind, identity) { return `quizarena:lobby:rate:${kind}:${identity}`; }
function generateRoomCode() {
  const bytes = randomBytes(6);
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}
function errorMessage(code) {
  return { INVALID_PAYLOAD: "Dados inválidos.", QUIZ_NOT_FOUND: "Quiz não encontrado.", QUIZ_NOT_PUBLISHED: "O quiz não está publicado.", ROOM_NOT_FOUND: "Sala não encontrada.", ROOM_NOT_WAITING: "A sala não está aguardando jogadores.", ROOM_FULL: "A sala está cheia.", ROOM_CODE_CONFLICT: "Não foi possível gerar um código de sala.", NAME_CONFLICT: "Este nome já está sendo usado.", INVALID_HOST_TOKEN: "Token do organizador inválido.", INVALID_RECONNECT_TOKEN: "Token de reconexão inválido.", RATE_LIMITED: "Muitas tentativas. Aguarde um pouco.", DEPENDENCY_UNAVAILABLE: "O serviço realtime está temporariamente indisponível.", INTERNAL_ERROR: "Não foi possível concluir a operação." }[code] ?? "Não foi possível concluir a operação.";
}
function ackOk(data) { return { ok: true, data }; }
function ackError(code) { return { ok: false, error: { code, message: errorMessage(code) } }; }
function replaceActive(registry, identity, socket) {
  const previous = registry.get(identity);
  if (previous && previous !== socket) {
    previous.data.player = null;
    previous.data.hostRoomCode = null;
    previous.disconnect(true);
  }
  registry.set(identity, socket);
}
function mapError(error) {
  if (error instanceof DomainError) {
    if (error.code === "SESSION_NOT_FOUND" || error.code === "ROOM_CODE_INVALID") return "ROOM_NOT_FOUND";
    if (error.code === "SESSION_NOT_WAITING") return "ROOM_NOT_WAITING";
    if (error.code === "PARTICIPANT_NAME_CONFLICT") return "NAME_CONFLICT";
    if (error.code === "PARTICIPANT_NOT_FOUND") return "INVALID_RECONNECT_TOKEN";
    if (error.code === "TOKEN_INVALID") return "INVALID_RECONNECT_TOKEN";
    if (error.code === "QUIZ_INVALID") return "QUIZ_NOT_PUBLISHED";
    return error.code;
  }
  return "INTERNAL_ERROR";
}
function publicState(session, presence, maxPlayers) {
  const players = (session.participants ?? []).map((player) => ({
    id: player.id,
    displayName: player.displayName,
    connectionStatus: presence.has(player.id) ? "CONNECTED" : "DISCONNECTED",
    joinedAt: new Date(player.joinedAt).toISOString(),
  }));
  const state = {
    schemaVersion: 1,
    roomCode: session.roomCode,
    status: session.status,
    quiz: { id: session.quizId, title: session.quizSnapshot.title, questionCount: session.quizSnapshot.questions.length },
    players,
    playerCount: players.length,
    maxPlayers,
    serverTime: new Date().toISOString(),
  };
  return publicLobbyStateSchema.parse(state);
}

export function createLobbyRuntime({ io, database, redisUrl, maxPlayers = DEFAULT_MAX_PLAYERS, ttlSeconds = DEFAULT_TTL_SECONDS, logger = console }) {
  const safeMaxPlayers = Math.min(Math.max(Number(maxPlayers) || DEFAULT_MAX_PLAYERS, 1), 100);
  const publisher = createClient({ url: redisUrl, disableOfflineQueue: true });
  const subscriber = publisher.duplicate();
  let ready = false;
  let closingState = false;
  const activePlayers = new Map();
  const activeHosts = new Map();
  let closing;
  async function connect() {
    await Promise.all([publisher.connect(), subscriber.connect()]);
    io.adapter(createAdapter(publisher, subscriber));
    ready = true;
  }
  async function ensureReady() {
    if (!ready || !publisher.isReady) throw new DomainError("DEPENDENCY_UNAVAILABLE");
  }
  async function rateLimit(kind, identity) {
    await ensureReady();
    const [limit, ttl] = RATE_LIMITS[kind];
    const key = rateKey(kind, identity || "unknown");
    const count = await publisher.incr(key);
    if (count === 1) await publisher.expire(key, ttl);
    if (count > limit) throw new DomainError("RATE_LIMITED");
  }
  async function presence(roomCode, session) {
    const values = await Promise.all((session.participants ?? []).map(async (player) => [player.id, await publisher.exists(presenceKey(roomCode, player.id))]));
    return new Map(values.filter(([, exists]) => exists).map(([id]) => [id, true]));
  }
  async function state(roomCode) {
    const session = await database.sessions.getByCode(roomCode);
    if (!session) throw new DomainError("SESSION_NOT_FOUND");
    return publicState(session, await presence(roomCode, session), safeMaxPlayers);
  }
  async function publish(roomCode) {
    const current = await state(roomCode);
    await publisher.set(roomKey(roomCode), JSON.stringify(current), { EX: ttlSeconds });
    io.to(roomCode).emit(EVENTS.ROOM_STATE, current);
    return current;
  }
  async function markPresence(roomCode, participantId, connected) {
    const key = presenceKey(roomCode, participantId);
    if (connected) await publisher.set(key, "1", { EX: ttlSeconds });
    else await publisher.del(key);
  }
  async function createRoom(socket, payload) {
    await rateLimit("create", socket.handshake.address);
    const parsed = lobbySchemas.roomCreate.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    const snapshot = await database.quizzes.buildQuizSnapshot(parsed.data.quizId);
    const hostToken = randomBytes(32).toString("hex");
    let session;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { session = await database.sessions.create({ roomCode: generateRoomCode(), snapshot, hostToken }); break; }
      catch (error) { if (mapError(error) !== "ROOM_CODE_CONFLICT" || attempt === 4) throw new DomainError("ROOM_CODE_CONFLICT"); }
    }
    await socket.join(session.roomCode);
    socket.data.hostRoomCode = session.roomCode;
    socket.data.host = true;
    replaceActive(activeHosts, session.roomCode, socket);
    await publish(session.roomCode);
    return ackOk({ roomCode: session.roomCode, hostToken, state: await state(session.roomCode) });
  }
  async function listQuizzes(_socket, payload) {
    const parsed = lobbySchemas.quizList.safeParse(payload ?? {});
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    await ensureReady();
    const quizzes = await database.quizzes.listByStatus("PUBLISHED");
    const data = await Promise.all(quizzes.map(async (quiz) => {
      const full = await database.quizzes.getById(quiz.id);
      return { id: full.id, title: full.title, questionCount: full.questions.length };
    }));
    return ackOk({ quizzes: data });
  }
  async function joinRoom(socket, payload) {
    await rateLimit("join", socket.handshake.address);
    const parsed = lobbySchemas.roomJoin.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    const session = await database.sessions.getByCode(parsed.data.roomCode);
    if (!session) throw new DomainError("SESSION_NOT_FOUND");
    const reconnectToken = randomBytes(32).toString("hex");
    const player = await database.sessions.registerParticipant({ gameSessionId: session.id, displayName: parsed.data.displayName, reconnectToken });
    await socket.join(session.roomCode);
    socket.data.player = { roomCode: session.roomCode, participantId: player.id, gameSessionId: session.id };
    replaceActive(activePlayers, player.id, socket);
    await markPresence(session.roomCode, player.id, true);
    const lobby = await publish(session.roomCode);
    io.to(session.roomCode).emit(EVENTS.PARTICIPANT_JOINED, lobby.players.find(({ id }) => id === player.id));
    return ackOk({ reconnectToken, participantId: player.id, state: lobby });
  }
  async function resumePlayer(socket, payload) {
    await rateLimit("resume", socket.handshake.address);
    const parsed = lobbySchemas.roomResume.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    const session = await database.sessions.getByCode(parsed.data.roomCode);
    if (!session) throw new DomainError("SESSION_NOT_FOUND");
    const player = await database.sessions.resumeParticipant({ gameSessionId: session.id, participantId: parsed.data.participantId, reconnectToken: parsed.data.reconnectToken });
    await socket.join(session.roomCode);
    socket.data.player = { roomCode: session.roomCode, participantId: player.id, gameSessionId: session.id };
    replaceActive(activePlayers, player.id, socket);
    await markPresence(session.roomCode, player.id, true);
    const lobby = await publish(session.roomCode);
    io.to(session.roomCode).emit(EVENTS.PARTICIPANT_UPDATED, lobby.players.find(({ id }) => id === player.id));
    return ackOk({ participantId: player.id, state: lobby });
  }
  async function resumeHost(socket, payload) {
    await rateLimit("resume", socket.handshake.address);
    const parsed = lobbySchemas.hostResume.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    const session = await database.sessions.getByCode(parsed.data.roomCode);
    if (!session) throw new DomainError("SESSION_NOT_FOUND");
    await database.sessions.resumeHost({ gameSessionId: session.id, hostToken: parsed.data.hostToken });
    await socket.join(session.roomCode);
    socket.data.hostRoomCode = session.roomCode;
    socket.data.host = true;
    replaceActive(activeHosts, session.roomCode, socket);
    return ackOk({ state: await publish(session.roomCode) });
  }
  async function leaveRoom(socket, payload) {
    const parsed = lobbySchemas.roomLeave.safeParse(payload);
    if (!parsed.success || socket.data.player?.roomCode !== parsed.data.roomCode) throw new DomainError("INVALID_PAYLOAD");
    const { roomCode, participantId, gameSessionId } = socket.data.player;
    await database.sessions.leaveParticipant(gameSessionId, participantId);
    await markPresence(roomCode, participantId, false);
    socket.data.player = null;
    if (activePlayers.get(participantId) === socket) activePlayers.delete(participantId);
    const lobby = await publish(roomCode);
    io.to(roomCode).emit(EVENTS.PARTICIPANT_LEFT, { id: participantId });
    return ackOk({ state: lobby });
  }
  function bindCommand(socket, event, handler) {
    socket.on(event, async (payload, acknowledge) => {
      try { await rateLimit("command", socket.id); const result = await handler(socket, payload); acknowledge?.(result); }
      catch (error) { const code = mapError(error); logger.error(`[lobby] ${event}: ${code}`); acknowledge?.(ackError(code)); }
    });
  }
  function attach(socket) {
    bindCommand(socket, EVENTS.QUIZ_LIST, listQuizzes);
    bindCommand(socket, EVENTS.ROOM_CREATE, createRoom);
    bindCommand(socket, EVENTS.ROOM_JOIN, joinRoom);
    bindCommand(socket, EVENTS.ROOM_RESUME, resumePlayer);
    bindCommand(socket, EVENTS.HOST_RESUME, resumeHost);
    bindCommand(socket, EVENTS.ROOM_LEAVE, leaveRoom);
    socket.on("disconnect", async () => {
      if (closingState) return;
      if (socket.data.hostRoomCode && activeHosts.get(socket.data.hostRoomCode) === socket) activeHosts.delete(socket.data.hostRoomCode);
      const player = socket.data.player;
      if (!player) return;
      if (activePlayers.get(player.participantId) !== socket) return;
      activePlayers.delete(player.participantId);
      try { await database.sessions.disconnectParticipant(player.gameSessionId, player.participantId); await markPresence(player.roomCode, player.participantId, false); await publish(player.roomCode); }
      catch (error) { logger.error(`[lobby] disconnect: ${mapError(error)}`); }
    });
  }
  async function close() {
    closingState = true;
    ready = false;
    closing ??= Promise.all([publisher.isOpen ? publisher.quit() : undefined, subscriber.isOpen ? subscriber.quit() : undefined]);
    return closing;
  }
  return { connect, attach, close, isReady: () => ready };
}