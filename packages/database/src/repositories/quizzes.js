const include = {
  questions: {
    orderBy: { position: "asc" },
    include: { options: { orderBy: { position: "asc" } } },
  },
};
export function quizRepository(db) {
  return {
    create: (data) => db.quiz.create({ data }),
    get: (id) => db.quiz.findUnique({ where: { id }, include }),
    list: (status) =>
      db.quiz.findMany({
        where: { status },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
    addQuestion: (quizId, { options, ...question }) =>
      db.question.create({
        data: { ...question, quizId, options: { create: options } },
        include: { options: { orderBy: { position: "asc" } } },
      }),
    publish: (id) =>
      db.quiz.update({
        where: { id },
        data: { status: "PUBLISHED", publishedAt: new Date() },
      }),
    archive: (id) =>
      db.quiz.update({
        where: { id },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      }),
  };
}
