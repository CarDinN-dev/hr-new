import { describe, expect, it } from "vitest";
import { defaultState } from "./data";
import { createPayroll, markAllAttendance } from "./domain";
import { sifCsv } from "./payrollExports";

describe("payroll exports", () => {
  it("creates Qatar WPS SIF rows from payroll slips", () => {
    let state = defaultState();
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
});
