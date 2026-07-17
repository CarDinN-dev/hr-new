ALTER TABLE "Attendance" ALTER COLUMN "approvalStatus" SET DEFAULT 'PENDING';

-- Convert only untouched legacy defaults. A changed version or timestamp may represent
-- a deliberate rejection, which must never be rewritten by this rollout.
UPDATE "Attendance"
SET "approvalStatus" = 'PENDING'
WHERE "approvalStatus" = 'NOT_APPROVED'
  AND "version" = 1
  AND "updatedAt" = "createdAt";
