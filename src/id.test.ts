import { describe, expect, it, vi } from "vitest";
import { newId } from "./id";

describe("newId", () => {
  it("works when crypto.randomUUID is unavailable", () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", {});

    expect(newId()).toMatch(/^id-/);

    vi.stubGlobal("crypto", originalCrypto);
  });
});
