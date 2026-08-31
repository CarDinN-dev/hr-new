CREATE TYPE "AnnouncementAttachmentKind" AS ENUM ('INLINE_IMAGE', 'FILE');

ALTER TABLE "Announcement"
ADD COLUMN "contentBlocks" JSONB,
ADD COLUMN "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "emailQueuedAt" TIMESTAMP(3);

CREATE TABLE "AnnouncementAttachment" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "uploadKey" VARCHAR(64) NOT NULL,
    "kind" "AnnouncementAttachmentKind" NOT NULL,
    "fileName" VARCHAR(180) NOT NULL,
    "objectName" TEXT NOT NULL,
    "objectGeneration" TEXT,
    "contentType" VARCHAR(160) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "altText" VARCHAR(300),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "uploadedByUserId" TEXT NOT NULL,
    "scanStatus" "DocumentScanStatus" NOT NULL DEFAULT 'CLEAN',
    "scannedAt" TIMESTAMP(3) NOT NULL,
    "scanResultCode" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AnnouncementAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnnouncementAttachment_objectName_key" ON "AnnouncementAttachment"("objectName");
CREATE UNIQUE INDEX "AnnouncementAttachment_announcementId_uploadKey_key" ON "AnnouncementAttachment"("announcementId", "uploadKey");
CREATE INDEX "AnnouncementAttachment_announcementId_kind_sortOrder_idx" ON "AnnouncementAttachment"("announcementId", "kind", "sortOrder");
CREATE INDEX "AnnouncementAttachment_uploadedByUserId_idx" ON "AnnouncementAttachment"("uploadedByUserId");
CREATE INDEX "AnnouncementAttachment_deletedAt_idx" ON "AnnouncementAttachment"("deletedAt");
CREATE INDEX "Announcement_emailEnabled_emailQueuedAt_publishedAt_idx" ON "Announcement"("emailEnabled", "emailQueuedAt", "publishedAt");

ALTER TABLE "AnnouncementAttachment"
ADD CONSTRAINT "AnnouncementAttachment_announcementId_fkey"
FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnnouncementAttachment"
ADD CONSTRAINT "AnnouncementAttachment_uploadedByUserId_fkey"
FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
