CREATE TYPE "TripStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CLOSED');
CREATE TYPE "ExpenseStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'PAID');
CREATE TYPE "LoanRepaymentMode" AS ENUM ('DURATION', 'MONTHLY_LIMIT', 'MANUAL');
CREATE TYPE "LoanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'SETTLED', 'CANCELLED');
CREATE TYPE "LoanRepaymentSource" AS ENUM ('PAYROLL', 'MANUAL');
CREATE TYPE "LoanRepaymentStatus" AS ENUM ('POSTED', 'REVERSED');
CREATE TYPE "RecruitmentJobStatus" AS ENUM ('OPEN', 'ON_HOLD', 'CLOSED');
CREATE TYPE "CandidateStage" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED');
CREATE TYPE "EosStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');
CREATE TYPE "PayrollLineKind" AS ENUM ('BASE_SALARY', 'ALLOWANCE', 'BONUS', 'FIXED_DEDUCTION', 'TAX', 'LOSS_OF_PAY', 'LOAN_REPAYMENT', 'MANUAL_ADJUSTMENT');
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'TRANSITION', 'IMPORT', 'ACCESS', 'LOGIN', 'LOGOUT');
CREATE TYPE "AttendanceApprovalStatus" AS ENUM ('APPROVED', 'NOT_APPROVED');
CREATE TYPE "ImportRunStatus" AS ENUM ('DRY_RUN', 'APPLIED', 'FAILED');
CREATE TYPE "ImportItemStatus" AS ENUM ('CREATED', 'SKIPPED', 'INVALID', 'CONFLICT');

ALTER TABLE "Employee" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Attendance" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Attendance" ADD COLUMN "approvalStatus" "AttendanceApprovalStatus" NOT NULL DEFAULT 'NOT_APPROVED';
ALTER TABLE "LeaveRequest" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SalaryRecord" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Payroll" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Announcement" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "EmployeeDocument"
  ALTER COLUMN "fileUrl" SET DEFAULT '',
  ADD COLUMN "documentNumber" TEXT,
  ADD COLUMN "objectName" TEXT,
  ADD COLUMN "objectGeneration" TEXT,
  ADD COLUMN "contentType" TEXT,
  ADD COLUMN "sizeBytes" INTEGER,
  ADD COLUMN "sha256" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "EmployeeDocument_documentNumber_key" ON "EmployeeDocument"("documentNumber");
CREATE UNIQUE INDEX "EmployeeDocument_objectName_key" ON "EmployeeDocument"("objectName");

CREATE TABLE "OrganizationSettings" (
  "id" TEXT NOT NULL DEFAULT 'default', "name" TEXT NOT NULL, "legalName" TEXT NOT NULL,
  "tagline" TEXT, "address" TEXT, "phone" TEXT, "email" TEXT, "website" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'QAR', "wpsEmployerEid" TEXT, "wpsPayerEid" TEXT,
  "wpsPayerQid" TEXT, "wpsPayerBank" TEXT, "wpsPayerIban" TEXT,
  "accountPhoto" TEXT,
  "workdayHours" DECIMAL(5,2) NOT NULL DEFAULT 8, "halfDayHours" DECIMAL(5,2) NOT NULL DEFAULT 4,
  "loanCapType" TEXT NOT NULL DEFAULT 'AMOUNT', "loanCapValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "financialPolicyVersion" INTEGER NOT NULL DEFAULT 1, "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationSettings_hours_valid" CHECK ("workdayHours" > 0 AND "halfDayHours" > 0 AND "halfDayHours" <= "workdayHours") NOT VALID,
  CONSTRAINT "OrganizationSettings_loan_cap_valid" CHECK ("loanCapValue" >= 0) NOT VALID
);

CREATE TABLE "EmployeeProfile" (
  "employeeId" TEXT NOT NULL, "employeeCategory" TEXT, "workShift" TEXT, "company" TEXT,
  "sponsorName" TEXT, "wpsSponsor" TEXT, "gradeBand" TEXT, "familyStatus" TEXT,
  "leavePolicy" TEXT, "lastRejoinDate" TIMESTAMP(3), "businessUnit" TEXT,
  "workingCompanyName" TEXT, "costCentre" TEXT, "nationality" TEXT,
  "residenceProfession" TEXT, "visaType" TEXT, "hireType" TEXT,
  "confirmationDate" TIMESTAMP(3), "esbDate" TIMESTAMP(3), "maritalStatus" TEXT,
  "officeMobile" TEXT, "personalMobile" TEXT, "dependents" INTEGER, "bloodGroup" TEXT,
  "localBuilding" TEXT, "localStreet" TEXT, "localZone" TEXT,
  "internationalApartment" TEXT, "internationalBuilding" TEXT, "internationalFloor" TEXT,
  "internationalStreet" TEXT, "internationalState" TEXT, "internationalCountry" TEXT,
  "internationalZipCode" TEXT, "emergencyRelationship" TEXT, "salaryPayType" TEXT,
  "officeFileNumber" TEXT, "accessCardNumber" TEXT, "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("employeeId")
);

CREATE TABLE "EmployeeBankAccount" (
  "employeeId" TEXT NOT NULL, "bankCode" TEXT, "iban" TEXT, "accountNumber" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "EmployeeBankAccount_pkey" PRIMARY KEY ("employeeId")
);

CREATE TABLE "EmployeeCredential" (
  "id" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "type" TEXT NOT NULL, "number" TEXT,
  "profession" TEXT, "placeOfIssue" TEXT, "issueDate" TIMESTAMP(3), "expiryDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3), CONSTRAINT "EmployeeCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmployeeCredential_employeeId_type_key" ON "EmployeeCredential"("employeeId", "type");
CREATE INDEX "EmployeeCredential_expiryDate_idx" ON "EmployeeCredential"("expiryDate");
CREATE INDEX "EmployeeCredential_deletedAt_idx" ON "EmployeeCredential"("deletedAt");

CREATE TABLE "EmployeeBenefitProfile" (
  "employeeId" TEXT NOT NULL, "travelSector" TEXT, "travelCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "employeeTicketsPerYear" INTEGER NOT NULL DEFAULT 0, "ticketBalancePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "familyTickets" INTEGER NOT NULL DEFAULT 0, "companyAccommodation" BOOLEAN NOT NULL DEFAULT false,
  "companyTransportation" BOOLEAN NOT NULL DEFAULT false, "overtimeEligible" BOOLEAN NOT NULL DEFAULT false,
  "companyFood" BOOLEAN NOT NULL DEFAULT false, "companyFuelCard" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "EmployeeBenefitProfile_pkey" PRIMARY KEY ("employeeId"),
  CONSTRAINT "EmployeeBenefitProfile_values_valid" CHECK ("travelCost" >= 0 AND "ticketBalancePercent" >= 0 AND "ticketBalancePercent" <= 100) NOT VALID
);

CREATE TABLE "EmployeeEducation" (
  "id" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "qualification" TEXT NOT NULL,
  "yearOfPassing" INTEGER, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3),
  CONSTRAINT "EmployeeEducation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeEducation_employeeId_idx" ON "EmployeeEducation"("employeeId");
CREATE INDEX "EmployeeEducation_deletedAt_idx" ON "EmployeeEducation"("deletedAt");

CREATE TABLE "AttendanceCorrection" (
  "id" TEXT NOT NULL, "attendanceId" TEXT NOT NULL, "employeeId" TEXT NOT NULL,
  "correctedById" TEXT, "previousStatus" "AttendanceStatus" NOT NULL,
  "nextStatus" "AttendanceStatus" NOT NULL, "previousHours" DECIMAL(5,2) NOT NULL,
  "nextHours" DECIMAL(5,2) NOT NULL, "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceCorrection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AttendanceCorrection_attendanceId_idx" ON "AttendanceCorrection"("attendanceId");
CREATE INDEX "AttendanceCorrection_employeeId_idx" ON "AttendanceCorrection"("employeeId");

CREATE TABLE "BusinessTrip" (
  "id" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "destination" TEXT NOT NULL,
  "purpose" TEXT NOT NULL, "startDate" TIMESTAMP(3) NOT NULL, "endDate" TIMESTAMP(3) NOT NULL,
  "days" DECIMAL(7,2) NOT NULL, "perDiem" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "travelCost" DECIMAL(12,2) NOT NULL DEFAULT 0, "advanceAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "status" "TripStatus" NOT NULL DEFAULT 'PENDING', "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3), CONSTRAINT "BusinessTrip_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BusinessTrip_values_valid" CHECK ("endDate" >= "startDate" AND "days" > 0 AND "perDiem" >= 0 AND "travelCost" >= 0 AND "advanceAmount" >= 0) NOT VALID
);
CREATE INDEX "BusinessTrip_employeeId_idx" ON "BusinessTrip"("employeeId");
CREATE INDEX "BusinessTrip_status_idx" ON "BusinessTrip"("status");
CREATE INDEX "BusinessTrip_deletedAt_idx" ON "BusinessTrip"("deletedAt");

CREATE TABLE "EmployeeExpense" (
  "id" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "tripId" TEXT, "category" TEXT NOT NULL,
  "expenseDate" TIMESTAMP(3) NOT NULL, "amount" DECIMAL(12,2) NOT NULL,
  "description" TEXT NOT NULL, "status" "ExpenseStatus" NOT NULL DEFAULT 'SUBMITTED',
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3),
  CONSTRAINT "EmployeeExpense_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmployeeExpense_amount_valid" CHECK ("amount" > 0) NOT VALID
);
CREATE INDEX "EmployeeExpense_employeeId_idx" ON "EmployeeExpense"("employeeId");
CREATE INDEX "EmployeeExpense_tripId_idx" ON "EmployeeExpense"("tripId");
CREATE INDEX "EmployeeExpense_status_idx" ON "EmployeeExpense"("status");
CREATE INDEX "EmployeeExpense_deletedAt_idx" ON "EmployeeExpense"("deletedAt");

CREATE TABLE "EmployeeLoan" (
  "id" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "type" TEXT NOT NULL,
  "principal" DECIMAL(12,2) NOT NULL, "disbursementDate" TIMESTAMP(3) NOT NULL,
  "startYear" INTEGER NOT NULL, "startMonth" INTEGER NOT NULL,
  "repaymentMode" "LoanRepaymentMode" NOT NULL, "termMonths" INTEGER NOT NULL DEFAULT 1,
  "monthlyLimit" DECIMAL(12,2) NOT NULL DEFAULT 0, "status" "LoanStatus" NOT NULL DEFAULT 'DRAFT',
  "reference" TEXT, "notes" TEXT, "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3), CONSTRAINT "EmployeeLoan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmployeeLoan_values_valid" CHECK ("principal" > 0 AND "monthlyLimit" >= 0 AND "termMonths" > 0 AND "startMonth" BETWEEN 1 AND 12) NOT VALID
);
CREATE INDEX "EmployeeLoan_employeeId_idx" ON "EmployeeLoan"("employeeId");
CREATE INDEX "EmployeeLoan_status_idx" ON "EmployeeLoan"("status");
CREATE INDEX "EmployeeLoan_deletedAt_idx" ON "EmployeeLoan"("deletedAt");

CREATE TABLE "LoanDeductionOverride" (
  "id" TEXT NOT NULL, "loanId" TEXT NOT NULL, "year" INTEGER NOT NULL, "month" INTEGER NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL, "reason" TEXT NOT NULL, "approvedAboveLimit" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LoanDeductionOverride_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoanDeductionOverride_values_valid" CHECK ("amount" >= 0 AND "month" BETWEEN 1 AND 12) NOT VALID
);
CREATE UNIQUE INDEX "LoanDeductionOverride_loanId_year_month_key" ON "LoanDeductionOverride"("loanId", "year", "month");

CREATE TABLE "LoanRepayment" (
  "id" TEXT NOT NULL, "loanId" TEXT NOT NULL, "payrollId" TEXT, "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL, "amount" DECIMAL(12,2) NOT NULL,
  "source" "LoanRepaymentSource" NOT NULL, "status" "LoanRepaymentStatus" NOT NULL DEFAULT 'POSTED',
  "note" TEXT, "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoanRepayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoanRepayment_values_valid" CHECK ("amount" > 0 AND "month" BETWEEN 1 AND 12) NOT VALID
);
CREATE UNIQUE INDEX "LoanRepayment_payrollId_loanId_key" ON "LoanRepayment"("payrollId", "loanId");
CREATE INDEX "LoanRepayment_loanId_idx" ON "LoanRepayment"("loanId");
CREATE INDEX "LoanRepayment_status_idx" ON "LoanRepayment"("status");

CREATE TABLE "PayrollLineItem" (
  "id" TEXT NOT NULL, "payrollId" TEXT NOT NULL, "loanId" TEXT, "kind" "PayrollLineKind" NOT NULL,
  "description" TEXT NOT NULL, "amount" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollLineItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayrollLineItem_amount_valid" CHECK ("amount" >= 0) NOT VALID
);
CREATE INDEX "PayrollLineItem_payrollId_idx" ON "PayrollLineItem"("payrollId");
CREATE INDEX "PayrollLineItem_loanId_idx" ON "PayrollLineItem"("loanId");
CREATE INDEX "PayrollLineItem_kind_idx" ON "PayrollLineItem"("kind");

CREATE TABLE "RecruitmentJob" (
  "id" TEXT NOT NULL, "title" TEXT NOT NULL, "departmentId" TEXT, "openings" INTEGER NOT NULL DEFAULT 1,
  "status" "RecruitmentJobStatus" NOT NULL DEFAULT 'OPEN', "postedOn" TIMESTAMP(3) NOT NULL,
  "description" TEXT, "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3), CONSTRAINT "RecruitmentJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecruitmentJob_openings_valid" CHECK ("openings" > 0) NOT VALID
);
CREATE INDEX "RecruitmentJob_departmentId_idx" ON "RecruitmentJob"("departmentId");
CREATE INDEX "RecruitmentJob_status_idx" ON "RecruitmentJob"("status");
CREATE INDEX "RecruitmentJob_deletedAt_idx" ON "RecruitmentJob"("deletedAt");

CREATE TABLE "RecruitmentCandidate" (
  "id" TEXT NOT NULL, "jobId" TEXT NOT NULL, "employeeId" TEXT, "name" TEXT NOT NULL,
  "email" TEXT NOT NULL, "phone" TEXT, "stage" "CandidateStage" NOT NULL DEFAULT 'APPLIED',
  "rating" DECIMAL(3,2) NOT NULL DEFAULT 0, "notes" TEXT, "appliedOn" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3),
  CONSTRAINT "RecruitmentCandidate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecruitmentCandidate_rating_valid" CHECK ("rating" >= 0 AND "rating" <= 5) NOT VALID
);
CREATE INDEX "RecruitmentCandidate_jobId_idx" ON "RecruitmentCandidate"("jobId");
CREATE INDEX "RecruitmentCandidate_employeeId_idx" ON "RecruitmentCandidate"("employeeId");
CREATE INDEX "RecruitmentCandidate_stage_idx" ON "RecruitmentCandidate"("stage");
CREATE INDEX "RecruitmentCandidate_deletedAt_idx" ON "RecruitmentCandidate"("deletedAt");

CREATE TABLE "EosRecord" (
  "id" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "asOf" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL, "serviceYears" DECIMAL(9,4) NOT NULL,
  "gratuity" DECIMAL(12,2) NOT NULL, "leaveEncashment" DECIMAL(12,2) NOT NULL,
  "lopDeduction" DECIMAL(12,2) NOT NULL, "expenseReimbursement" DECIMAL(12,2) NOT NULL,
  "tripAdvanceDeduction" DECIMAL(12,2) NOT NULL, "netSettlement" DECIMAL(12,2) NOT NULL,
  "policyVersion" INTEGER NOT NULL DEFAULT 1, "status" "EosStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3),
  CONSTRAINT "EosRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EosRecord_employeeId_idx" ON "EosRecord"("employeeId");
CREATE INDEX "EosRecord_status_idx" ON "EosRecord"("status");
CREATE INDEX "EosRecord_deletedAt_idx" ON "EosRecord"("deletedAt");

CREATE TABLE "DocumentSequence" (
  "key" TEXT NOT NULL, "value" INTEGER NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL, "actorUserId" TEXT, "requestId" TEXT, "action" "AuditAction" NOT NULL,
  "entityType" TEXT NOT NULL, "entityId" TEXT, "summary" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditEvent_actorUserId_idx" ON "AuditEvent"("actorUserId");
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

CREATE TABLE "AuditChange" (
  "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "field" TEXT NOT NULL,
  "previousValue" TEXT, "nextValue" TEXT, CONSTRAINT "AuditChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditChange_eventId_idx" ON "AuditChange"("eventId");

CREATE TABLE "ImportRun" (
  "id" TEXT NOT NULL, "sourceStateUpdatedAt" TIMESTAMP(3) NOT NULL, "sourceHash" TEXT NOT NULL,
  "status" "ImportRunStatus" NOT NULL, "createdCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0, "invalidCount" INTEGER NOT NULL DEFAULT 0,
  "conflictCount" INTEGER NOT NULL DEFAULT 0, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3), CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ImportRun_sourceHash_key" ON "ImportRun"("sourceHash");

CREATE TABLE "ImportItem" (
  "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "entityType" TEXT NOT NULL, "legacyId" TEXT,
  "targetId" TEXT, "sourceHash" TEXT NOT NULL, "status" "ImportItemStatus" NOT NULL,
  "reason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImportItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ImportItem_runId_entityType_sourceHash_key" ON "ImportItem"("runId", "entityType", "sourceHash");
CREATE INDEX "ImportItem_runId_status_idx" ON "ImportItem"("runId", "status");

ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeBankAccount" ADD CONSTRAINT "EmployeeBankAccount_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeCredential" ADD CONSTRAINT "EmployeeCredential_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeBenefitProfile" ADD CONSTRAINT "EmployeeBenefitProfile_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeEducation" ADD CONSTRAINT "EmployeeEducation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BusinessTrip" ADD CONSTRAINT "BusinessTrip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeExpense" ADD CONSTRAINT "EmployeeExpense_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeExpense" ADD CONSTRAINT "EmployeeExpense_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "BusinessTrip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmployeeLoan" ADD CONSTRAINT "EmployeeLoan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoanDeductionOverride" ADD CONSTRAINT "LoanDeductionOverride_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "EmployeeLoan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoanRepayment" ADD CONSTRAINT "LoanRepayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "EmployeeLoan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanRepayment" ADD CONSTRAINT "LoanRepayment_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "Payroll"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollLineItem" ADD CONSTRAINT "PayrollLineItem_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "Payroll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollLineItem" ADD CONSTRAINT "PayrollLineItem_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "EmployeeLoan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecruitmentJob" ADD CONSTRAINT "RecruitmentJob_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecruitmentCandidate" ADD CONSTRAINT "RecruitmentCandidate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "RecruitmentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecruitmentCandidate" ADD CONSTRAINT "RecruitmentCandidate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EosRecord" ADD CONSTRAINT "EosRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditChange" ADD CONSTRAINT "AuditChange_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "AuditEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportItem" ADD CONSTRAINT "ImportItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ImportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Audit history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_append_only" BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
CREATE TRIGGER "AuditChange_append_only" BEFORE UPDATE OR DELETE ON "AuditChange"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
