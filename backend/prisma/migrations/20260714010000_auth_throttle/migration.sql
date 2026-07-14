CREATE TABLE "AuthThrottle" (
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "resetAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthThrottle_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "AuthThrottle_resetAt_idx" ON "AuthThrottle"("resetAt");
