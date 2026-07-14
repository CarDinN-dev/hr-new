import { describe, expect, it } from "vitest";
import { testState } from "./testState";
import { createPayroll, markAllAttendance } from "./domain";
import { payrollLoanDetails, payrollSheetHtml, payrollSlipsForDepartment, sifCsv, spreadsheetText } from "./payrollExports";

describe("payroll exports", () => {
  it("creates Qatar WPS SIF rows from payroll slips", () => {
    let state = testState();
    state = markAllAttendance(state, "2026-07-09", "A");
    state = createPayroll(state, 2026, 7).state;
    const slips = state.payroll.filter(item => item.year === 2026 && item.month === 7);
    const lines = sifCsv(state, slips, 2026, 7).split("\r\n");

    expect(lines[0]).toContain("Employer Establishment ID");
    expect(lines[2]).toContain("Record Sequence");
    expect(lines).toHaveLength(slips.length + 3);
    expect(lines[3]).toContain("Attendance LOP 1 days");
    expect(lines[3].split(",")[7]).toBe("30");
  });

  it("filters payroll sheet exports by department", () => {
    let state = testState();
    state = createPayroll(state, 2026, 7).state;
    const slips = state.payroll.filter(item => item.year === 2026 && item.month === 7);
    const department = state.employees[0].fields.Department;
    const expected = slips.filter(slip => state.employees.find(employee => employee.id === slip.employeeId)?.fields.Department === department);
    const filtered = payrollSlipsForDepartment(state, slips, department);

    expect(filtered).toEqual(expected);
    expect(payrollSheetHtml(state, filtered)).toContain(`>${department}<`);
  });

  it("includes each scheduled loan in payroll details", () => {
    let state = testState();
    const employee = state.employees[0];
    state = {
      ...state,
      loans: [{
        id: "loan-payroll-detail", employeeId: employee.id, type: "Salary advance", principal: 1_200, disbursementDate: "2026-07-01", startPeriod: "2026-07",
        repaymentMode: "Duration", termMonths: 12, monthlyLimit: 0, status: "Active", reference: "ADV-1200", notes: "", createdOn: "2026-07-01", deductionOverrides: {}
      }]
    };
    const slip = createPayroll(state, 2026, 7).state.payroll.find(item => item.employeeId === employee.id)!;

    expect(payrollLoanDetails(state, slip)).toContain("Salary advance - ADV-1200:");
    expect(payrollSheetHtml(state, [slip])).toContain("Salary advance - ADV-1200:");
  });

  it("neutralizes spreadsheet formulas in exported text fields", () => {
    expect(spreadsheetText("=HYPERLINK(\"https://example.invalid\")")).toBe("'=HYPERLINK(\"https://example.invalid\")");
    expect(spreadsheetText("  +SUM(1,2)")).toBe("'  +SUM(1,2)");
    expect(spreadsheetText("Normal text")).toBe("Normal text");
  });
});
