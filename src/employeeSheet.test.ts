import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { defaultState } from "./data";
import { applyEmployeeRows, employeeTemplateColumns, parseEmployeeSheet, parseEmployeeWorkbook, parseEmployeeWorkbookRows } from "./employeeSheet";

describe("employee sheet import", () => {
  it("adds and updates employees from the Excel template table", () => {
    const html = "<table><tr><th>Status</th><th>Employee Code</th><th>Full Name</th><th>Department</th><th>Basic</th></tr><tr><td>Active</td><td>MT-0999</td><td>Test User</td><td>Finance</td><td>1000</td></tr></table>";
    const rows = parseEmployeeSheet(html);
    const added = applyEmployeeRows(defaultState(), rows);
    const updated = applyEmployeeRows(added.state, [{ ...rows[0], Department: "Sales" }]);
    const employee = updated.state.employees.find(item => item.fields["Employee Code"] === "MT-0999");

    expect(added.added).toBe(1);
    expect(updated.updated).toBe(1);
    expect(employee?.fields.Department).toBe("Sales");
  });

  it("keeps quoted CSV commas and newlines inside one employee row", () => {
    const csv = "Status,Employee Code,Full Name,Department,International Street\nActive,MT-0777,\"User, Test\",Finance,\"Line 1\nLine 2\"";
    const rows = parseEmployeeSheet(csv);

    expect(rows).toHaveLength(1);
    expect(rows[0]["Full Name"]).toBe("User, Test");
    expect(rows[0]["International Street"]).toBe("Line 1\nLine 2");
  });

  it("maps the supplied Excel template by column position, including repeated date headers", () => {
    const headers = employeeTemplateColumns.map(item => item.header);
    const row = headers.map(() => "");
    const valueFor = (column: string, value: string) => {
      const index = employeeTemplateColumns.findIndex(item => item.column === column);
      row[index] = value;
    };

    valueFor("Employee Code", "MT-0900");
    valueFor("Department", "Sales");
    valueFor("Local Building/Villa #", "Villa 12");
    valueFor("Emergency Contact Name", "Amina Test");
    valueFor("Passport Issue Date", "2024-01-02");
    valueFor("Driving License Expiry Date", "2028-02-03");
    valueFor("Insurance Expiry Date", "2027-03-04");
    valueFor("Overtime Amount", "325");

    const imported = parseEmployeeWorkbookRows([headers, row]);

    expect(imported.skipped).toBe(0);
    expect(imported.rows).toEqual([expect.objectContaining({
      "Employee Code": "MT-0900",
      Department: "Sales",
      "Local Building/Villa #": "Villa 12",
      "Emergency Contact Name": "Amina Test",
      "Passport Issue Date": "2024-01-02",
      "Driving License Expiry Date": "2028-02-03",
      "Insurance Expiry Date": "2027-03-04",
      "Overtime Amount": "325"
    })]);
  });

  it("skips spreadsheet rows without a unique employee code", () => {
    const headers = employeeTemplateColumns.map(item => item.header);
    const first = headers.map(() => "");
    const duplicate = headers.map(() => "");
    first[0] = "MT-0901";
    duplicate[0] = "MT-0901";

    const imported = parseEmployeeWorkbookRows([headers, first, headers.map(() => ""), duplicate]);

    expect(imported.rows).toHaveLength(1);
    expect(imported.skipped).toBe(1);
    expect(imported.errors[0]).toContain("duplicated");
  });

  it("opens the exact downloadable .xlsx template through the browser file path", async () => {
    const bytes = await readFile("public/templates/MedTech-Employee-Import-Template.xlsx");
    const buffer = new Uint8Array(bytes).buffer;
    const originalFile = globalThis.File;
    class BrowserFile {
      async arrayBuffer() {
        return buffer;
      }
    }
    Object.defineProperty(globalThis, "File", { configurable: true, value: BrowserFile });

    try {
      await expect(parseEmployeeWorkbook(new BrowserFile() as unknown as File)).resolves.toMatchObject({ rows: [], skipped: 0, errors: [] });
    } finally {
      Object.defineProperty(globalThis, "File", { configurable: true, value: originalFile });
    }
  });

});
