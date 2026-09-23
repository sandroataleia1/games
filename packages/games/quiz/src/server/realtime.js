import { DomainError } from "@quizarena/database";
import { EVENTS, lobbySchemas, publicRoomSchema, publicMatchStateSchema } from "@quizarena/contracts";
import { QUIZ_GAME_KEY } from "./legacy-compat.js";

const GAME_LOCK_TTL_MS = 120000;

function gameLockKey(sessionId, round) { return `quizarena:lobby:game:lock:${sessionId}:${round}`; }
function publicQuestion(session) {
  if (session.matchPhase !== "QUESTION") return null;
  const question = session.quizSnapshot.questions[session.currentQuestionIndex];
  return { id: question.id, prompt: question.prompt, options: question.options.map(({ id, position, text }) => ({ id, position, text })), round: session.currentQuestionIndex + 1, totalRounds: session.quizSnapshot.questions.length, durationSeconds: question.durationSeconds, startedAt: session.questionStartedAt.toISOString(), endsAt: session.questionEndsAt.toISOString(), phase: "QUESTION" };
}

// The Quiz's realtime behaviour, plugged into the generic realtime host. The
// host owns rooms, presence, authorization, locks and recovery; everything below
// is the Quiz's own protocol: quiz list, theme, answers, question timing,
// results. Events keep their v1 names and ACKs. Timers live here, not in the host.
export function createQuizRealtime({ quiz, resultAdvanceMs = 45000 }) {
  let host = null;
  const timers = new Map();

  function clearTimer(sessionId) {
    const previous = timers.get(sessionId);
    if (previous) { clearTimeout(previous); timers.delete(sessionId); }
  }
  function schedule(sessionId, delayMs, run, label) {
    clearTimer(sessionId);
    timers.set(sessionId, setTimeout(() => run().catch((error) => host.logger.error(`[quiz] ${label}: ${error instanceof DomainError ? error.code : "INTERNAL_ERROR"}`)), delayMs));
  }
  function scheduleQuestion(roomNumber, sessionId, endsAt) {
    const endsAtMs = endsAt instanceof Date ? endsAt.getTime() : new Date(endsAt).getTime();
    schedule(sessionId, Math.max(10, endsAtMs - Date.now()), () => finishQuestion(roomNumber, sessionId), "timer");
  }
  function scheduleResultAdvance(roomNumber, sessionId) {
    // Nobody may ever click "Avançar" (disconnected, distracted); force the
    // match forward after a grace period instead of leaving the room PLAYING
    // against a session that will never progress on its own.
    schedule(sessionId, resultAdvanceMs, () => advanceMatch(roomNumber, sessionId), "result timer");
  }

  async function matchState(roomNumber, sessionId) {
    await host.ensureReady();
    const current = await quiz.matches.currentQuestion(sessionId);
    return publicMatchStateSchema.parse({ schemaVersion: 1, roomNumber, gameKey: current.session.gameKey, phase: current.session.matchPhase, round: current.session.currentQuestionIndex == null ? 0 : current.session.currentQuestionIndex + 1, totalRounds: current.session.quizSnapshot.questions.length, question: publicQuestion(current.session), answeredCount: current.answers.length, playerCount: current.session.participants.length, serverTime: new Date().toISOString() });
  }
  async function publishMatch(roomNumber, sessionId, { emitQuestion = true } = {}) {
    const current = await matchState(roomNumber, sessionId);
    host.emit(roomNumber, EVENTS.GAME_STATE, current);
    if (emitQuestion && current.question) host.emit(roomNumber, EVENTS.GAME_QUESTION, current.question);
    return current;
  }
  async function finishQuestion(roomNumber, sessionId, { force = false } = {}) {
    const session = await quiz.matches.getById(sessionId).catch(() => null);
    if (!session || session.matchPhase !== "QUESTION") return;
    const round = session.currentQuestionIndex + 1;
    if (!force && session.questionEndsAt && Date.now() < new Date(session.questionEndsAt).getTime()) { scheduleQuestion(roomNumber, sessionId, session.questionEndsAt); return; }
    const locked = await host.withLock(gameLockKey(sessionId, round), GAME_LOCK_TTL_MS, async () => {
      const current = await quiz.matches.getById(sessionId).catch(() => null);
      if (!current || current.matchPhase !== "QUESTION") return;
      return quiz.matches.questionResult(sessionId);
    });
    if (!locked.acquired || !locked.value) return;
    const result = locked.value;
    const ranking = result.ranking.map(({ id, displayName, score }) => ({ id, displayName, score }));
    const distribution = result.answers.reduce((counts, answer) => { counts[answer.selectedOptionRef] = (counts[answer.selectedOptionRef] || 0) + 1; return counts; }, {});
    for (const socket of await host.socketsIn(roomNumber)) {
      const own = socket.data.player ? result.answers.find(({ participantId }) => participantId === socket.data.player.participantId) : null;
      socket.emit(EVENTS.GAME_QUESTION_RESULT, { round, correctOptionId: result.question.correctOptionId, distribution, ownResult: own ? { isCorrect: own.isCorrect, pointsAwarded: own.pointsAwarded, responseTimeMs: own.responseTimeMs } : null, ranking });
    }
    host.emit(roomNumber, EVENTS.GAME_RANKING, ranking);
    await publishMatch(roomNumber, sessionId);
    scheduleResultAdvance(roomNumber, sessionId);
  }
  async function advanceMatch(roomNumber, sessionId) {
    const session = await quiz.matches.getById(sessionId);
    const round = session.currentQuestionIndex + 1;
    const locked = await host.withLock(gameLockKey(sessionId, round), GAME_LOCK_TTL_MS, async () => {
      const current = await quiz.matches.getById(sessionId);
      if (current.matchPhase !== "QUESTION_RESULT") throw new DomainError("INVALID_STATE");
      return quiz.matches.nextQuestion(sessionId);
    });
    if (!locked.acquired) throw new DomainError("INVALID_STATE");
    const next = locked.value;
    if (next.finished) {
      const ranking = next.ranking.map(({ id, displayName, score }) => ({ id, displayName, score }));
      clearTimer(sessionId);
      host.emit(roomNumber, EVENTS.GAME_FINISHED, { ranking });
      host.emit(roomNumber, EVENTS.GAME_RANKING, ranking);
      await host.releaseRoom(session.roomId, sessionId);
      await host.broadcastRoom(roomNumber);
      await host.broadcastIndex();
      return { finished: true, ranking };
    }
    scheduleQuestion(roomNumber, sessionId, next.session.questionEndsAt);
    return { finished: false, match: await publishMatch(roomNumber, sessionId) };
  }
  async function finishIfAbandoned(sessionId) {
    const finished = await quiz.matches.abandonIfEmpty(sessionId).catch(() => null);
    if (!finished) return;
    clearTimer(sessionId);
    if (finished.roomId) await host.releaseRoom(finished.roomId, sessionId).catch(() => {});
  }
  // Sockets learn they are a participant lazily: with the Redis adapter,
  // fetchSockets() across instances only returns mutable data for sockets local
  // to this process, so eagerly mutating remote sockets would silently no-op.
  async function attachIfParticipant(socket, roomNumber, sessionId) {
    if (socket.data.player?.roomNumber === roomNumber) return socket.data.player;
    if (!socket.data.organizer) return null;
    const existing = await quiz.matches.resumePresenceForAccount(sessionId, socket.data.organizer.id).catch(() => null);
    if (!existing) return null;
    socket.data.player = { roomNumber, participantId: existing.id, gameSessionId: sessionId };
    return socket.data.player;
  }
  async function ensurePlayer(socket, roomNumber) {
    if (socket.data.roomNumber !== roomNumber) return false;
    const room = await host.platform.rooms.get(roomNumber).catch(() => null);
    if (!room?.currentSessionId || room.gameKey !== QUIZ_GAME_KEY) { socket.data.player = null; return false; }
    if (socket.data.player?.roomNumber === roomNumber && socket.data.player.gameSessionId === room.currentSessionId) return true;
    return Boolean(await attachIfParticipant(socket, roomNumber, room.currentSessionId));
  }
  // The room the socket is in must be a Quiz room, or the command is refused as
  // if the room did not exist (nothing about other games leaks).
  async function requireQuizRoom(socket, roomNumber) {
    if (socket.data.roomNumber !== roomNumber) throw new DomainError("UNAUTHORIZED");
    const room = await host.platform.rooms.get(roomNumber);
    if (room.gameKey !== QUIZ_GAME_KEY) throw new DomainError("ROOM_NOT_FOUND");
    return room;
  }

  async function listQuizzes(socket, payload) {
    if (!lobbySchemas.quizList.safeParse(payload ?? {}).success) throw new DomainError("INVALID_PAYLOAD");
    await host.ensureReady();
    if (!socket.data.organizer) throw new DomainError("UNAUTHENTICATED");
    return { quizzes: await quiz.authoring.publishedAll() };
  }
  async function selectTheme(socket, payload) {
    const parsed = lobbySchemas.themeSelect.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    if (!socket.data.organizer) throw new DomainError("UNAUTHENTICATED");
    await requireQuizRoom(socket, parsed.data.roomNumber);
    await quiz.rooms.select(parsed.data.roomNumber, parsed.data.quizId);
    const state = await host.broadcastRoom(parsed.data.roomNumber);
    await host.broadcastIndex();
    return { room: state };
  }
  async function answerGame(socket, payload) {
    const parsed = lobbySchemas.gameAnswer.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    if (!(await ensurePlayer(socket, parsed.data.roomNumber))) throw new DomainError("UNAUTHORIZED");
    const { gameSessionId, participantId } = socket.data.player;
    const result = await quiz.matches.answer({ gameSessionId, participantId, questionRef: parsed.data.questionId, selectedOptionRef: parsed.data.optionId });
    // Nobody left to wait for: show the result right away instead of holding
    // the room until the question's deadline. The deadline stays only as the
    // safety net for players who never answer.
    const { session, answers } = await quiz.matches.currentQuestion(gameSessionId);
    const activeIds = session.participants.filter((participant) => !participant.disconnectedAt).map((participant) => participant.id);
    if (activeIds.length > 0 && activeIds.every((id) => answers.some((answer) => answer.participantId === id))) {
      await finishQuestion(parsed.data.roomNumber, gameSessionId, { force: true }).catch((error) => host.logger.error(`[quiz] early finish: ${error instanceof DomainError ? error.code : "INTERNAL_ERROR"}`));
    }
    return { answered: true, pointsAwarded: result.pointsAwarded };
  }
  async function nextGame(socket, payload) {
    const parsed = lobbySchemas.gameNext.safeParse(payload);
    if (!parsed.success) throw new DomainError("INVALID_PAYLOAD");
    if (!(await ensurePlayer(socket, parsed.data.roomNumber))) throw new DomainError("UNAUTHORIZED");
    const result = await advanceMatch(parsed.data.roomNumber, socket.data.player.gameSessionId);
    if (result.finished) socket.data.player = null;
    return result;
  }

  return {
    roomProjection: {
      schema: publicRoomSchema,
      // { quizId, quizTitle } per room number, in two queries for the whole index.
      extras: (rooms) => quiz.rooms.themesOf(rooms),
    },
    registerHandlers(hostApi) {
      host = hostApi;
      host.bindCommand(EVENTS.QUIZ_LIST, listQuizzes);
      host.bindCommand(EVENTS.THEME_SELECT, selectTheme);
      host.bindCommand(EVENTS.GAME_ANSWER, answerGame);
      host.bindCommand(EVENTS.GAME_NEXT, nextGame);
    },
    async onRoomEnter({ socket, room }) {
      let match = null;
      if (room.status === "PLAYING" && room.currentSessionId) {
        await attachIfParticipant(socket, room.number, room.currentSessionId);
        match = await matchState(room.number, room.currentSessionId);
      }
      return { match, playing: Boolean(socket.data.player) };
    },
    async onRoomLeave({ socket }) {
      if (!socket.data.player) return;
      const { gameSessionId, participantId } = socket.data.player;
      try { await quiz.matches.disconnectParticipant(gameSessionId, participantId); } catch { /* best effort */ }
      // Nobody left playing: finish the match now instead of leaving the room
      // stuck PLAYING against an abandoned session forever.
      await finishIfAbandoned(gameSessionId);
    },
    // Not a real leave, just a dropped connection (refresh, network blip): keep
    // the match alive so reconnecting resumes it.
    async onSocketDisconnect({ socket }) {
      if (socket.data.player) await quiz.matches.disconnectParticipant(socket.data.player.gameSessionId, socket.data.player.participantId);
    },
    async onMatchStarted({ socket, room, match }) {
      await attachIfParticipant(socket, room.number, match.id);
      const started = await quiz.matches.startMatch(match.id);
      scheduleQuestion(room.number, match.id, started.questionEndsAt);
      return { match: await publishMatch(room.number, match.id) };
    },
    // After a restart: rebuild the timers a live Quiz match needs, from its own state.
    async recoverMatch({ match, room }) {
      const { session } = await quiz.matches.currentQuestion(match.id);
      if (session.matchPhase === "QUESTION") scheduleQuestion(room.number, match.id, session.questionEndsAt);
      else if (session.matchPhase === "QUESTION_RESULT") scheduleResultAdvance(room.number, match.id);
    },
    close() { for (const sessionId of [...timers.keys()]) clearTimer(sessionId); },
  };
}
