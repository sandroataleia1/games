export function sessionRepository(db) {
  const include = { participants: { orderBy: [{ joinedAt: "asc" }, { id: "asc" }] } };
  return {
    create: (data) => db.gameSession.create({ data }),
    get: (id) => db.gameSession.findUnique({ where: { id }, include }),
    byCode: (roomCode) => db.gameSession.findUnique({ where: { roomCode }, include }),
    countParticipants: (gameSessionId) => db.participant.count({ where: { gameSessionId } }),
    addParticipant: (data) => db.participant.create({ data }),
    participant: (id, gameSessionId) =>
      db.participant.findUnique({
        where: { id_gameSessionId: { id, gameSessionId } },
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
    addAnswer: (data) => db.answer.create({ data }),
    finish: (id) =>
      db.gameSession.update({
        where: { id },
        data: { status: "FINISHED", finishedAt: new Date() },
      }),
  };
}
