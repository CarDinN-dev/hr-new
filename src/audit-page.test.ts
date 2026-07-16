import { describe, expect, it } from "vitest";
import { auditParams } from "./features/audit-page";

describe("audit history pagination", () => {
  it("requests the selected page size without losing filters", () => {
    const params = auditParams(
      { search: "payroll", outcome: "SUCCESS", action: "", resourceType: "", dateFrom: "", dateTo: "" },
      { page: 2, limit: 50 },
    );

    expect(Object.fromEntries(params)).toMatchObject({ search: "payroll", outcome: "SUCCESS", page: "2", limit: "50" });
  });
});
