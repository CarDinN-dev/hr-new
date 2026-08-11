import { describe, expect, it } from "vitest";
import { filterEmployeePickerOptions } from "./employee-picker";

const employees = [
  { id: "1", label: "MT-001 — Aisha Noor" },
  { id: "2", label: "MT-002 — Omar Khalid" },
];

describe("filterEmployeePickerOptions", () => {
  it("finds employees by code or name", () => {
    expect(filterEmployeePickerOptions(employees, "002")).toEqual([employees[1]]);
    expect(filterEmployeePickerOptions(employees, "aisha")).toEqual([employees[0]]);
  });

  it("returns no matches for an unknown employee", () => {
    expect(filterEmployeePickerOptions(employees, "unknown")).toEqual([]);
  });
});
