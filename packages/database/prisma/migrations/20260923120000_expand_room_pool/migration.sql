-- Expand the fixed room pool from 12 to 24. Additive and idempotent:
-- rooms 1-12 are untouched, this only adds rooms that don't exist yet.
INSERT INTO "Room" ("id", "number")
SELECT gen_random_uuid(), n
FROM generate_series(1, 24) AS n
WHERE NOT EXISTS (SELECT 1 FROM "Room" WHERE "Room"."number" = n);
