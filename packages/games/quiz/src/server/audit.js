// READ-ONLY comparison of the Quiz legacy columns (Room.quizId,
// GameSession.{quizId, quizSnapshot, matchPhase, currentQuestionIndex,
// questionStartedAt, questionEndsAt}) with the module tables that replaced them
// as source of truth. It never writes. Only rows whose legacy columns were
// mirrored (quizSnapshot present) are compared field by field, so it stays
// meaningful after the mirror is switched off. Empty findings mean the legacy
// columns can be dropped (the "contract" migration, ADR-009).
const SAMPLE = 20;

export async function auditQuizLegacy(client) {
  const q = (sql) => client.$queryRawUnsafe(sql);
  const findings = {
    roomsWithLegacyThemeButNoConfiguration: await q(`SELECT r."number" AS id FROM "Room" r LEFT JOIN "QuizRoomConfiguration" c ON c."roomId" = r."id" WHERE r."quizId" IS NOT NULL AND c."roomId" IS NULL ORDER BY r."number" LIMIT ${SAMPLE}`),
    roomsWhoseLegacyThemeDiffers: await q(`SELECT r."number" AS id FROM "Room" r JOIN "QuizRoomConfiguration" c ON c."roomId" = r."id" WHERE r."quizId" IS DISTINCT FROM c."quizId" ORDER BY r."number" LIMIT ${SAMPLE}`),
    quizMatchesWithoutState: await q(`SELECT g."id" FROM "GameSession" g LEFT JOIN "QuizMatchState" s ON s."matchId" = g."id" WHERE g."gameKey" = 'quiz' AND s."matchId" IS NULL ORDER BY g."createdAt" LIMIT ${SAMPLE}`),
    matchesWhoseLegacyStateDiffers: await q(`SELECT g."id" FROM "GameSession" g JOIN "QuizMatchState" s ON s."matchId" = g."id" WHERE g."quizSnapshot" IS NOT NULL AND (g."quizId" IS DISTINCT FROM s."quizId" OR g."quizSnapshot" IS DISTINCT FROM s."quizSnapshot" OR g."matchPhase" IS DISTINCT FROM s."matchPhase" OR g."currentQuestionIndex" IS DISTINCT FROM s."currentQuestionIndex" OR g."questionStartedAt" IS DISTINCT FROM s."questionStartedAt" OR g."questionEndsAt" IS DISTINCT FROM s."questionEndsAt") ORDER BY g."createdAt" LIMIT ${SAMPLE}`),
    participantsWithoutPlatformRecord: await q(`SELECT p."id" FROM "Participant" p LEFT JOIN "MatchParticipant" m ON m."id" = p."id" WHERE m."id" IS NULL LIMIT ${SAMPLE}`),
  };
  const totals = {
    rooms: Number((await q(`SELECT count(*) AS n FROM "Room" WHERE "gameKey" = 'quiz'`))[0].n),
    configurations: Number((await q(`SELECT count(*) AS n FROM "QuizRoomConfiguration"`))[0].n),
    quizMatches: Number((await q(`SELECT count(*) AS n FROM "GameSession" WHERE "gameKey" = 'quiz'`))[0].n),
    matchStates: Number((await q(`SELECT count(*) AS n FROM "QuizMatchState"`))[0].n),
  };
  const clean = Object.values(findings).every((rows) => rows.length === 0);
  return { ok: clean, totals, findings };
}
