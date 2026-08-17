CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "recipientEmail" VARCHAR(320) NOT NULL,
    "subject" VARCHAR(300) NOT NULL,
    "htmlBody" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "lastError" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailDelivery_notificationId_key" ON "EmailDelivery"("notificationId");
CREATE INDEX "EmailDelivery_sentAt_nextAttemptAt_createdAt_idx" ON "EmailDelivery"("sentAt", "nextAttemptAt", "createdAt");

ALTER TABLE "EmailDelivery"
ADD CONSTRAINT "EmailDelivery_notificationId_fkey"
FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
