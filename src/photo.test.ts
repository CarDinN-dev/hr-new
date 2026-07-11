import { describe, expect, it } from "vitest";
import { photoFileError } from "./photo";

describe("employee photo validation", () => {
  it("accepts supported photos and rejects unsafe inputs", () => {
    expect(photoFileError({ type: "image/jpeg", size: 500_000 })).toBe("");
    expect(photoFileError({ type: "image/svg+xml", size: 500_000 })).toContain("JPEG");
    expect(photoFileError({ type: "image/png", size: 9_000_000 })).toContain("8 MB");
  });
});
