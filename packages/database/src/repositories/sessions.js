export function sessionRepository(db) {
  return {
    create: (data) => db.gameSession.create({ data }),
    get: (id) => db.gameSession.findUnique({ where: { id } }),
    byCode: (roomCode) => db.gameSession.findUnique({ where: { roomCode } }),
    addParticipant: (data) => db.participant.create({ data }),
    participant: (id, gameSessionId) =>
      db.participant.findUnique({
        where: { id_gameSessionId: { id, gameSessionId } },
      }),
    addAnswer: (data) => db.answer.create({ data }),
    finish: (id) =>
      db.gameSession.update({
        where: { id },
        data: { status: "FINISHED", finishedAt: new Date() },
      }),
  };
}
