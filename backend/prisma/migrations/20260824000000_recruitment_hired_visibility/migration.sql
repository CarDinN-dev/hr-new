ALTER TABLE "RecruitmentCandidate"
  ADD COLUMN "hiredAt" TIMESTAMP(3);

UPDATE "RecruitmentCandidate"
SET "hiredAt" = "updatedAt"
WHERE "stage" = 'HIRED'
  AND "hiredAt" IS NULL;
