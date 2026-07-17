import { afterEach, expect, it, vi } from "vitest";
import { apiList, apiPage, loadAuthProviders, loadBackendAttendancePeriod, loadBackendReportState } from "./api";
import { testState } from "./testState";

afterEach(() => vi.unstubAllGlobals());

it("preserves paginated response metadata", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: [{ id: "notification-1" }], meta: { unread: 3 } })
  }));

  await expect(apiPage<{ id: string }, { unread: number }>("/notifications")).resolves.toEqual({
    data: [{ id: "notification-1" }],
    meta: { unread: 3 }
  });
});

it("replaces existing pagination parameters instead of duplicating them", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: [{ id: "annual" }], meta: { totalPages: 1 } })
  });
  vi.stubGlobal("fetch", fetchMock);

  await expect(apiList<{ id: string }>("/leave/types?limit=30&page=7")).resolves.toEqual([{ id: "annual" }]);
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/leave/types?limit=100&page=1");
});

it("follows server totalPages without an arbitrary client page ceiling", async () => {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const page = Number(new URL(url, "http://localhost").searchParams.get("page"));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [{ id: `record-${page}` }], meta: { totalPages: 103 } }),
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  const records = await apiList<{ id: string }>("/approvals/inbox");
  expect(records).toHaveLength(103);
  expect(records.at(-1)?.id).toBe("record-103");
  expect(fetchMock).toHaveBeenCalledTimes(103);
});

it("loads only the selected attendance month with credentialed requests and preserves review semantics", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: [
        { employeeId: "employee-1", attendanceDate: "2026-02-17T00:00:00.000Z", status: "HALF_DAY", approvalStatus: "APPROVED" },
        { employeeId: "employee-2", attendanceDate: "2026-02-18T00:00:00.000Z", status: "ABSENT", approvalStatus: "NOT_APPROVED" },
        { employeeId: "employee-3", attendanceDate: "2026-02-19T00:00:00.000Z", status: "PRESENT", approvalStatus: "NOT_APPROVED" },
        { employeeId: "employee-4", attendanceDate: "2026-02-20T00:00:00.000Z", status: "HALF_DAY", approvalStatus: "PENDING" },
      ],
      meta: { totalPages: 1 },
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  await expect(loadBackendAttendancePeriod(2026, 2)).resolves.toEqual({
    attendance: { "2026-02-17": { "employee-1": "H" }, "2026-02-18": { "employee-2": "A" }, "2026-02-19": { "employee-3": "P" }, "2026-02-20": { "employee-4": "H" } },
    approvals: { "2026-02-17": { "employee-1": "Approved" }, "2026-02-18": { "employee-2": "Not approved" } },
    prefix: "2026-02",
  });
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/attendance?dateFrom=2026-02-01&dateTo=2026-02-28&limit=100&page=1");
  expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });
});

it("loads leave and payroll report rows using the selected server periods", async () => {
  const state = testState();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [{ id: "leave-1", employeeId: state.employees[0].id, startDate: "2026-01-02", endDate: "2026-01-03", totalDays: 2, reason: "Test", status: "APPROVED", createdAt: "2025-12-01", leaveType: { name: "Annual leave" } }], meta: { totalPages: 1 } }),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [{ id: "payroll-1", employeeId: state.employees[0].id, year: 2026, month: 4, baseSalary: 100, allowances: 20, deductions: 5, bonuses: 3, grossPay: 123, netPay: 118, status: "PAID", lineItems: [] }], meta: { totalPages: 1 } }),
    });
  vi.stubGlobal("fetch", fetchMock);

  const leaveState = await loadBackendReportState(state, "leave_report", 2026, 4);
  const payrollState = await loadBackendReportState(state, "payroll_register", 2026, 4);
  expect(leaveState.leaves).toHaveLength(1);
  expect(payrollState.payroll).toHaveLength(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/leave/requests?dateFrom=2026-01-01&dateTo=2026-12-31&limit=100&page=1");
  expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/payroll/payslips?year=2026&month=4&limit=100&page=1");
});

it("loads public authentication capabilities from the server", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { local: true, microsoft: false } }),
  }));
  await expect(loadAuthProviders()).resolves.toEqual({ local: true, microsoft: false });
});
