import { describe, expect, it } from "vitest";
import { testState } from "./testState";
import { applyAttendanceRows, parseAttendanceSheet, parseAttendanceWorkbookRows } from "./attendanceSheet";

describe("attendance sheet import", () => {
  it("imports valid status names and codes without replacing other attendance", () => {
    const state = testState();
    const [first, second] = state.employees;
    const rows = parseAttendanceSheet(`Date,Employee Code,Status\n11/07/2026,${first.fields["Employee Code"]},Present\n2026-07-11,${second.fields["Employee Code"]},A\n2026-02-30,UNKNOWN,L`);
    const result = applyAttendanceRows(state, rows);

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.state.attendance["2026-07-11"][first.id]).toBe("P");
    expect(result.state.attendance["2026-07-11"][second.id]).toBe("A");
    expect(result.state.attendance["2026-06-20"]).toEqual(state.attendance["2026-06-20"]);
  });

  it("reads the supplied Logs report and leaves blank days unmarked", () => {
    const state = testState();
    const [first, second] = state.employees;
    const rows = parseAttendanceWorkbookRows([
      ["List of Logs"],
      ["Duration:", "", "09/07/2026 ~ 11/07/2026"],
      ["No.", "Name", 9, 10, 11],
      ["", "", "Th", "Fr", "Sa"],
      [first.fields["Employee Code"], "", "07:45\n16:37\n", "", "On Leave"],
      [second.fields["Employee Code"], "", "", "08:10\n", "X"]
    ]);
    const result = applyAttendanceRows(state, rows);

    expect(result.imported).toBe(4);
    expect(result.state.attendance["2026-07-09"][first.id]).toBe("P");
    expect(result.state.attendance["2026-07-10"][second.id]).toBe("P");
    expect(result.state.attendance["2026-07-11"][first.id]).toBe("L");
    expect(result.state.attendance["2026-07-11"][second.id]).toBe("A");
    expect(result.state.attendance["2026-07-10"][first.id]).toBeUndefined();
  });
});
