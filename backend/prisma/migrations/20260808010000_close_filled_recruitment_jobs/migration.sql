UPDATE "RecruitmentJob" AS job
SET
  "status" = 'CLOSED',
  "version" = job."version" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE job."deletedAt" IS NULL
  AND job."status" <> 'CLOSED'
  AND (
    SELECT COUNT(*)
    FROM "RecruitmentCandidate" AS candidate
    WHERE candidate."jobId" = job."id"
      AND candidate."stage" = 'HIRED'
      AND candidate."deletedAt" IS NULL
  ) >= job."openings";
