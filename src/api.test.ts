import { afterEach, expect, it, vi } from "vitest";
import { apiDownload, apiList, apiPage, apiRequest, loadBackendState, type BackendSession } from "./api";
import { defaultState } from "./data";

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

it("loads an unpaginated catalogue once without pagination parameters", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: [{ id: "permission-1" }] })
  });
  vi.stubGlobal("fetch", fetchMock);

  await expect(apiRequest<{ id: string }[]>("/system/permissions")).resolves.toEqual([{ id: "permission-1" }]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/system/permissions");
});

it("uses UTF-8 download filenames returned by protected PDF endpoints", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ "content-disposition": "attachment; filename*=UTF-8''offer-letter-Alex%20Smith.pdf" }),
    blob: async () => new Blob(["pdf"])
  }));
  await expect(apiDownload("/recruitment/candidates/id/offer-letter.pdf")).resolves.toMatchObject({ fileName: "offer-letter-Alex Smith.pdf" });
});

it("loads a department directory while preserving the signed-in employee's self details", async () => {
  const summary = (id: string, code: string, firstName: string) => ({
    id, employeeCode: code, firstName, lastName: "User", email: `${code.toLowerCase()}@example.invalid`,
    hireDate: "2025-01-01", employmentStatus: "ACTIVE",
    department: { id: "department-1", name: "Service", code: "SERVICE" },
    position: { title: "Engineer", code: "ENGINEER" },
  });
  const self = { ...summary("employee-1", "EMP-1", "Self"), salary: "4200", salaryRecords: [{ baseSalary: "4200" }] };
  const coworker = summary("employee-2", "EMP-2", "Coworker");
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://local").pathname;
    const data = path === "/api/v1/employees/me" ? self : path === "/api/v1/employees" ? [self, coworker] : [];
    return { ok: true, status: 200, json: async () => ({ success: true, data, meta: { total: Array.isArray(data) ? data.length : 1, page: 1, limit: 100, totalPages: 1 } }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  const session: BackendSession = {
    id: "user-1", email: self.email, displayName: "Self User", csrfToken: "csrf", roles: ["EMPLOYEE"],
    permissions: ["employee.self.read", "employee.department.read", "employee.self.read_compensation"], departmentScopeIds: [],
    sessionId: "session-1", authProvider: "local", authorizationVersion: 1, employeeId: self.id,
  };

  const loaded = await loadBackendState(defaultState(), session);

  expect(loaded.state.employees.map(employee => employee.id).sort()).toEqual(["employee-1", "employee-2"]);
  expect(loaded.state.employees.find(employee => employee.id === self.id)?.fields.Basic).toBe("4200");
  expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(expect.arrayContaining([
    expect.stringContaining("/api/v1/employees?"),
    expect.stringContaining("/api/v1/employees/me"),
  ]));
});
