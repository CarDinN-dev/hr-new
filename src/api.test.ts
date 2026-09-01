import { afterEach, expect, it, vi } from "vitest";
import { ApiError, apiDownload, apiList, apiPage, apiRequest, authorizationExpiredEvent, backendSessionUpdatedEvent, restoreBackendSession } from "./api";

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

function sessionResponse(id: string, csrfToken: string) {
  return { success: true, data: { csrfToken, user: { id, email: `${id}@example.invalid`, displayName: id, roles: [], permissions: [], departmentScopeIds: [], sessionId: `${id}-session`, authProvider: "local", authorizationVersion: 1 } } };
}

it("refreshes and retries a write after the same user receives a newer session cookie", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sessionResponse("user-1", "stale-token") })
    .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ success: false, message: "Invalid CSRF token" }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sessionResponse("user-1", "fresh-token") })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, data: { read: true } }) });
  const updated = vi.fn();
  window.addEventListener(backendSessionUpdatedEvent, updated);
  vi.stubGlobal("fetch", fetchMock);

  await restoreBackendSession();
  await expect(apiRequest("/notifications/notification-1/read", { method: "POST", csrfToken: "stale-token" })).resolves.toEqual({ read: true });

  expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).toHaveProperty("get");
  expect(((fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Headers).get("X-CSRF-Token")).toBe("stale-token");
  expect(((fetchMock.mock.calls[3]?.[1] as RequestInit).headers as Headers).get("X-CSRF-Token")).toBe("fresh-token");
  expect(updated).toHaveBeenCalledOnce();
  window.removeEventListener(backendSessionUpdatedEvent, updated);
});

it("does not replay a write after the browser switches to another account", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sessionResponse("user-1", "stale-token") })
    .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ success: false, message: "Invalid CSRF token" }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sessionResponse("user-2", "fresh-token") });
  const expired = vi.fn();
  window.addEventListener(authorizationExpiredEvent, expired);
  vi.stubGlobal("fetch", fetchMock);

  await restoreBackendSession();
  await expect(apiRequest("/notifications/notification-1/read", { method: "POST", csrfToken: "stale-token" })).rejects.toEqual(new ApiError("Your active account changed. Sign in again before retrying this action.", 401));

  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(expired).toHaveBeenCalledOnce();
  window.removeEventListener(authorizationExpiredEvent, expired);
});
