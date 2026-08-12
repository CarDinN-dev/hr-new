import { describe, expect, it, vi } from "vitest";
import { importWithReleaseRetry } from "./dynamic-import";

function recovery() {
  const values = new Map<string, string>();
  return {
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    },
    reload: vi.fn()
  };
}

describe("dynamic import recovery", () => {
  it("returns a successful import without reloading", async () => {
    const state = recovery();

    await expect(importWithReleaseRetry("audit", () => Promise.resolve("page"), state)).resolves.toBe("page");
    expect(state.reload).not.toHaveBeenCalled();
  });

  it("reloads once for a failed release asset and then surfaces the repeated failure", async () => {
    const state = recovery();
    const error = new TypeError("Failed to fetch dynamically imported module: https://hr.med-tech.com/assets/audit-page-old.js");
    const firstAttempt = importWithReleaseRetry("audit", () => Promise.reject(error), state);

    await expect(Promise.race([firstAttempt.then(() => "resolved"), Promise.resolve("reloading")])).resolves.toBe("reloading");
    expect(state.reload).toHaveBeenCalledTimes(1);
    await expect(importWithReleaseRetry("audit", () => Promise.reject(error), state)).rejects.toBe(error);
    expect(state.reload).toHaveBeenCalledTimes(1);
  });
});
