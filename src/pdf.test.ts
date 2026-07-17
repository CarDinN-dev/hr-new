import { beforeAll, describe, expect, it, vi } from "vitest";
import { testState } from "./testState";
import { saveEmployeeDocumentPdf, saveEmployeeProfilePdf, saveEosPdf, savePayslipPdf } from "./pdf";
import { createPayroll } from "./domain";
import { dataUrlBlob } from "./dataUrl";

beforeAll(() => {
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

describe("professional PDF output", () => {
  it("generates profile and payslip files with usable data", () => {
    const state = testState();
    const employee = state.employees[0];
    const payroll = createPayroll(state, 2026, 7).state.payroll.find(item => item.employeeId === employee.id)!;
    const profile = saveEmployeeProfilePdf(employee, state.settings);
    const payslip = savePayslipPdf(payroll, employee, state.settings);

    expect(profile.filename).toContain(employee.fields["Employee Code"]);
    expect(profile.dataUrl).toMatch(/^data:application\/pdf/);
    expect(dataUrlBlob(profile.dataUrl).type).toBe("application/pdf");
    expect(dataUrlBlob(profile.dataUrl).size).toBeGreaterThan(5_000);
    expect(profile.sizeBytes).toBeGreaterThan(5_000);
    expect(payslip.filename).toContain("2026-07");
    expect(payslip.sizeBytes).toBeGreaterThan(5_000);
  });

  it("rejects executable or mislabeled saved document data", () => {
    expect(() => dataUrlBlob(`data:text/html;base64,${btoa("<script>alert(1)</script>")}`)).toThrow("Saved PDF data is invalid.");
    expect(() => dataUrlBlob(`data:application/pdf;base64,${btoa("not a pdf")}`)).toThrow("Saved PDF data is invalid.");
  });

  it("requires a server EOS result and renders those exact stored values", () => {
    const state = testState();
    const employee = state.employees[0];
    expect(() => saveEmployeeDocumentPdf("final_settlement", employee, state, "")).toThrow("server EOS preview");

    const settlement = {
      id: "eos-server-1",
      employeeId: employee.id,
      asOf: "2026-07-31",
      reason: "Resignation",
      serviceYears: 5.25,
      gratuity: 12_345.67,
      leaveEncashment: 234.56,
      lopDeduction: 12.34,
      expenseReimbursement: 45.67,
      tripAdvanceDeduction: 89.01,
      netSettlement: 12_524.55,
      status: "Approved" as const,
      createdOn: "2026-07-17",
    };
    const pdf = saveEosPdf(settlement, employee, state.settings);
    expect(pdf.filename).toContain("2026-07-31");
    expect(pdf.dataUrl).toMatch(/^data:application\/pdf/);
    expect(pdf.sizeBytes).toBeGreaterThan(5_000);
  });
});
