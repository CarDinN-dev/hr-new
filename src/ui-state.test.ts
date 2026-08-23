import { describe, expect, it } from "vitest";
import { attendanceSearch, commonSearch, notificationDestination, paginate, settingsEditorErrors, shellSearch, statusActionLabel, teamSearch } from "./ui-state";

describe("UI state helpers", () => {
  it("sanitizes shareable list state and clamps pages", () => {
    expect(commonSearch({ q: "  Alice  " })).toEqual({ q: "Alice" });
    expect(commonSearch({ q: "a" })).toEqual({ q: undefined });
    expect(teamSearch({ page: "3" })).toEqual({ page: 3 });
    expect(attendanceSearch({ date: "2026-08-23", status: "Present", month: "8", year: "2026", page: "0", summaryPage: "2" })).toMatchObject({ date: "2026-08-23", status: "Present", month: 8, year: 2026, page: undefined, summaryPage: 2 });
    expect(attendanceSearch({ date: "not-a-date", status: "Unknown", month: 13 })).toMatchObject({ date: undefined, status: undefined, month: undefined });
    expect(shellSearch({ q: " Alice ", page: "2", status: "Absent" })).toMatchObject({ q: "Alice", page: 2, status: "Absent" });
    expect(paginate([1, 2, 3, 4, 5], 99, 2)).toEqual({ page: 3, totalPages: 3, items: [5] });
  });

  it("validates structured Settings rows without changing leave metadata", () => {
    const leaveTypes = [{ id: "annual", name: "Annual", code: "ANNUAL", days: 21, isPaid: true, requiresAttachment: false }];
    expect(settingsEditorErrors([{ key: "hr", name: "HR" }], leaveTypes)).toMatchObject({ valid: true });
    expect(settingsEditorErrors([{ key: "one", name: "HR" }, { key: "two", name: "hr" }], [{ ...leaveTypes[0], days: 366.001 }])).toMatchObject({
      valid: false,
      departments: { two: "Department names must be unique." },
      leaveTypes: { annual: { days: "Enter 0–366 days with no more than two decimal places." } },
    });
    expect(leaveTypes[0]).toMatchObject({ code: "ANNUAL", isPaid: true, requiresAttachment: false });
  });

  it("maps protected transitions and notification resources to clear actions", () => {
    expect(statusActionLabel("Paused", "Active")).toBe("Pause");
    expect(statusActionLabel("Active", "Paused")).toBe("Resume");
    expect(statusActionLabel("Approved", "Draft")).toBe("Approve");
    expect(statusActionLabel("Paid", "Approved")).toBe("Mark paid");
    expect(notificationDestination("LeaveRequest")).toEqual({ nav: "Leave", hashPrefix: "leave" });
    expect(notificationDestination("User")).toBeNull();
  });
});
