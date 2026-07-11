import { describe, expect, it } from "vitest";
import { defaultState } from "./data";
import { applyEmployeeRows, parseEmployeeSheet } from "./employeeSheet";

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
});
