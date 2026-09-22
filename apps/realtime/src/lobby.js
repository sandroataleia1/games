import { randomBytes } from "node:crypto";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { withLock } from "./distributed-lock.js";
import { DomainError } from "@quizarena/database";
import { EVENTS, lobbySchemas, publicLobbyStateSchema } from "@quizarena/contracts";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const DEFAULT_MAX_PLAYERS = 20;
const DEFAULT_TTL_SECONDS = 60 * 60 * 6;
const GAME_LOCK_TTL_MS = 120000;
const RATE_LIMITS = Object.freeze({ create: [5, 60], join: [12, 60], resume: [10, 60], command: [60, 60] });

function roomKey(roomCode) { return `quizarena:lobby:room:${roomCode}`; }
function presenceKey(roomCode, participantId) { return `quizarena:lobby:presence:${roomCode}:${participantId}`; }
function gameLockKey(roomCode, round) { return `quizarena:lobby:game:lock:${roomCode}:${round}`; }
function rateKey(prefix, kind, identity) { return `${prefix}:${kind}:${identity}`; }
function generateRoomCode() {
  const bytes = randomBytes(6);
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}
function errorMessage(code) {
  return { INVALID_PAYLOAD: "Dados inválidos.", QUIZ_NOT_FOUND: "Quiz não encontrado.", QUIZ_NOT_PUBLISHED: "O quiz não está publicado.", ROOM_NOT_FOUND: "Sala não encontrada.", ROOM_NOT_WAITING: "A sala não está aguardando jogadores.", ROOM_FULL: "A sala está cheia.", ROOM_CODE_CONFLICT: "Não foi possível gerar um código de sala.", NAME_CONFLICT: "Este nome já está sendo usado.", INVALID_HOST_TOKEN: "Token do organizador inválido.", INVALID_RECONNECT_TOKEN: "Token de reconexão inválido.", RATE_LIMITED: "Muitas tentativas. Aguarde um pouco.", DEPENDENCY_UNAVAILABLE: "O serviço realtime está temporariamente indisponível.", UNAUTHENTICATED: "É necessário entrar com sua conta.", PARTICIPANT_ALREADY_JOINED: "Você já está participando desta sala.", INTERNAL_ERROR: "Não foi possível concluir a operação." }[code] ?? "Não foi possível concluir a operação.";
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
    visibility: session.visibility,
    quiz: { id: session.quizId, title: session.quizSnapshot.title, questionCount: session.quizSnapshot.questions.length },
    players,
    playerCount: players.length,
    maxPlayers,
    serverTime: new Date().toISOString(),
  };
  return publicLobbyStateSchema.parse(state);
}
function publicQuestion(session) {
  if (session.matchPhase !== "QUESTION") return null;
  const question = session.quizSnapshot.questions[session.currentQuestionIndex];
  return { id: question.id, prompt: question.prompt, options: question.options.map(({ id, position, text }) => ({ id, position, text })), round: session.currentQuestionIndex + 1, totalRounds: session.quizSnapshot.questions.length, durationSeconds: question.durationSeconds, startedAt: session.questionStartedAt.toISOString(), endsAt: session.questionEndsAt.toISOString(), phase: "QUESTION" };
}

export function createLobbyRuntime({ io, database, redisUrl, maxPlayers = DEFAULT_MAX_PLAYERS, ttlSeconds = DEFAULT_TTL_SECONDS, rateLimitPrefix = "quizarena:lobby:rate", logger = console }) {
  const safeMaxPlayers = Math.min(Math.max(Number(maxPlayers) || DEFAULT_MAX_PLAYERS, 1), 100);
  const publisher = createClient({ url: redisUrl, disableOfflineQueue: true });
  const subscriber = publisher.duplicate();
  let ready = false;
  let closingState = false;
  const activePlayers = new Map();
  const activeHosts = new Map();
  const timers = new Map();
  let closing;
  async function connect() {
    await Promise.all([publisher.connect(), subscriber.connect()]);
    io.adapter(createAdapter(publisher, subscriber));
    ready = true;
    await recoverActiveMatches();
  }
  async function recoverActiveMatches() {
    const matches = await database.sessions.activeMatches();
    matches.forEach((session) => scheduleQuestion(session.roomCode, session.questionEndsAt));
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
  async function presence(roomCode, session) {
    const values = await Promise.all((session.participants ?? []).map(async (player) => [player.id, await publisher.exists(presenceKey(roomCode, player.id))]));
    return new Map(values.filter(([, exists]) => exists).map(([id]) => [id, true]));
  }
  async function state(roomCode) {
    const session = await database.sessions.getByCode(roomCode);
    if (!session) throw new DomainError("SESSION_NOT_FOUND");
    return publicState(session, await presence(roomCode, session), safeMaxPlayers);
  }
  async function broadcastRoomCatalog(quizId) {
    const rooms = await database.sessions.publicRoomsForQuiz(quizId);
    io.to(`quiz:${quizId}`).emit(EVENTS.ROOM_CATALOG, { quizId, rooms });
  }
  async function publish(roomCode) {
    const session = await database.sessions.getByCode(roomCode);
    if (!session) throw new DomainError("SESSION_NOT_FOUND");
    const current = publicState(session, await presence(roomCode, session), safeMaxPlayers);
    await publisher.set(roomKey(roomCode), JSON.stringify(current), { EX: ttlSeconds });
    io.to(roomCode).emit(EVENTS.ROOM_STATE, current);
    if (session.visibility === "PUBLIC") await broadcastRoomCatalog(session.quizId);
    return current;
  }
  async function matchState(roomCode) {
    await ensureReady();
    const room = await database.sessions.getByCode(roomCode);
    if (!room) throw new DomainError("SESSION_NOT_FOUND");
    const current = await database.sessions.currentQuestion(room.id);
    const question = publicQuestion(current.session);
    return { schemaVersion: 1, roomCode, phase: current.session.matchPhase, round: current.session.currentQuestionIndex == null ? 0 : current.session.currentQuestionIndex + 1, totalRounds: current.session.quizSnapshot.questions.length, question, answeredCount: current.answers.length, playerCount: current.session.participants.length, serverTime: new Date().toISOString() };
  }
  async function publishMatch(roomCode, { emitQuestion = true } = {}) {
    const current = await matchState(roomCode);
    await publisher.set(`${roomKey(roomCode)}:game`, JSON.stringify(current), { EX: ttlSeconds });
    io.to(roomCode).emit(EVENTS.GAME_STATE, current);
    if (emitQuestion && current.question) io.to(roomCode).emit(EVENTS.GAME_QUESTION, current.question);
    return current;
  }
  async function finishQuestion(roomCode) {
    const session = await database.sessions.getByCode(roomCode);
    if (!session || session.matchPhase !== "QUESTION") return;
    const round = session.currentQuestionIndex + 1;
    if (session.questionEndsAt && Date.now() < session.questionEndsAt.getTime()) { scheduleQuestion(roomCode, session.questionEndsAt); return; }
      const locked = await withLock(publisher, gameLockKey(roomCode, round), GAME_LOCK_TTL_MS, async () => {
        const current = await database.sessions.getByCode(roomCode);
        if (!current || current.matchPhase !== "QUESTION") return;
        return database.sessions.questionResult(current.id);
      });
      if (!locked.acquired || !locked.value) return;
      const result = locked.value;
      const ranking = result.ranking.map(({ id, displayName, score }) => ({ id, displayName, score }));
      const distribution = result.answers.reduce((counts, answer) => { counts[answer.selectedOptionRef] = (counts[answer.selectedOptionRef] || 0) + 1; return counts; }, {});
      const sockets = await io.in(roomCode).fetchSockets();
      for (const socket of sockets) {
        const own = socket.data.player ? result.answers.find(({ participantId }) => participantId === socket.data.player.participantId) : null;
        socket.emit(EVENTS.GAME_QUESTION_RESULT, { round, correctOptionId: result.question.correctOptionId, distribution, ownResult: own ? { isCorrect: own.isCorrect, pointsAwarded: own.pointsAwarded, responseTimeMs: own.responseTimeMs } : null, ranking });
      }
      io.to(roomCode).emit(EVENTS.GAME_RANKING, ranking);
      await publishMatch(roomCode);
  }
  function scheduleQuestion(roomCode, endsAt) {
    const previous = timers.get(roomCode);
    if (previous) clearTimeout(previous);
    timers.set(roomCode, setTimeout(() => finishQuestion(roomCode).catch((error) => logger.error(`[lobby] timer: ${mapError(error)}`)), Math.max(10, endsAt.getTime() - Date.now())));
  }
  async function markPresence(roomCode, participantId, connected) {
    const key = presenceKey(roomCode, participantId);
    if (connected) await publisher.set(key, "1", { EX: ttlSeconds });
    else await publisher.del(key);
  }
  async function attachPlayer(socket, gameSessionId, roomCode, account) {
    const { participant } = await database.sessions.enterAsAccount({ gameSessionId, userId: account.id, displayName: account.name });
    socket.data.player = { roomCode, participantId: participant.id, gameSessionId };
    replaceActive(activePlayers, participant.id, socket);
    await markPresence(roomCode, participant.id, true);
    return participant;
  }
  async function createRoom(socket, payload) {
    await rateLimit("create", socket.handshake.address);
    const parsed = lobbySchemas.roomCreate.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    if (!socket.data.organizer) throw new DomainError("UNAUTHENTICATED");
    const hostToken = randomBytes(32).toString("hex");
    let session;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { session = await database.organizers.createRoomFromPublished(parsed.data.quizId, generateRoomCode(), hostToken, { hostUserId: socket.data.organizer.id, visibility: parsed.data.visibility }); break; }
      catch (error) { if (mapError(error) !== "ROOM_CODE_CONFLICT") throw error; if (attempt === 4) throw new DomainError("ROOM_CODE_CONFLICT"); }
    }
    await socket.join(session.roomCode);
    socket.data.hostRoomCode = session.roomCode;
    socket.data.host = true;
    replaceActive(activeHosts, session.roomCode, socket);
    if (parsed.data.hostPlays) await attachPlayer(socket, session.id, session.roomCode, socket.data.organizer);
    await publish(session.roomCode);
    return ackOk({ roomCode: session.roomCode, hostToken, playing: parsed.data.hostPlays, state: await state(session.roomCode) });
  }
  async function listQuizzes(_socket, payload) {
    const parsed = lobbySchemas.quizList.safeParse(payload ?? {});
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    await ensureReady();
    if (!_socket.data.organizer) throw new DomainError("UNAUTHENTICATED");
    const data = await database.organizers.publishedAll();
    return ackOk({ quizzes: data });
  }
  async function joinRoom(socket, payload) {
    await rateLimit("join", socket.handshake.address);
    const parsed = lobbySchemas.roomJoin.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    if (!socket.data.organizer) throw new DomainError("UNAUTHENTICATED");
    const session = await database.sessions.getByCode(parsed.data.roomCode);
    if (!session) throw new DomainError("SESSION_NOT_FOUND");
    const account = socket.data.organizer;
    const player = await attachPlayer(socket, session.id, session.roomCode, parsed.data.displayName ? { ...account, name: parsed.data.displayName } : account);
    await socket.join(session.roomCode);
    const lobby = session.matchPhase === "LOBBY" ? await publish(session.roomCode) : null;
    if (lobby) io.to(session.roomCode).emit(EVENTS.PARTICIPANT_JOINED, lobby.players.find(({ id }) => id === player.id));
    return ackOk({ participantId: player.id, state: lobby, match: await matchState(session.roomCode) });
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
    const lobby = session.matchPhase === "LOBBY" ? await publish(session.roomCode) : null;
    if (lobby) io.to(session.roomCode).emit(EVENTS.PARTICIPANT_UPDATED, lobby.players.find(({ id }) => id === player.id));
    return ackOk({ participantId: player.id, state: lobby, match: await matchState(session.roomCode) });
  }
  async function resumeHost(socket, payload) {
    await rateLimit("resume", socket.handshake.address);
    const parsed = lobbySchemas.hostResume.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    if (!socket.data.organizer) throw new DomainError("UNAUTHENTICATED");
    const session = await database.sessions.getByCode(parsed.data.roomCode);
    if (!session) throw new DomainError("SESSION_NOT_FOUND");
    await database.sessions.resumeHost({ gameSessionId: session.id, hostToken: parsed.data.hostToken, accountId: socket.data.organizer.id });
    await socket.join(session.roomCode);
    socket.data.hostRoomCode = session.roomCode;
    socket.data.host = true;
    replaceActive(activeHosts, session.roomCode, socket);
    const existingPlayer = await database.sessions.resumePresenceForAccount(session.id, socket.data.organizer.id);
    if (existingPlayer) { socket.data.player = { roomCode: session.roomCode, participantId: existingPlayer.id, gameSessionId: session.id }; replaceActive(activePlayers, existingPlayer.id, socket); await markPresence(session.roomCode, existingPlayer.id, true); }
    const lobby = session.matchPhase === "LOBBY" ? await publish(session.roomCode) : null;
    return ackOk({ state: lobby, match: await matchState(session.roomCode), playing: Boolean(existingPlayer) });
  }
  async function listRooms(socket, payload) {
    const parsed = lobbySchemas.roomList.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    if (!socket.data.organizer) throw new DomainError("UNAUTHENTICATED");
    return ackOk({ rooms: await database.sessions.publicRoomsForQuiz(parsed.data.quizId) });
  }
  async function watchQuiz(socket, payload) {
    const parsed = lobbySchemas.roomWatch.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    if (!socket.data.organizer) throw new DomainError("UNAUTHENTICATED");
    await socket.join(`quiz:${parsed.data.quizId}`);
    return ackOk({ rooms: await database.sessions.publicRoomsForQuiz(parsed.data.quizId) });
  }
  async function unwatchQuiz(socket, payload) {
    const parsed = lobbySchemas.roomUnwatch.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    await socket.leave(`quiz:${parsed.data.quizId}`);
    return ackOk({});
  }
  async function startGame(socket, payload) {
    const parsed = lobbySchemas.gameStart.safeParse(payload);
    if (!parsed.success || socket.data.hostRoomCode !== parsed.data.roomCode || !socket.data.host) throw new DomainError("UNAUTHORIZED");
    const session = await database.sessions.getByCode(parsed.data.roomCode);
    if (!session) throw new DomainError("SESSION_NOT_FOUND");
    const started = await database.sessions.startMatch(session.id);
    scheduleQuestion(parsed.data.roomCode, started.questionEndsAt);
    if (session.visibility === "PUBLIC") await broadcastRoomCatalog(session.quizId);
    return ackOk({ match: await publishMatch(parsed.data.roomCode) });
  }
  async function answerGame(socket, payload) {
    const parsed = lobbySchemas.gameAnswer.safeParse(payload);
    if (!parsed.success || socket.data.player?.roomCode !== parsed.data.roomCode) throw new DomainError("UNAUTHORIZED");
    const result = await database.sessions.answer({ gameSessionId: socket.data.player.gameSessionId, participantId: socket.data.player.participantId, questionRef: parsed.data.questionId, selectedOptionRef: parsed.data.optionId });
    return ackOk({ answered: true, pointsAwarded: result.pointsAwarded });
  }
  async function nextGame(socket, payload) {
    const parsed = lobbySchemas.gameNext.safeParse(payload);
    if (!parsed.success || socket.data.hostRoomCode !== parsed.data.roomCode || !socket.data.host) throw new DomainError("UNAUTHORIZED");
    const session = await database.sessions.getByCode(parsed.data.roomCode);
    if (!session) throw new DomainError("SESSION_NOT_FOUND");
    const round = session.currentQuestionIndex + 1;
    const locked = await withLock(publisher, gameLockKey(parsed.data.roomCode, round), GAME_LOCK_TTL_MS, async () => {
      const current = await database.sessions.getByCode(parsed.data.roomCode);
      if (!current || current.matchPhase !== "QUESTION_RESULT") throw new DomainError("INVALID_STATE");
      return database.sessions.nextQuestion(current.id);
    });
    if (!locked.acquired) throw new DomainError("INVALID_STATE");
    const next = locked.value;
    if (next.finished) {
      const ranking = next.ranking.map(({ id, displayName, score }) => ({ id, displayName, score }));
      io.to(parsed.data.roomCode).emit(EVENTS.GAME_FINISHED, { ranking });
      io.to(parsed.data.roomCode).emit(EVENTS.GAME_RANKING, ranking);
      return ackOk({ finished: true, ranking });
    }
    scheduleQuestion(parsed.data.roomCode, next.session.questionEndsAt);
    return ackOk({ finished: false, match: await publishMatch(parsed.data.roomCode) });
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
    bindCommand(socket, EVENTS.ROOM_LIST, listRooms);
    bindCommand(socket, EVENTS.ROOM_WATCH, watchQuiz);
    bindCommand(socket, EVENTS.ROOM_UNWATCH, unwatchQuiz);
    bindCommand(socket, EVENTS.GAME_START, startGame);
    bindCommand(socket, EVENTS.GAME_ANSWER, answerGame);
    bindCommand(socket, EVENTS.GAME_NEXT, nextGame);
    socket.on("disconnect", async () => {
      if (closingState) return;
      if (socket.data.hostRoomCode && activeHosts.get(socket.data.hostRoomCode) === socket) activeHosts.delete(socket.data.hostRoomCode);
      const player = socket.data.player;
      if (!player) return;
      if (activePlayers.get(player.participantId) !== socket) return;
      activePlayers.delete(player.participantId);
      try { await database.sessions.disconnectParticipant(player.gameSessionId, player.participantId); await markPresence(player.roomCode, player.participantId, false); const current = await database.sessions.getByCode(player.roomCode); if (current?.matchPhase === "LOBBY") await publish(player.roomCode); else if (current) await publishMatch(player.roomCode, { emitQuestion: false }); }
      catch (error) { logger.error(`[lobby] disconnect: ${mapError(error)}`); }
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
