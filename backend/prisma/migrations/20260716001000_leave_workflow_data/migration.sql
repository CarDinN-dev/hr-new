UPDATE "LeaveRequest" AS request
SET "status" = CASE
  WHEN employee."managerId" IS NULL THEN 'PENDING_HR'::"LeaveRequestStatus"
  ELSE 'PENDING_MANAGER'::"LeaveRequestStatus"
END
FROM "Employee" AS employee
WHERE request."employeeId" = employee."id"
  AND request."status" = 'PENDING'::"LeaveRequestStatus";

ALTER TABLE "LeaveRequest" ALTER COLUMN "status" DROP DEFAULT;
