import { beforeAll, describe, expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import { testState } from "./testState";
import { saveEmployeeProfilePdf, savePayslipPdf, saveRoleHierarchyPdf } from "./pdf";
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

  it("exports the complete company role hierarchy as a landscape PDF", async () => {
    const state = testState();
    const addSvgAsImage = vi.spyOn(jsPDF.API as unknown as { addSvgAsImage: (...args: unknown[]) => Promise<unknown> }, "addSvgAsImage").mockResolvedValue(undefined);
    const file = await saveRoleHierarchyPdf(state.employees, state.settings);

    expect(file.filename).toBe("Company-Role-Hierarchy.pdf");
    expect(file.dataUrl).toMatch(/^data:application\/pdf/);
    expect(dataUrlBlob(file.dataUrl).size).toBeGreaterThan(5_000);
    expect(file.sizeBytes).toBeGreaterThan(5_000);
    expect(addSvgAsImage).toHaveBeenCalledWith(expect.stringContaining('viewBox="810 420 300 240"'), 14, 3, 20, 16);
  });
});
