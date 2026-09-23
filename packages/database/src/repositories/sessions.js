import { createPlatformParticipants } from "../platform/participants.js";

const platformParticipants = createPlatformParticipants();

// Quiz-specific per-participant state (score, answers, reconnect token) for an
// existing platform MatchParticipant. Shares the platform record's id; userId
// and joinedAt are legacy copies of it, written here and nowhere else.
export function createQuizParticipantState(db, { matchParticipant, displayName, normalizedName, reconnectTokenHash }) {
  return db.participant.create({
    data: { id: matchParticipant.id, matchParticipantId: matchParticipant.id, gameSessionId: matchParticipant.gameSessionId, userId: matchParticipant.userId, displayName, normalizedName, reconnectTokenHash, joinedAt: matchParticipant.joinedAt },
  });
}

export function sessionRepository(db) {
  const include = { participants: { orderBy: [{ joinedAt: "asc" }, { id: "asc" }] } };
  return {
    create: (data) => db.gameSession.create({ data }),
    get: (id) => db.gameSession.findUnique({ where: { id }, include }),
    byCode: (roomCode) => db.gameSession.findUnique({ where: { roomCode }, include }),
    activeMatches: () => db.gameSession.findMany({ where: { status: "ACTIVE", matchPhase: { in: ["QUESTION", "QUESTION_RESULT"] } }, include }),
    // Bounded on purpose: at most one live match per room (unique index) and a
    // fixed room pool, so this can never grow past the pool size.
    liveMatches: (take = 200) => db.gameSession.findMany({ where: { status: "ACTIVE", roomId: { not: null } }, include, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take }),
    countParticipants: (gameSessionId) => db.participant.count({ where: { gameSessionId } }),
    activeParticipants: (gameSessionId) => db.participant.count({ where: { gameSessionId, disconnectedAt: null } }),
    // Platform record first, then the Quiz state that shares its id.
    addParticipant: async ({ gameSessionId, userId = null, displayName, normalizedName, reconnectTokenHash }) => {
      const matchParticipant = await platformParticipants.add(db, { matchId: gameSessionId, userId });
      return createQuizParticipantState(db, { matchParticipant, displayName, normalizedName, reconnectTokenHash });
    },
    participant: (id, gameSessionId) =>
      db.participant.findUnique({
        where: { id_gameSessionId: { id, gameSessionId } },
      }),
    participantByUser: (gameSessionId, userId) => db.participant.findUnique({ where: { gameSessionId_userId: { gameSessionId, userId } } }),
    publicRoomsForQuiz: (quizId) =>
      db.gameSession.findMany({
        where: { quizId, visibility: "PUBLIC", status: "WAITING" },
        include: { host: { select: { name: true } }, _count: { select: { participants: { where: { disconnectedAt: null } } } } },
        orderBy: { createdAt: "desc" },
      }),
    updatePresence: async (id, gameSessionId, connected) => {
      const row = await db.participant.update({
        where: { id_gameSessionId: { id, gameSessionId } },
        data: { lastSeenAt: new Date(), disconnectedAt: connected ? null : new Date() },
      });
      // Coming back (resume/re-enter) cancels an earlier explicit leave.
      if (connected) await platformParticipants.markPresent(db, id, gameSessionId);
      return row;
    },
    // Explicit leave: unlike a mere disconnect it is recorded on the platform record.
    markLeft: async (id, gameSessionId) => {
      const row = await db.participant.update({
        where: { id_gameSessionId: { id, gameSessionId } },
        data: { lastSeenAt: new Date(), disconnectedAt: new Date() },
      });
      await platformParticipants.markLeft(db, id, gameSessionId);
      return row;
    },
    startMatch: (id, data) => db.gameSession.update({ where: { id }, data: { status: "ACTIVE", matchPhase: "QUESTION", ...data }, include }),
    setQuestionResult: (id) => db.gameSession.update({ where: { id }, data: { matchPhase: "QUESTION_RESULT" }, include }),
    setNextQuestion: (id, data) => db.gameSession.update({ where: { id }, data: { matchPhase: "QUESTION", ...data }, include }),
    finishMatch: (id) => db.gameSession.update({ where: { id }, data: { status: "FINISHED", matchPhase: "FINISHED", finishedAt: new Date(), questionStartedAt: null, questionEndsAt: null }, include }),
    answer: (data) => db.answer.create({ data }),
    answersForQuestion: (gameSessionId, questionRef) => db.answer.findMany({ where: { gameSessionId, questionRef }, orderBy: [{ answeredAt: "asc" }, { participantId: "asc" }] }),
    ranking: (gameSessionId) => db.participant.findMany({ where: { gameSessionId }, orderBy: [{ score: "desc" }, { joinedAt: "asc" }, { id: "asc" }] }),
    addAnswer: (data) => db.answer.create({ data }),
    finish: (id) =>
      db.gameSession.update({
        where: { id },
        data: { status: "FINISHED", finishedAt: new Date() },
      }),
  };
}
