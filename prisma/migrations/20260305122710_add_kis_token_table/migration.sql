-- CreateTable
CREATE TABLE "kis_tokens" (
    "id" TEXT NOT NULL DEFAULT 'kis_access_token',
    "access_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kis_tokens_pkey" PRIMARY KEY ("id")
);
