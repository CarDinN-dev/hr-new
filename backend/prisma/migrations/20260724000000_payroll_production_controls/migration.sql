CREATE TYPE "PayrollRunType" AS ENUM ('REGULAR', 'OFF_CYCLE');
CREATE TYPE "PayrollAdjustmentDirection" AS ENUM ('EARNING', 'DEDUCTION');
CREATE TYPE "PayrollPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

ALTER TABLE "OrganizationSettings"
  ADD COLUMN "payrollProrationBasis" TEXT NOT NULL DEFAULT 'FIXED_30',
  ADD COLUMN "payrollRequireBankDetails" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "payrollRequireAttendance" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "payrollVarianceThreshold" DECIMAL(5,2) NOT NULL DEFAULT 25;

ALTER TABLE "PayrollRun"
  ADD COLUMN "runType" "PayrollRunType" NOT NULL DEFAULT 'REGULAR',
  ADD COLUMN "purpose" TEXT,
  ADD COLUMN "paymentBatchReference" TEXT;

ALTER TABLE "Payroll"
  ADD COLUMN "paymentStatus" "PayrollPaymentStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "paymentReference" TEXT,
  ADD COLUMN "paymentReconciledAt" TIMESTAMP(3),
  ADD COLUMN "paymentFailureReason" TEXT,
  ADD COLUMN "inputSnapshot" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "calculationHash" TEXT NOT NULL DEFAULT '';

CREATE TABLE "PayrollAdjustment" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "direction" "PayrollAdjustmentDirection" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "taxable" BOOLEAN NOT NULL DEFAULT false,
  "description" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "appliedPayrollId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayrollRun_runType_year_month_idx" ON "PayrollRun"("runType", "year", "month");
CREATE INDEX "Payroll_paymentStatus_idx" ON "Payroll"("paymentStatus");
CREATE INDEX "PayrollAdjustment_employeeId_year_month_idx" ON "PayrollAdjustment"("employeeId", "year", "month");
CREATE INDEX "PayrollAdjustment_appliedPayrollId_idx" ON "PayrollAdjustment"("appliedPayrollId");

ALTER TABLE "PayrollAdjustment"
  ADD CONSTRAINT "PayrollAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollAdjustment_appliedPayrollId_fkey" FOREIGN KEY ("appliedPayrollId") REFERENCES "Payroll"("id") ON DELETE SET NULL ON UPDATE CASCADE;
