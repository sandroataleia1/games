import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { withLock } from "./distributed-lock.js";
import { DomainError } from "@quizarena/database";
import { quizGame } from "@quizarena/game-quiz";
import { EVENTS, lobbySchemas, publicRoomSchema, publicMatchStateSchema } from "@quizarena/contracts";

const DEFAULT_TTL_SECONDS = 60 * 60 * 6;
const DEFAULT_RESULT_ADVANCE_MS = 45000;
const GAME_LOCK_TTL_MS = 120000;
const RATE_LIMITS = Object.freeze({ enter: [20, 60], resume: [10, 60], command: [60, 60] });
const INDEX_CHANNEL = "rooms:index";
// This runtime is the Quiz's realtime implementation (registry: implementation.realtime):
// it only serves rooms whose game is the Quiz, and never reveals other games' rooms.
const LOBBY_GAME_KEY = quizGame.definition.key;

function channel(roomNumber) { return `room:${roomNumber}`; }
function presenceKeyPrefix(roomNumber) { return `quizarena:room:presence:${roomNumber}:`; }
function presenceKey(roomNumber, accountId) { return `${presenceKeyPrefix(roomNumber)}${accountId}`; }
function gameLockKey(sessionId, round) { return `quizarena:lobby:game:lock:${sessionId}:${round}`; }
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
function publicQuestion(session) {
  if (session.matchPhase !== "QUESTION") return null;
  const question = session.quizSnapshot.questions[session.currentQuestionIndex];
  return { id: question.id, prompt: question.prompt, options: question.options.map(({ id, position, text }) => ({ id, position, text })), round: session.currentQuestionIndex + 1, totalRounds: session.quizSnapshot.questions.length, durationSeconds: question.durationSeconds, startedAt: session.questionStartedAt.toISOString(), endsAt: session.questionEndsAt.toISOString(), phase: "QUESTION" };
}

export function createLobbyRuntime({ io, database, redisUrl, ttlSeconds = DEFAULT_TTL_SECONDS, resultAdvanceMs = DEFAULT_RESULT_ADVANCE_MS, rateLimitPrefix = "quizarena:lobby:rate", logger = console }) {
  const publisher = createClient({ url: redisUrl, disableOfflineQueue: true });
  const subscriber = publisher.duplicate();
  let ready = false;
  let closingState = false;
  const activeMembers = new Map();
  const timers = new Map();
  let closing;
  async function connect() {
    await Promise.all([publisher.connect(), subscriber.connect()]);
    io.adapter(createAdapter(publisher, subscriber));
    ready = true;
    await recoverActiveMatches();
  }
  async function recoverActiveMatches() {
    // The platform lists live matches from PostgreSQL and asks each game what
    // is still pending; Redis plays no part in recovery.
    for (const { match, room, recovery } of await database.platform.matches.recoverable()) {
      if (match.gameKey !== LOBBY_GAME_KEY) continue;
      if (recovery.kind === "question-deadline") scheduleQuestion(room.number, match.id, recovery.endsAt);
      else if (recovery.kind === "result-advance") scheduleResultAdvance(room.number, match.id);
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
  async function publicRoomState(roomNumber) {
    const room = await database.rooms.get(roomNumber);
    const players = await listPresence(roomNumber);
    return publicRoomSchema.parse({ roomNumber: room.number, gameKey: room.gameKey, status: room.status, quizId: room.quizId, quizTitle: room.quizTitle, playerCount: players.length, players, serverTime: new Date().toISOString() });
  }
  async function broadcastRoom(roomNumber) {
    const current = await publicRoomState(roomNumber);
    io.to(channel(roomNumber)).emit(EVENTS.ROOM_STATE, current);
    return current;
  }
  async function roomIndex() {
    const rooms = await database.rooms.list({ gameKey: LOBBY_GAME_KEY });
    // The public index never carries the internal id of the room's current match.
    return Promise.all(rooms.map(async ({ currentSessionId, ...room }) => { void currentSessionId; return { ...room, playerCount: (await listPresence(room.number)).length }; }));
  }
  async function broadcastIndex() {
    io.to(INDEX_CHANNEL).emit(EVENTS.ROOM_INDEX, { rooms: await roomIndex() });
  }
  async function matchState(roomNumber, sessionId) {
    await ensureReady();
    const current = await database.sessions.currentQuestion(sessionId);
    const question = publicQuestion(current.session);
    return publicMatchStateSchema.parse({ schemaVersion: 1, roomNumber, gameKey: current.session.gameKey, phase: current.session.matchPhase, round: current.session.currentQuestionIndex == null ? 0 : current.session.currentQuestionIndex + 1, totalRounds: current.session.quizSnapshot.questions.length, question, answeredCount: current.answers.length, playerCount: current.session.participants.length, serverTime: new Date().toISOString() });
  }
  async function publishMatch(roomNumber, sessionId, { emitQuestion = true } = {}) {
    const current = await matchState(roomNumber, sessionId);
    io.to(channel(roomNumber)).emit(EVENTS.GAME_STATE, current);
    if (emitQuestion && current.question) io.to(channel(roomNumber)).emit(EVENTS.GAME_QUESTION, current.question);
    return current;
  }
  async function finishQuestion(roomNumber, sessionId, { force = false } = {}) {
    const session = await database.sessions.getById(sessionId).catch(() => null);
    if (!session || session.matchPhase !== "QUESTION") return;
    const round = session.currentQuestionIndex + 1;
    if (!force && session.questionEndsAt && Date.now() < new Date(session.questionEndsAt).getTime()) { scheduleQuestion(roomNumber, sessionId, session.questionEndsAt); return; }
    const locked = await withLock(publisher, gameLockKey(sessionId, round), GAME_LOCK_TTL_MS, async () => {
      const current = await database.sessions.getById(sessionId).catch(() => null);
      if (!current || current.matchPhase !== "QUESTION") return;
      return database.sessions.questionResult(sessionId);
    });
    if (!locked.acquired || !locked.value) return;
    const result = locked.value;
    const ranking = result.ranking.map(({ id, displayName, score }) => ({ id, displayName, score }));
    const distribution = result.answers.reduce((counts, answer) => { counts[answer.selectedOptionRef] = (counts[answer.selectedOptionRef] || 0) + 1; return counts; }, {});
    const sockets = await io.in(channel(roomNumber)).fetchSockets();
    for (const socket of sockets) {
      const own = socket.data.player ? result.answers.find(({ participantId }) => participantId === socket.data.player.participantId) : null;
      socket.emit(EVENTS.GAME_QUESTION_RESULT, { round, correctOptionId: result.question.correctOptionId, distribution, ownResult: own ? { isCorrect: own.isCorrect, pointsAwarded: own.pointsAwarded, responseTimeMs: own.responseTimeMs } : null, ranking });
    }
    io.to(channel(roomNumber)).emit(EVENTS.GAME_RANKING, ranking);
    await publishMatch(roomNumber, sessionId);
    // Nobody may ever click "Avançar" (disconnected, distracted); force the
    // match forward after a grace period instead of leaving the room PLAYING
    // against a session that will never progress on its own.
    scheduleResultAdvance(roomNumber, sessionId);
  }
  function scheduleQuestion(roomNumber, sessionId, endsAt) {
    const previous = timers.get(sessionId);
    if (previous) clearTimeout(previous);
    const endsAtMs = endsAt instanceof Date ? endsAt.getTime() : new Date(endsAt).getTime();
    timers.set(sessionId, setTimeout(() => finishQuestion(roomNumber, sessionId).catch((error) => logger.error(`[lobby] timer: ${mapError(error)}`)), Math.max(10, endsAtMs - Date.now())));
  }
  function scheduleResultAdvance(roomNumber, sessionId) {
    const previous = timers.get(sessionId);
    if (previous) clearTimeout(previous);
    timers.set(sessionId, setTimeout(() => advanceMatch(roomNumber, sessionId).catch((error) => logger.error(`[lobby] result timer: ${mapError(error)}`)), resultAdvanceMs));
  }
  async function advanceMatch(roomNumber, sessionId) {
    const session = await database.sessions.getById(sessionId);
    const round = session.currentQuestionIndex + 1;
    const locked = await withLock(publisher, gameLockKey(sessionId, round), GAME_LOCK_TTL_MS, async () => {
      const current = await database.sessions.getById(sessionId);
      if (current.matchPhase !== "QUESTION_RESULT") throw new DomainError("INVALID_STATE");
      return database.sessions.nextQuestion(sessionId);
    });
    if (!locked.acquired) throw new DomainError("INVALID_STATE");
    const next = locked.value;
    if (next.finished) {
      const ranking = next.ranking.map(({ id, displayName, score }) => ({ id, displayName, score }));
      const previous = timers.get(sessionId);
      if (previous) { clearTimeout(previous); timers.delete(sessionId); }
      io.to(channel(roomNumber)).emit(EVENTS.GAME_FINISHED, { ranking });
      io.to(channel(roomNumber)).emit(EVENTS.GAME_RANKING, ranking);
      await database.rooms.reopen(session.roomId, sessionId);
      await broadcastRoom(roomNumber);
      await broadcastIndex();
      return { finished: true, ranking };
    }
    scheduleQuestion(roomNumber, sessionId, next.session.questionEndsAt);
    return { finished: false, match: await publishMatch(roomNumber, sessionId) };
  }
  function claimMembership(roomNumber, accountId, socket) {
    const key = memberKey(roomNumber, accountId);
    const previous = activeMembers.get(key);
    if (previous && previous !== socket) { previous.data.roomNumber = null; previous.data.player = null; previous.disconnect(true); }
    activeMembers.set(key, socket);
  }
  async function attachIfParticipant(socket, roomNumber, sessionId) {
    if (socket.data.player?.roomNumber === roomNumber) return socket.data.player;
    if (!socket.data.organizer) return null;
    const existing = await database.sessions.resumePresenceForAccount(sessionId, socket.data.organizer.id).catch(() => null);
    if (!existing) return null;
    socket.data.player = { roomNumber, participantId: existing.id, gameSessionId: sessionId };
    return socket.data.player;
  }
  async function enterRoom(socket, payload) {
    await rateLimit("enter", socket.handshake.address);
    const parsed = lobbySchemas.roomEnter.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    if (!socket.data.organizer) throw new DomainError("UNAUTHENTICATED");
    const account = socket.data.organizer;
    const room = await database.rooms.get(parsed.data.roomNumber);
    // A room of another game is indistinguishable from a missing one here.
    if (room.gameKey !== LOBBY_GAME_KEY) throw new DomainError("ROOM_NOT_FOUND");
    await socket.join(channel(room.number));
    socket.data.roomNumber = room.number;
    claimMembership(room.number, account.id, socket);
    await setPresence(room.number, account.id, account.name);
    let match = null;
    if (room.status === "PLAYING" && room.currentSessionId) {
      await attachIfParticipant(socket, room.number, room.currentSessionId);
      match = await matchState(room.number, room.currentSessionId);
    }
    const state = await broadcastRoom(room.number);
    io.to(channel(room.number)).emit(EVENTS.PARTICIPANT_JOINED, { accountId: account.id, displayName: account.name });
    await broadcastIndex();
    return ackOk({ room: state, match, playing: Boolean(socket.data.player) });
  }
  async function finishIfAbandoned(sessionId) {
    const finished = await database.sessions.abandonIfEmpty(sessionId).catch(() => null);
    if (!finished) return;
    const previous = timers.get(sessionId);
    if (previous) { clearTimeout(previous); timers.delete(sessionId); }
    if (finished.roomId) await database.rooms.reopen(finished.roomId, sessionId).catch(() => {});
  }
  async function leaveRoomHandler(socket, payload) {
    const parsed = lobbySchemas.roomLeave.safeParse(payload);
    if (!parsed.success || socket.data.roomNumber !== parsed.data.roomNumber) throw new DomainError("INVALID_PAYLOAD");
    const account = socket.data.organizer;
    const roomNumber = socket.data.roomNumber;
    if (account && activeMembers.get(memberKey(roomNumber, account.id)) === socket) activeMembers.delete(memberKey(roomNumber, account.id));
    if (account) await clearPresence(roomNumber, account.id);
    if (socket.data.player) {
      const { gameSessionId, participantId } = socket.data.player;
      try { await database.sessions.disconnectParticipant(gameSessionId, participantId); } catch { /* best effort */ }
      // Nobody left playing: finish the match now instead of leaving the room
      // stuck PLAYING against an abandoned session forever.
      await finishIfAbandoned(gameSessionId);
    }
    socket.data.roomNumber = null;
    socket.data.player = null;
    await socket.leave(channel(roomNumber));
    const state = await broadcastRoom(roomNumber);
    if (account) io.to(channel(roomNumber)).emit(EVENTS.PARTICIPANT_LEFT, { accountId: account.id });
    await broadcastIndex();
    return ackOk({ room: state });
  }
  async function listQuizzes(socket, payload) {
    const parsed = lobbySchemas.quizList.safeParse(payload ?? {});
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    await ensureReady();
    if (!socket.data.organizer) throw new DomainError("UNAUTHENTICATED");
    return ackOk({ quizzes: await database.organizers.publishedAll() });
  }
  async function listRooms(socket, payload) {
    const parsed = lobbySchemas.roomList.safeParse(payload ?? {});
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    if (!socket.data.organizer) throw new DomainError("UNAUTHENTICATED");
    await socket.join(INDEX_CHANNEL);
    return ackOk({ rooms: await roomIndex() });
  }
  async function selectTheme(socket, payload) {
    const parsed = lobbySchemas.themeSelect.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    if (!socket.data.organizer) throw new DomainError("UNAUTHENTICATED");
    if (socket.data.roomNumber !== parsed.data.roomNumber) throw new DomainError("UNAUTHORIZED");
    await database.rooms.selectTheme(parsed.data.roomNumber, parsed.data.quizId);
    const state = await broadcastRoom(parsed.data.roomNumber);
    await broadcastIndex();
    return ackOk({ room: state });
  }
  async function matchStart(socket, payload) {
    const parsed = lobbySchemas.matchStart.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    if (!socket.data.organizer) throw new DomainError("UNAUTHENTICATED");
    if (socket.data.roomNumber !== parsed.data.roomNumber) throw new DomainError("UNAUTHORIZED");
    const roomNumber = parsed.data.roomNumber;
    const presentAccounts = await listPresence(roomNumber);
    const created = await database.rooms.startMatch(roomNumber, presentAccounts.map((entry) => ({ userId: entry.accountId, displayName: entry.displayName })));
    // Sockets learn they're a participant lazily (see attachIfParticipant):
    // with a Redis adapter, fetchSockets() across instances only returns
    // mutable data for sockets local to this process, so eagerly mutating
    // remote sockets here would silently no-op on every other instance.
    await attachIfParticipant(socket, roomNumber, created.id);
    const started = await database.sessions.startMatch(created.id);
    scheduleQuestion(roomNumber, created.id, started.questionEndsAt);
    await broadcastIndex();
    return ackOk({ match: await publishMatch(roomNumber, created.id) });
  }
  async function ensurePlayer(socket, roomNumber) {
    if (socket.data.roomNumber !== roomNumber) return false;
    const room = await database.rooms.get(roomNumber).catch(() => null);
    if (!room?.currentSessionId) { socket.data.player = null; return false; }
    if (socket.data.player?.roomNumber === roomNumber && socket.data.player.gameSessionId === room.currentSessionId) return true;
    return Boolean(await attachIfParticipant(socket, roomNumber, room.currentSessionId));
  }
  async function answerGame(socket, payload) {
    const parsed = lobbySchemas.gameAnswer.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    if (!(await ensurePlayer(socket, parsed.data.roomNumber))) throw new DomainError("UNAUTHORIZED");
    const result = await database.sessions.answer({ gameSessionId: socket.data.player.gameSessionId, participantId: socket.data.player.participantId, questionRef: parsed.data.questionId, selectedOptionRef: parsed.data.optionId });
    // Nobody left to wait for: show the result right away instead of holding
    // the room until the question's deadline. The deadline stays only as the
    // safety net for players who never answer.
    const { session, answers } = await database.sessions.currentQuestion(socket.data.player.gameSessionId);
    const activeIds = session.participants.filter((participant) => !participant.disconnectedAt).map((participant) => participant.id);
    if (activeIds.length > 0 && activeIds.every((id) => answers.some((answer) => answer.participantId === id))) {
      await finishQuestion(parsed.data.roomNumber, socket.data.player.gameSessionId, { force: true }).catch((error) => logger.error(`[lobby] early finish: ${mapError(error)}`));
    }
    return ackOk({ answered: true, pointsAwarded: result.pointsAwarded });
  }
  async function nextGame(socket, payload) {
    const parsed = lobbySchemas.gameNext.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    if (!(await ensurePlayer(socket, parsed.data.roomNumber))) throw new DomainError("UNAUTHORIZED");
    const result = await advanceMatch(parsed.data.roomNumber, socket.data.player.gameSessionId);
    if (result.finished) socket.data.player = null;
    return ackOk(result);
  }
  function bindCommand(socket, event, handler) {
    socket.on(event, async (payload, acknowledge) => {
      try { await rateLimit("command", socket.id); const result = await handler(socket, payload); acknowledge?.(result); }
      catch (error) { const code = mapError(error); logger.error(`[lobby] ${event}: ${code}`); acknowledge?.(ackError(code)); }
    });
  }
  function attach(socket) {
    bindCommand(socket, EVENTS.QUIZ_LIST, listQuizzes);
    bindCommand(socket, EVENTS.ROOM_LIST, listRooms);
    bindCommand(socket, EVENTS.ROOM_ENTER, enterRoom);
    bindCommand(socket, EVENTS.ROOM_LEAVE, leaveRoomHandler);
    bindCommand(socket, EVENTS.THEME_SELECT, selectTheme);
    bindCommand(socket, EVENTS.MATCH_START, matchStart);
    bindCommand(socket, EVENTS.GAME_ANSWER, answerGame);
    bindCommand(socket, EVENTS.GAME_NEXT, nextGame);
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
        // Not a real leave, just a dropped connection (refresh, network blip):
        // keep the match alive so reconnecting resumes it, per resumePresenceForAccount.
        if (socket.data.player) await database.sessions.disconnectParticipant(socket.data.player.gameSessionId, socket.data.player.participantId);
        await broadcastRoom(roomNumber);
        await broadcastIndex();
      } catch (error) { logger.error(`[lobby] disconnect: ${mapError(error)}`); }
    });
  }
  async function close() {
    closingState = true;
    ready = false;
    closing ??= Promise.all([publisher.isOpen ? publisher.quit() : undefined, subscriber.isOpen ? subscriber.quit() : undefined]);
    return closing;
  }
  return { connect, recoverActiveMatches, attach, close, isReady: () => ready };
}
