-- A cancellation bypasses the active approval step; it is not an approver rejection.
UPDATE "LeaveApprovalStep" AS step
SET "status" = 'SKIPPED'::"LeaveStepStatus",
    "version" = step."version" + 1
FROM "LeaveDecision" AS decision
WHERE decision."stepId" = step."id"
  AND decision."toStatus" = 'CANCELLED'::"LeaveRequestStatus"
  AND step."status" = 'REJECTED'::"LeaveStepStatus";

-- Closed and superseded workflow versions cannot retain actionable steps.
UPDATE "LeaveApprovalStep" AS step
SET "status" = 'SKIPPED'::"LeaveStepStatus",
    "version" = step."version" + 1
FROM "LeaveRequest" AS request
WHERE step."requestId" = request."id"
  AND step."status" = 'PENDING'::"LeaveStepStatus"
  AND (
    step."workflowVersion" < request."workflowVersion"
    OR request."status" IN (
      'APPROVED'::"LeaveRequestStatus",
      'REJECTED'::"LeaveRequestStatus",
      'CANCELLED'::"LeaveRequestStatus",
      'RETURNED_FOR_CORRECTION'::"LeaveRequestStatus"
    )
  );
