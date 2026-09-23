import { z } from "zod";
import { DomainError, parse, transaction } from "@quizarena/database";
import { QUIZ_GAME_KEY } from "./legacy-compat.js";

// The Quiz's configuration of a room: which published quiz is its theme.
// Source of truth: QuizRoomConfiguration (1:1 with Room). Room.quizId is a
// legacy mirror (see legacy-compat.js).
export function createQuizRoomConfiguration({ client, platform, compat }) {
  // The quiz id for a room row, or null. Reads the module table; a room that
  // only has the legacy column (set by an old instance) is materialized once,
  // visibly, and a mirror that disagrees with the module table is reported.
  async function quizIdFor(db, room) {
    const configuration = await db.quizRoomConfiguration.findUnique({ where: { roomId: room.id } });
    if (configuration) {
      if (compat.mirror && (room.quizId ?? null) !== configuration.quizId) {
        compat.diverged("room", room.number, { legacyQuizId: room.quizId ?? null, quizId: configuration.quizId });
      }
      return configuration.quizId;
    }
    if (!compat.fallback || !room.quizId || room.gameKey !== QUIZ_GAME_KEY) return null;
    await db.quizRoomConfiguration.createMany({ data: [{ roomId: room.id, gameKey: QUIZ_GAME_KEY, quizId: room.quizId }], skipDuplicates: true });
    compat.fellBack("room", room.number);
    return room.quizId;
  }
  return {
    quizIdFor,
    // { quizId, quizTitle } of one room number, for the room's public projection.
    async themeOf(number) {
      const room = await client.room.findUnique({ where: { number } });
      if (!room) return { quizId: null, quizTitle: null };
      const quizId = await quizIdFor(client, room);
      const quiz = quizId ? await client.quiz.findUnique({ where: { id: quizId }, select: { title: true } }) : null;
      return { quizId: quiz ? quizId : null, quizTitle: quiz?.title ?? null };
    },
    // The same for many rooms in two queries (the room index is rebuilt often).
    async themesOf(rooms) {
      const numbers = rooms.map((room) => room.number);
      const rows = await client.room.findMany({ where: { number: { in: numbers }, gameKey: QUIZ_GAME_KEY }, include: { quizConfiguration: true } });
      const themes = new Map(numbers.map((number) => [number, { quizId: null, quizTitle: null }]));
      const pending = [];
      for (const row of rows) {
        if (row.quizConfiguration) {
          if (compat.mirror && (row.quizId ?? null) !== row.quizConfiguration.quizId) compat.diverged("room", row.number, { legacyQuizId: row.quizId ?? null, quizId: row.quizConfiguration.quizId });
          pending.push([row.number, row.quizConfiguration.quizId]);
        } else if (compat.fallback && row.quizId) pending.push([row.number, await quizIdFor(client, row)]);
      }
      const quizzes = await client.quiz.findMany({ where: { id: { in: pending.map(([, id]) => id).filter(Boolean) } }, select: { id: true, title: true } });
      const titles = new Map(quizzes.map((quiz) => [quiz.id, quiz.title]));
      for (const [number, quizId] of pending) if (quizId && titles.has(quizId)) themes.set(number, { quizId, quizTitle: titles.get(quizId) });
      return themes;
    },
    async select(number, quizId) {
      return transaction(client, async (tx) => {
        const room = await tx.room.findUnique({ where: { number } });
        if (!room) throw new DomainError("ROOM_NOT_FOUND");
        // Only a Quiz room can be configured with a quiz (the composite FK
        // enforces it too; this gives a clean error instead of a constraint).
        if (room.gameKey !== QUIZ_GAME_KEY) throw new DomainError("ROOM_NOT_FOUND");
        if (room.status !== "OPEN") throw new DomainError("ROOM_NOT_WAITING");
        platform.policy.requireAvailable(room.gameKey);
        const quiz = await tx.quiz.findUnique({ where: { id: parse(z.uuid(), quizId, "QUIZ_NOT_FOUND") } });
        if (!quiz) throw new DomainError("QUIZ_NOT_FOUND");
        if (quiz.status !== "PUBLISHED") throw new DomainError("QUIZ_NOT_PUBLISHED");
        await tx.quizRoomConfiguration.upsert({ where: { roomId: room.id }, update: { quizId: quiz.id }, create: { roomId: room.id, gameKey: QUIZ_GAME_KEY, quizId: quiz.id } });
        if (compat.mirror) await tx.room.update({ where: { id: room.id }, data: { quizId: quiz.id } });
        return { number: room.number, quizId: quiz.id, quizTitle: quiz.title };
      });
    },
    // Clears the theme (used by tests and tooling that reset a room).
    async clear(number) {
      const room = await client.room.findUnique({ where: { number } });
      if (!room) return;
      await client.$transaction([client.quizRoomConfiguration.deleteMany({ where: { roomId: room.id } }), client.room.update({ where: { id: room.id }, data: { quizId: null } })]);
    },
  };
}
