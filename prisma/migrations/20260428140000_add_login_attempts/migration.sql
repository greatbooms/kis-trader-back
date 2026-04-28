-- CreateTable
CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "client_key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "first_attempt_at" TIMESTAMP(3) NOT NULL,
    "blocked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "login_attempts_client_key_key" ON "login_attempts"("client_key");
