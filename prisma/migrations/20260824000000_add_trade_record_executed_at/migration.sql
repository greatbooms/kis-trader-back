-- 체결 확인 시각. 기존 행은 NULL(=미상)으로 남기고 백필하지 않는다.
-- createdAt(주문 제출 시각)과 구분해 UI에 함께 노출하기 위한 컬럼.
ALTER TABLE "trade_records" ADD COLUMN "executed_at" TIMESTAMP(3);
