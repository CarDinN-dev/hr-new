import { describe, expect, it } from "vitest";
import { mapEmployee, type BackendEmployee } from "./api";
import { employeeImportRowPayload, remapEmployeeIds } from "./normalizedSync";
import { testState } from "./testState";

describe("normalized employee synchronization", () => {
  it("round-trips photo, relations, and exact salary components", () => {
    const backend: BackendEmployee = {
      id: "employee-server",
      employeeCode: "EMP-900",
      firstName: "Exact",
      lastName: "Roundtrip",
      email: "exact.roundtrip@example.invalid",
      hireDate: "2026-01-15T00:00:00.000Z",
      employmentStatus: "ACTIVE",
      photo: "data:image/png;base64,aGVsbG8=",
      departmentId: "department-1",
      positionId: "position-1",
      managerId: "manager-1",
      department: { id: "department-1", name: "Finance", code: "FIN" },
      position: { title: "Accountant", code: "ACC" },
      manager: { employeeCode: "MGR-1", firstName: "Line", lastName: "Manager" },
      salaryRecords: [{
        baseSalary: "7000", allowances: "1250", housingAllowance: "900", foodAllowance: "200",
        mobileAllowance: "100", specialAllowance: "50", bonuses: "75", overtimeAmount: "75",
      }],
    };

    const employee = mapEmployee(backend);
    const payload = employeeImportRowPayload(
      employee,
      new Map([["Finance", "department-1"]]),
      new Map([["department-1:Accountant", "position-1"]]),
    );

    expect(payload).toMatchObject({
      sourceId: "employee-server",
      photo: backend.photo,
      departmentId: "department-1",
      positionId: "position-1",
      managerEmployeeCode: "MGR-1",
      salaryRecord: {
        baseSalary: 7000,
        allowances: 1250,
        housingAllowance: 900,
        foodAllowance: 200,
        mobileAllowance: 100,
        specialAllowance: 50,
        overtimeAmount: 75,
        bonuses: 75,
      },
    });
  });

  it("maps a server-created employee ID into every dependent record in the same pass", () => {
    const state = testState();
    const localId = state.employees[0].id;
    const serverId = "server-created-employee";
    const withDependencies = {
      ...state,
      attendance: { "2026-07-01": { [localId]: "P" as const } },
      attendanceApprovals: { "2026-07-01": { [localId]: "Approved" as const } },
      leaves: [{ id: "leave-1", employeeId: localId, type: "Annual leave", from: "2026-07-01", to: "2026-07-01", days: 1, reason: "Test", status: "Pending" as const, appliedOn: "2026-06-20" }],
      payroll: [{ id: "payroll-1", employeeId: localId, year: 2026, month: 7, basic: 100, housing: 0, allowances: 0, overtime: 0, bonus: 0, deductions: 0, loanDeduction: 0, loanDeductions: [], lopDays: 0, lopAmount: 0, gross: 100, net: 100, note: "", status: "Draft" as const }],
      businessTrips: [{ id: "trip-1", employeeId: localId, destination: "Doha", purpose: "Test", from: "2026-07-01", to: "2026-07-01", days: 1, perDiem: 0, travelCost: 0, advanceAmount: 0, status: "Pending" as const, createdOn: "2026-06-20" }],
      expenses: [{ id: "expense-1", employeeId: localId, category: "Travel", date: "2026-07-01", amount: 1, description: "Test", status: "Submitted" as const, createdOn: "2026-07-01" }],
      loans: [{ id: "loan-1", employeeId: localId, type: "Personal", principal: 100, disbursementDate: "2026-06-01", startPeriod: "2026-07", repaymentMode: "Duration" as const, termMonths: 2, monthlyLimit: 50, status: "Draft" as const, reference: "", notes: "", createdOn: "2026-06-01", deductionOverrides: {} }],
      candidates: [{ ...state.candidates[0], employeeId: localId }],
      eosRecords: [{ id: "eos-1", employeeId: localId, asOf: "2026-07-31", reason: "Test", serviceYears: 1, gratuity: 1, leaveEncashment: 1, lopDeduction: 0, expenseReimbursement: 0, tripAdvanceDeduction: 0, netSettlement: 2, status: "Draft" as const, createdOn: "2026-07-01" }],
      documents: [{ id: "document-1", employeeId: localId, template: "employee_profile" as const, documentNumber: "DOC-1", generatedOn: "2026-07-01", status: "Generated" as const }],
    };

    const mapped = remapEmployeeIds(withDependencies, new Map([[localId, serverId]]));
    expect(mapped.employees[0].id).toBe(serverId);
    expect(mapped.attendance["2026-07-01"][serverId]).toBe("P");
    expect(mapped.attendanceApprovals["2026-07-01"][serverId]).toBe("Approved");
    for (const record of [mapped.leaves[0], mapped.payroll[0], mapped.businessTrips[0], mapped.expenses[0], mapped.loans[0], mapped.candidates[0], mapped.eosRecords[0], mapped.documents[0]]) {
      expect(record.employeeId).toBe(serverId);
    }
  });
});
