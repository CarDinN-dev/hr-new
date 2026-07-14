-- Enforce new and modified rows immediately without making deployment depend
-- on historical rows being clean. Existing data can be reconciled and the
-- constraints validated later with ALTER TABLE ... VALIDATE CONSTRAINT.

ALTER TABLE "Employee"
  ADD CONSTRAINT "Employee_salary_nonnegative" CHECK ("salary" >= 0) NOT VALID;

ALTER TABLE "EmploymentContract"
  ADD CONSTRAINT "EmploymentContract_dates_valid" CHECK ("endDate" IS NULL OR "endDate" >= "startDate") NOT VALID,
  ADD CONSTRAINT "EmploymentContract_salary_nonnegative" CHECK ("salary" >= 0) NOT VALID,
  ADD CONSTRAINT "EmploymentContract_hours_valid" CHECK ("workingHoursPerWeek" > 0 AND "workingHoursPerWeek" <= 168) NOT VALID;

ALTER TABLE "Attendance"
  ADD CONSTRAINT "Attendance_hours_valid" CHECK ("workingHours" >= 0 AND "workingHours" <= 48) NOT VALID,
  ADD CONSTRAINT "Attendance_late_minutes_valid" CHECK ("lateMinutes" >= 0 AND "lateMinutes" <= 1440) NOT VALID,
  ADD CONSTRAINT "Attendance_times_valid" CHECK ("checkOut" IS NULL OR ("checkIn" IS NOT NULL AND "checkOut" >= "checkIn")) NOT VALID;

ALTER TABLE "LeaveType"
  ADD CONSTRAINT "LeaveType_allowance_valid" CHECK ("annualAllowanceDays" >= 0 AND "annualAllowanceDays" <= 366) NOT VALID;

ALTER TABLE "LeaveBalance"
  ADD CONSTRAINT "LeaveBalance_year_valid" CHECK ("year" >= 2000 AND "year" <= 2100) NOT VALID,
  ADD CONSTRAINT "LeaveBalance_values_valid" CHECK (
    "totalDays" >= 0 AND "totalDays" <= 366
    AND "usedDays" >= 0 AND "pendingDays" >= 0
    AND "usedDays" + "pendingDays" <= "totalDays"
  ) NOT VALID;

ALTER TABLE "LeaveRequest"
  ADD CONSTRAINT "LeaveRequest_dates_valid" CHECK ("endDate" >= "startDate") NOT VALID,
  ADD CONSTRAINT "LeaveRequest_duration_valid" CHECK ("totalDays" > 0 AND "totalDays" <= 366) NOT VALID,
  ADD CONSTRAINT "LeaveRequest_half_day_valid" CHECK (NOT "isHalfDay" OR ("totalDays" = 0.5 AND "startDate" = "endDate")) NOT VALID;

ALTER TABLE "SalaryRecord"
  ADD CONSTRAINT "SalaryRecord_dates_valid" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom") NOT VALID,
  ADD CONSTRAINT "SalaryRecord_values_valid" CHECK (
    "baseSalary" >= 0 AND "allowances" >= 0 AND "deductions" >= 0 AND "bonuses" >= 0
    AND "taxRate" >= 0 AND "taxRate" <= 100
  ) NOT VALID;

ALTER TABLE "Payroll"
  ADD CONSTRAINT "Payroll_period_valid" CHECK ("year" >= 2000 AND "year" <= 2100 AND "month" >= 1 AND "month" <= 12) NOT VALID,
  ADD CONSTRAINT "Payroll_values_valid" CHECK (
    "baseSalary" >= 0 AND "allowances" >= 0 AND "deductions" >= 0 AND "bonuses" >= 0
    AND "taxAmount" >= 0 AND "grossPay" >= 0 AND "netPay" >= 0
  ) NOT VALID;

ALTER TABLE "PerformanceReview"
  ADD CONSTRAINT "PerformanceReview_period_valid" CHECK ("reviewPeriodEnd" >= "reviewPeriodStart") NOT VALID,
  ADD CONSTRAINT "PerformanceReview_rating_valid" CHECK ("rating" >= 0 AND "rating" <= 5) NOT VALID;

ALTER TABLE "AuthThrottle"
  ADD CONSTRAINT "AuthThrottle_count_positive" CHECK ("count" > 0) NOT VALID;
