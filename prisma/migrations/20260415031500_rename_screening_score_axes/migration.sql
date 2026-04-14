TRUNCATE TABLE "stock_recommendations";
TRUNCATE TABLE "stock_deep_analyses";

ALTER TABLE "stock_recommendations"
  RENAME COLUMN "technical_score" TO "trend_score";

ALTER TABLE "stock_recommendations"
  RENAME COLUMN "momentum_score" TO "timing_score";

ALTER TABLE "stock_recommendations"
  ADD COLUMN "risk_supply_score" DECIMAL(6,2) NOT NULL DEFAULT 0;
