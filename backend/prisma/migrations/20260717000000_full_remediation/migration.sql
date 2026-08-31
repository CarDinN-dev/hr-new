ALTER TABLE "Employee" ADD COLUMN "photo" TEXT;

ALTER TABLE "SalaryRecord"
  ADD COLUMN "housingAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "foodAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "mobileAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "specialAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "overtimeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "SalaryRecord"
SET "housingAllowance" = "allowances",
    "overtimeAmount" = "bonuses";

ALTER TABLE "EmployeeDocument" ALTER COLUMN "employeeId" DROP NOT NULL;
