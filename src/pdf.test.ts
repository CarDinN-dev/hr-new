import { beforeAll, describe, expect, it, vi } from "vitest";
import { defaultState } from "./data";
import { saveEmployeeProfilePdf, savePayslipPdf } from "./pdf";
import { createPayroll } from "./domain";

beforeAll(() => {
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

describe("professional PDF output", () => {
  it("generates profile and payslip files with usable data", () => {
    const state = defaultState();
    const employee = state.employees[0];
    const payroll = createPayroll(state, 2026, 7).state.payroll.find(item => item.employeeId === employee.id)!;
    const profile = saveEmployeeProfilePdf(employee, state.settings);
    const payslip = savePayslipPdf(payroll, employee, state.settings);

    expect(profile.filename).toContain(employee.fields["Employee Code"]);
    expect(profile.dataUrl).toMatch(/^data:application\/pdf/);
    expect(profile.sizeBytes).toBeGreaterThan(5_000);
    expect(payslip.filename).toContain("2026-07");
    expect(payslip.sizeBytes).toBeGreaterThan(5_000);
  });
});
