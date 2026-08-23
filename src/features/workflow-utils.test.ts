import { describe, expect, it } from "vitest";
import { paginationLabel } from "./workflow-utils";

describe("paginationLabel", () => {
  it("reports the visible range, including empty results", () => {
    expect(paginationLabel(42, 2, 15, "entries")).toBe("Showing 16–30 of 42 entries");
    expect(paginationLabel(0, 1, 15, "entries")).toBe("Showing 0–0 of 0 entries");
  });
});
