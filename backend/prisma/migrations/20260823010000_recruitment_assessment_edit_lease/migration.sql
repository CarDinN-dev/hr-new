ALTER TABLE "RecruitmentCandidate"
  ADD COLUMN "assessmentLockSessionId" VARCHAR(191),
  ADD COLUMN "assessmentLockToken" VARCHAR(36),
  ADD COLUMN "assessmentLockEditor" VARCHAR(200),
  ADD COLUMN "assessmentLockExpiresAt" TIMESTAMP(3);

CREATE INDEX "RecruitmentCandidate_assessmentLockExpiresAt_idx"
  ON "RecruitmentCandidate"("assessmentLockExpiresAt");
