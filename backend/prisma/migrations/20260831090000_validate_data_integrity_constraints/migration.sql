-- Fail fast on lock contention; PostgreSQL validates existing rows without
-- blocking normal reads or writes for the duration of the table scan.
SET lock_timeout = '5s';
SET statement_timeout = '30min';

ALTER TABLE "Employee" VALIDATE CONSTRAINT "Employee_salary_nonnegative";
ALTER TABLE "EmploymentContract" VALIDATE CONSTRAINT "EmploymentContract_dates_valid";
ALTER TABLE "EmploymentContract" VALIDATE CONSTRAINT "EmploymentContract_salary_nonnegative";
ALTER TABLE "EmploymentContract" VALIDATE CONSTRAINT "EmploymentContract_hours_valid";
ALTER TABLE "Attendance" VALIDATE CONSTRAINT "Attendance_hours_valid";
ALTER TABLE "Attendance" VALIDATE CONSTRAINT "Attendance_late_minutes_valid";
ALTER TABLE "Attendance" VALIDATE CONSTRAINT "Attendance_times_valid";
ALTER TABLE "LeaveType" VALIDATE CONSTRAINT "LeaveType_allowance_valid";
ALTER TABLE "LeaveBalance" VALIDATE CONSTRAINT "LeaveBalance_year_valid";
ALTER TABLE "LeaveBalance" VALIDATE CONSTRAINT "LeaveBalance_values_valid";
ALTER TABLE "LeaveRequest" VALIDATE CONSTRAINT "LeaveRequest_dates_valid";
ALTER TABLE "LeaveRequest" VALIDATE CONSTRAINT "LeaveRequest_duration_valid";
ALTER TABLE "LeaveRequest" VALIDATE CONSTRAINT "LeaveRequest_half_day_valid";
ALTER TABLE "SalaryRecord" VALIDATE CONSTRAINT "SalaryRecord_dates_valid";
ALTER TABLE "SalaryRecord" VALIDATE CONSTRAINT "SalaryRecord_values_valid";
ALTER TABLE "Payroll" VALIDATE CONSTRAINT "Payroll_period_valid";
ALTER TABLE "Payroll" VALIDATE CONSTRAINT "Payroll_values_valid";
ALTER TABLE "PerformanceReview" VALIDATE CONSTRAINT "PerformanceReview_period_valid";
ALTER TABLE "PerformanceReview" VALIDATE CONSTRAINT "PerformanceReview_rating_valid";
ALTER TABLE "AuthThrottle" VALIDATE CONSTRAINT "AuthThrottle_count_positive";
ALTER TABLE "OrganizationSettings" VALIDATE CONSTRAINT "OrganizationSettings_hours_valid";
ALTER TABLE "OrganizationSettings" VALIDATE CONSTRAINT "OrganizationSettings_loan_cap_valid";
ALTER TABLE "EmployeeBenefitProfile" VALIDATE CONSTRAINT "EmployeeBenefitProfile_values_valid";
ALTER TABLE "BusinessTrip" VALIDATE CONSTRAINT "BusinessTrip_values_valid";
ALTER TABLE "EmployeeExpense" VALIDATE CONSTRAINT "EmployeeExpense_amount_valid";
ALTER TABLE "EmployeeLoan" VALIDATE CONSTRAINT "EmployeeLoan_values_valid";
ALTER TABLE "LoanDeductionOverride" VALIDATE CONSTRAINT "LoanDeductionOverride_values_valid";
ALTER TABLE "LoanRepayment" VALIDATE CONSTRAINT "LoanRepayment_values_valid";
ALTER TABLE "PayrollLineItem" VALIDATE CONSTRAINT "PayrollLineItem_amount_valid";
ALTER TABLE "RecruitmentJob" VALIDATE CONSTRAINT "RecruitmentJob_openings_valid";
ALTER TABLE "RecruitmentCandidate" VALIDATE CONSTRAINT "RecruitmentCandidate_rating_valid";

RESET statement_timeout;
RESET lock_timeout;
