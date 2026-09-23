// Quiz-specific per-participant state (score, answers, reconnect token) for an
// existing platform MatchParticipant. It shares the platform record's id;
// userId/joinedAt on the row are legacy copies of that record, written here and
// nowhere else. The platform's own participant service is injected.
export function createQuizParticipantState(db, { matchParticipant, displayName, normalizedName, reconnectTokenHash }) {
  return db.quizParticipantState.create({
    data: { id: matchParticipant.id, matchParticipantId: matchParticipant.id, gameSessionId: matchParticipant.gameSessionId, userId: matchParticipant.userId, displayName, normalizedName, reconnectTokenHash, joinedAt: matchParticipant.joinedAt },
  });
}

export function quizParticipantRepository(db, platformParticipants) {
  return {
    count: (gameSessionId) => db.quizParticipantState.count({ where: { gameSessionId } }),
    activeCount: (gameSessionId) => db.quizParticipantState.count({ where: { gameSessionId, disconnectedAt: null } }),
    // Platform record first, then the Quiz state that shares its id.
    add: async ({ gameSessionId, userId = null, displayName, normalizedName, reconnectTokenHash }) => {
      const matchParticipant = await platformParticipants.add(db, { matchId: gameSessionId, userId });
      return createQuizParticipantState(db, { matchParticipant, displayName, normalizedName, reconnectTokenHash });
    },
    get: (id, gameSessionId) => db.quizParticipantState.findUnique({ where: { id_gameSessionId: { id, gameSessionId } } }),
    byUser: (gameSessionId, userId) => db.quizParticipantState.findUnique({ where: { gameSessionId_userId: { gameSessionId, userId } } }),
    // Presence only. A dropped connection is NOT a leave (ADR-009): the durable
    // disconnectedAt marker is legacy and kept for the "active participants"
    // rule; coming back also cancels an earlier explicit leave.
    updatePresence: async (id, gameSessionId, connected) => {
      const row = await db.quizParticipantState.update({
        where: { id_gameSessionId: { id, gameSessionId } },
        data: { lastSeenAt: new Date(), disconnectedAt: connected ? null : new Date() },
      });
      if (connected) await platformParticipants.markPresent(db, id, gameSessionId);
      return row;
    },
    // Explicit leave: recorded on the platform record as leftAt.
    markLeft: async (id, gameSessionId) => {
      const row = await db.quizParticipantState.update({
        where: { id_gameSessionId: { id, gameSessionId } },
        data: { lastSeenAt: new Date(), disconnectedAt: new Date() },
      });
      await platformParticipants.markLeft(db, id, gameSessionId);
      return row;
    },
    addScore: (id, gameSessionId, points, seenAt) => db.quizParticipantState.update({ where: { id_gameSessionId: { id, gameSessionId } }, data: { score: { increment: points }, lastSeenAt: seenAt } }),
    ranking: (gameSessionId) => db.quizParticipantState.findMany({ where: { gameSessionId }, orderBy: [{ score: "desc" }, { joinedAt: "asc" }, { id: "asc" }] }),
    answer: (data) => db.answer.create({ data }),
    answersForQuestion: (gameSessionId, questionRef) => db.answer.findMany({ where: { gameSessionId, questionRef }, orderBy: [{ answeredAt: "asc" }, { participantId: "asc" }] }),
  };
}
