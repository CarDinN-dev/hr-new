CREATE TABLE "HrConsoleStateBackup" (
    "id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "stateUpdatedAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrConsoleStateBackup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HrConsoleStateBackup_createdAt_idx" ON "HrConsoleStateBackup"("createdAt");
