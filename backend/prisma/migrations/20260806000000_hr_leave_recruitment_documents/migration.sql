ALTER TABLE "LeaveRequest"
  ADD COLUMN "paidDays" DECIMAL(5,2) NOT NULL DEFAULT 0;

UPDATE "LeaveRequest" request
SET "paidDays" = CASE WHEN type."isPaid" THEN request."totalDays" ELSE 0 END
FROM "LeaveType" type
WHERE type."id" = request."leaveTypeId";

ALTER TABLE "LeaveRequest"
  ADD CONSTRAINT "LeaveRequest_paid_days_valid"
  CHECK ("paidDays" >= 0 AND "paidDays" <= "totalDays");

ALTER TABLE "EmployeeDocument" ADD COLUMN "leaveRequestId" TEXT;
CREATE INDEX "EmployeeDocument_leaveRequestId_idx" ON "EmployeeDocument"("leaveRequestId");
ALTER TABLE "EmployeeDocument"
  ADD CONSTRAINT "EmployeeDocument_leaveRequestId_fkey"
  FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RecruitmentCandidate"
  ADD COLUMN "interviewAssessment" JSONB,
  ADD COLUMN "offerDetails" JSONB;

-- Consolidate active leave types whose names differ only by whitespace or case.
CREATE TEMP TABLE "_LeaveTypeMerge" ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY lower(btrim("name"))
      ORDER BY "createdAt", "id"
    ) AS "keeperId",
    row_number() OVER (
      PARTITION BY lower(btrim("name"))
      ORDER BY "createdAt", "id"
    ) AS "position"
  FROM "LeaveType"
  WHERE "deletedAt" IS NULL
)
SELECT "id" AS "duplicateId", "keeperId"
FROM ranked
WHERE "position" > 1;

UPDATE "LeaveRequest" request
SET "leaveTypeId" = merge."keeperId"
FROM "_LeaveTypeMerge" merge
WHERE request."leaveTypeId" = merge."duplicateId";

CREATE TEMP TABLE "_LeaveBalanceMerge" ON COMMIT DROP AS
WITH involved AS (
  SELECT "duplicateId" AS "sourceId", "keeperId" AS "targetId" FROM "_LeaveTypeMerge"
  UNION ALL
  SELECT DISTINCT "keeperId", "keeperId" FROM "_LeaveTypeMerge"
), grouped AS (
  SELECT
    balance."employeeId",
    balance."year",
    involved."targetId",
    (array_agg(
      balance."id"
      ORDER BY (balance."leaveTypeId" = involved."targetId") DESC,
               (balance."deletedAt" IS NULL) DESC,
               balance."createdAt",
               balance."id"
    ))[1] AS "keepBalanceId",
    greatest(
      coalesce(max(balance."totalDays") FILTER (WHERE balance."deletedAt" IS NULL), 0),
      coalesce(sum(balance."usedDays") FILTER (WHERE balance."deletedAt" IS NULL), 0)
        + coalesce(sum(balance."pendingDays") FILTER (WHERE balance."deletedAt" IS NULL), 0)
    ) AS "totalDays",
    coalesce(sum(balance."usedDays") FILTER (WHERE balance."deletedAt" IS NULL), 0) AS "usedDays",
    coalesce(sum(balance."pendingDays") FILTER (WHERE balance."deletedAt" IS NULL), 0) AS "pendingDays"
  FROM "LeaveBalance" balance
  JOIN involved ON involved."sourceId" = balance."leaveTypeId"
  GROUP BY balance."employeeId", balance."year", involved."targetId"
  HAVING bool_or(balance."deletedAt" IS NULL)
)
SELECT * FROM grouped;

UPDATE "LeaveBalance" balance
SET "deletedAt" = CURRENT_TIMESTAMP,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_LeaveBalanceMerge" merge
WHERE balance."employeeId" = merge."employeeId"
  AND balance."year" = merge."year"
  AND balance."leaveTypeId" IN (
    SELECT "sourceId" FROM (
      SELECT "duplicateId" AS "sourceId", "keeperId" AS "targetId" FROM "_LeaveTypeMerge"
      UNION ALL SELECT "keeperId", "keeperId" FROM "_LeaveTypeMerge"
    ) involved
    WHERE involved."targetId" = merge."targetId"
  )
  AND balance."id" <> merge."keepBalanceId";

UPDATE "LeaveBalance" balance
SET "leaveTypeId" = merge."targetId",
    "totalDays" = merge."totalDays",
    "usedDays" = merge."usedDays",
    "pendingDays" = merge."pendingDays",
    "deletedAt" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_LeaveBalanceMerge" merge
WHERE balance."id" = merge."keepBalanceId";

UPDATE "LeaveType" type
SET "deletedAt" = CURRENT_TIMESTAMP,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_LeaveTypeMerge" merge
WHERE type."id" = merge."duplicateId";

DROP INDEX "LeaveType_name_key";
CREATE UNIQUE INDEX "LeaveType_active_normalized_name_key"
  ON "LeaveType" (lower(btrim("name")))
  WHERE "deletedAt" IS NULL;

UPDATE "LeaveType" type
SET "deletedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
WHERE type."deletedAt" IS NOT NULL
  AND type."code" IN ('SICK', 'UNPAID', 'UMRAH_HAJJ', 'COMPASSIONATE', 'MATERNITY')
  AND NOT EXISTS (
    SELECT 1 FROM "LeaveType" active
    WHERE active."deletedAt" IS NULL
      AND lower(btrim(active."name")) = lower(btrim(type."name"))
  );

INSERT INTO "LeaveType" (
  "id", "name", "code", "description", "annualAllowanceDays",
  "isPaid", "requiresAttachment", "createdAt", "updatedAt"
)
SELECT seed.*
FROM (VALUES
  ('7397cf79-070e-4ee1-8919-b97931e74b85', 'Sick Leave', 'SICK', 'Paid sick leave; supporting document required.', 14.00, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('9dbc433e-e698-4020-928f-1ffc693a8297', 'Unpaid Leave', 'UNPAID', 'Unpaid calendar-day leave.', 0.00, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('9e4cc124-e82b-48cd-a8cc-ced1b090e27a', 'Umrah/Hajj', 'UMRAH_HAJJ', 'Unpaid pilgrimage leave counted in calendar days.', 0.00, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('f5d0b92b-ffef-4e99-96de-af5159519063', 'Compassionate Leave', 'COMPASSIONATE', 'First three working days paid; remaining working days unpaid.', 3.00, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('617b7ab2-81cb-4a6c-a5c7-b590c730cf1a', 'Maternity Leave', 'MATERNITY', 'Fifty paid calendar days after one completed service year.', 50.00, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
) AS seed("id", "name", "code", "description", "annualAllowanceDays", "isPaid", "requiresAttachment", "createdAt", "updatedAt")
WHERE NOT EXISTS (
  SELECT 1 FROM "LeaveType" existing
  WHERE existing."code" = seed."code"
     OR (existing."deletedAt" IS NULL AND lower(btrim(existing."name")) = lower(btrim(seed."name")))
);

UPDATE "LeaveType"
SET "isPaid" = true, "requiresAttachment" = true, "updatedAt" = CURRENT_TIMESTAMP
WHERE "deletedAt" IS NULL
  AND ("code" = 'SICK' OR lower(btrim("name")) IN ('sick', 'sick leave'));

UPDATE "LeaveType"
SET "annualAllowanceDays" = 0, "isPaid" = false, "requiresAttachment" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "deletedAt" IS NULL
  AND ("code" IN ('UNPAID', 'UMRAH_HAJJ') OR lower(btrim("name")) IN ('unpaid', 'unpaid leave', 'umrah/hajj', 'umrah hajj'));

UPDATE "LeaveType"
SET "annualAllowanceDays" = 3, "isPaid" = true, "requiresAttachment" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "deletedAt" IS NULL
  AND ("code" = 'COMPASSIONATE' OR lower(btrim("name")) = 'compassionate leave');

UPDATE "LeaveType"
SET "annualAllowanceDays" = 50, "isPaid" = true, "requiresAttachment" = true, "updatedAt" = CURRENT_TIMESTAMP
WHERE "deletedAt" IS NULL
  AND ("code" = 'MATERNITY' OR lower(btrim("name")) = 'maternity leave');
