export function roomRepository(db) {
  const include = { quiz: { select: { id: true, title: true } } };
  return {
    list: () => db.room.findMany({ include, orderBy: { number: "asc" } }),
    byNumber: (number) => db.room.findUnique({ where: { number }, include }),
    byId: (id) => db.room.findUnique({ where: { id }, include }),
    byNumberWithQuestions: (number) =>
      db.room.findUnique({
        where: { number },
        include: { quiz: { include: { questions: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } } } } },
      }),
    setQuiz: (id, quizId) => db.room.update({ where: { id }, data: { quizId } }),
    startMatch: (id, sessionId) => db.room.update({ where: { id }, data: { status: "PLAYING", currentSessionId: sessionId }, include }),
    reopen: (id) => db.room.update({ where: { id }, data: { status: "OPEN", currentSessionId: null }, include }),
  };
}
