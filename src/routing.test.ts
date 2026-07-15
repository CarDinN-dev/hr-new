import { describe, expect, it } from "vitest";
import { navItemForPath, navPaths } from "./routing";

describe("application routes", () => {
  it("maps every unique module URL back to its navigation item", () => {
    expect(new Set(Object.values(navPaths)).size).toBe(Object.keys(navPaths).length);
    for (const [nav, path] of Object.entries(navPaths)) {
      expect(navItemForPath(path)).toBe(nav);
      if (path !== "/") expect(navItemForPath(`${path}/`)).toBe(nav);
    }
  });
});
