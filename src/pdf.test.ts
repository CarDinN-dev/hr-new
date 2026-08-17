import { beforeAll, describe, expect, it, vi } from "vitest";
import { testState } from "./testState";
import { saveEmployeeDocumentPdf, saveEmployeeProfilePdf, savePayslipPdf, saveRoleHierarchyPdf } from "./pdf";
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

    expect(state.settings.company.phone).toBe("+974 4443 4140");
    expect(profile.filename).toContain(employee.fields["Employee Code"]);
    expect(profile.dataUrl).toMatch(/^data:application\/pdf/);
    expect(dataUrlBlob(profile.dataUrl).type).toBe("application/pdf");
    expect(dataUrlBlob(profile.dataUrl).size).toBeGreaterThan(5_000);
    expect(profile.sizeBytes).toBeGreaterThan(5_000);
    expect(Buffer.from(profile.dataUrl.split(",")[1], "base64").toString("latin1")).toContain("/Subtype /Image");
    expect(payslip.filename).toContain("2026-07");
    expect(payslip.sizeBytes).toBeGreaterThan(5_000);
    const payslipSource = Buffer.from(payslip.dataUrl.split(",")[1], "base64").toString("latin1");
    expect(payslipSource).toContain("/Subtype /Image");
    expect(payslipSource).toContain(state.settings.company.legalName);
  });

  it("rejects executable or mislabeled saved document data", () => {
    expect(() => dataUrlBlob(`data:text/html;base64,${btoa("<script>alert(1)</script>")}`)).toThrow("Saved PDF data is invalid.");
    expect(() => dataUrlBlob(`data:application/pdf;base64,${btoa("not a pdf")}`)).toThrow("Saved PDF data is invalid.");
  });

  it("uses the selected payslip period and clearly marks an unfinalized fallback", () => {
    const state = testState();
    const employee = state.employees[0];
    const draft = saveEmployeeDocumentPdf("payslip", employee, state, "", { year: 2025, month: 3 });
    const finalizedState = createPayroll(state, 2026, 7).state;
    finalizedState.payroll = finalizedState.payroll.map(item => item.employeeId === employee.id ? { ...item, status: "Finalized" } : item);
    const finalized = saveEmployeeDocumentPdf("payslip", employee, finalizedState, "", { year: 2026, month: 7 });

    expect(draft.filename).toContain("2025-03");
    expect(Buffer.from(draft.dataUrl.split(",")[1], "base64").toString("latin1")).toContain("DRAFT PAYSLIP");
    expect(finalized.filename).toContain("2026-07");
    expect(Buffer.from(finalized.dataUrl.split(",")[1], "base64").toString("latin1")).not.toContain("DRAFT PAYSLIP");
  });

  it("exports the complete company role hierarchy as a landscape PDF", () => {
    const state = testState();
    const file = saveRoleHierarchyPdf(state.employees, state.settings);

    expect(file.filename).toBe("Company-Role-Hierarchy.pdf");
    expect(file.dataUrl).toMatch(/^data:application\/pdf/);
    expect(dataUrlBlob(file.dataUrl).size).toBeGreaterThan(5_000);
    expect(file.sizeBytes).toBeGreaterThan(5_000);
  });
});
