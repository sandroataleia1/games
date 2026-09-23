-- PLATFORM-07B (part 3): the root check on the Quiz snapshot must allow a match
-- that has no Quiz state at all (any other game). Same rule as before for a
-- match that has Quiz state: the constraint is replaced by "no Quiz state at
-- all, OR exactly the previous validation". Every existing row already
-- satisfies the second branch, so nothing is rewritten.
ALTER TABLE "GameSession" DROP CONSTRAINT "GameSession_snapshot_root_valid";
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_snapshot_root_valid"
  CHECK (
    ("quizSnapshot" IS NULL AND "quizId" IS NULL)
    OR COALESCE(jsonb_typeof("quizSnapshot") = 'object'
      AND "quizSnapshot" -> 'schemaVersion' = '1'::jsonb
      AND "quizSnapshot" ->> 'quizId' = "quizId"::text
      AND CASE WHEN jsonb_typeof("quizSnapshot" -> 'questions') = 'array'
        THEN jsonb_array_length("quizSnapshot" -> 'questions') > 0 ELSE FALSE END, FALSE)
  );
