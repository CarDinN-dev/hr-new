import { afterEach, expect, it, vi } from "vitest";
import { apiDownload, apiList, apiPage, apiRequest } from "./api";

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
