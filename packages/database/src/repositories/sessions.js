export function sessionRepository(db) {
  const include = { participants: { orderBy: [{ joinedAt: "asc" }, { id: "asc" }] } };
  return {
    create: (data) => db.gameSession.create({ data }),
    get: (id) => db.gameSession.findUnique({ where: { id }, include }),
    byCode: (roomCode) => db.gameSession.findUnique({ where: { roomCode }, include }),
    activeMatches: () => db.gameSession.findMany({ where: { status: "ACTIVE", matchPhase: { in: ["QUESTION", "QUESTION_RESULT"] } }, include }),
    countParticipants: (gameSessionId) => db.participant.count({ where: { gameSessionId } }),
    activeParticipants: (gameSessionId) => db.participant.count({ where: { gameSessionId, disconnectedAt: null } }),
    addParticipant: (data) => db.participant.create({ data }),
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
    updatePresence: (id, gameSessionId, connected) =>
      db.participant.update({
        where: { id_gameSessionId: { id, gameSessionId } },
        data: { lastSeenAt: new Date(), disconnectedAt: connected ? null : new Date() },
      }),
    markLeft: (id, gameSessionId) =>
      db.participant.update({
        where: { id_gameSessionId: { id, gameSessionId } },
        data: { lastSeenAt: new Date(), disconnectedAt: new Date() },
      }),
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
