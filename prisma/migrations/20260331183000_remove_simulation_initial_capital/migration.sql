-- Backfill missing quota from the previous initial capital before removing the column
UPDATE "simulation_sessions"
SET "quota" = COALESCE("quota", "initial_capital");

-- Guard against unexpected NULL quota values
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "simulation_sessions" WHERE "quota" IS NULL) THEN
    RAISE EXCEPTION 'simulation_sessions.quota contains NULL after backfill';
  END IF;
END $$;

ALTER TABLE "simulation_sessions"
ALTER COLUMN "quota" SET NOT NULL,
DROP COLUMN "initial_capital";
