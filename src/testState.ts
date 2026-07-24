import { createEmptyEmployee, defaultState, normalizeEmployee, type EmployeeRecord, type HrState } from "./data";

export function testState(): HrState {
  const state = defaultState();
  const employees = [
    testEmployee("TEST-0001", "Test", "One", "Finance", "2021-03-12", 20_000),
    testEmployee("TEST-0002", "Test", "Two", "Service", "2022-04-13", 17_500),
    testEmployee("TEST-0003", "Test", "Three", "Sales", "2023-05-14", 15_200),
    testEmployee("TEST-0004", "Test", "Four", "Human Resources", "2024-06-15", 14_600),
  ];
  const job = {
    id: "test-job",
    version: 1,
    title: "Test Engineer",
    dept: "Service",
    openings: 1,
    status: "Open" as const,
    postedOn: "2026-06-20",
    description: "Test fixture",
  };
  return {
    ...state,
    employees,
    jobs: [job],
    candidates: [{
      id: "test-candidate",
      version: 1,
      jobId: job.id,
      name: "Candidate Test",
      email: "candidate@example.invalid",
      phone: "+000000000",
      stage: "Offer",
      rating: 5,
      notes: "Test fixture",
      appliedOn: "2026-06-23",
    }],
  };
}

function testEmployee(
  code: string,
  firstName: string,
  lastName: string,
  department: string,
  joiningDate: string,
  total: number,
): EmployeeRecord {
  const employee = createEmptyEmployee(code);
  employee.id = `employee-${code.toLowerCase()}`;
  employee.fields = {
    ...employee.fields,
    "First Name": firstName,
    "Last Name": lastName,
    "Full Name": `${firstName} ${lastName}`,
    Department: department,
    Designation: "Test role",
    "Joining Date": joiningDate,
    "E-Mail ID (Work)": `${code.toLowerCase()}@example.invalid`,
    Basic: String(total * 0.75),
    HRA: String(total * 0.2),
    "Special Allowance": String(total * 0.05),
    Total: String(total),
  };
  return normalizeEmployee(employee);
}
