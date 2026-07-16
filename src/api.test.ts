import { afterEach, expect, it, vi } from "vitest";
import { apiPage } from "./api";

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
