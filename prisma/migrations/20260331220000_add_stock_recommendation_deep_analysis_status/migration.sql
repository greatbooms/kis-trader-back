ALTER TABLE "stock_recommendations"
ADD COLUMN "deep_analysis_status" TEXT,
ADD COLUMN "deep_analysis_message" TEXT,
ADD COLUMN "deep_analysis_updated_at" TIMESTAMP(3);

UPDATE "stock_recommendations"
SET
  "deep_analysis_status" = CASE
    WHEN "deep_analysis_id" IS NOT NULL THEN 'SUCCESS'
    ELSE NULL
  END,
  "deep_analysis_updated_at" = CASE
    WHEN "deep_analysis_id" IS NOT NULL THEN NOW()
    ELSE NULL
  END;
