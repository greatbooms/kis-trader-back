-- AlterTable
-- 기존 row는 created_at 시점을 updated_at 초기값으로 사용 (의미적으로 그때가 마지막 "변경" 시점으로 간주)
ALTER TABLE "kis_tokens" ADD COLUMN "updated_at" TIMESTAMP(3);
UPDATE "kis_tokens" SET "updated_at" = COALESCE("created_at", CURRENT_TIMESTAMP);
ALTER TABLE "kis_tokens" ALTER COLUMN "updated_at" SET NOT NULL;
