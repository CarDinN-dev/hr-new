import { describe, expect, it } from "vitest";
import { defaultState } from "./data";
import { applyAttendanceRows, parseAttendanceSheet } from "./attendanceSheet";

describe("attendance sheet import", () => {
  it("imports valid status names and codes without replacing other attendance", () => {
    const state = defaultState();
    const [first, second] = state.employees;
    const rows = parseAttendanceSheet(`Date,Employee Code,Status\n11/07/2026,${first.fields["Employee Code"]},Present\n2026-07-11,${second.fields["Employee Code"]},A\n2026-02-30,UNKNOWN,L`);
    const result = applyAttendanceRows(state, rows);

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.state.attendance["2026-07-11"][first.id]).toBe("P");
    expect(result.state.attendance["2026-07-11"][second.id]).toBe("A");
    expect(result.state.attendance["2026-06-20"]).toEqual(state.attendance["2026-06-20"]);
  });
});
