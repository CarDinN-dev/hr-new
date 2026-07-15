import { newId } from "./id";

export const employeeImportColumns = [
  "Employee Code", "Employee Category", "First Name", "Last Name", "Full Name", "Work Shift", "Company", "Sponsor Name", "WPS Sponsor",
  "Department", "Designation", "Grade/Band", "Date of Birth", "Joining Date", "Reporting Manager Employee Code/Name", "Family Status (Yes/No)",
  "Leave Policy", "Last Rejoin Date", "Annual Leave Balance (As on Date)", "Annual Leave Balance", "LOP Days (Loss of Pay)", "Business Unit",
  "Working Company Name", "Cost Centre", "Nationality", "RP/ID Number", "RP/ID Profession", "QID Expiry Date", "Visa Type", "Hire Type",
  "Confirmation Date", "ESB Date", "Gender", "Marital Status", "Office Mobile No.", "Personal Mobile No.", "E-Mail ID (Work)", "No. of Dependents",
  "Blood Group", "Local Building/Villa #", "Local Street #", "Local Zone #", "International Apartment", "International Building", "International Floor",
  "International Street", "International State", "International Country", "International Zip Code", "Emergency Contact Name", "Emergency Contact Relationship",
  "Emergency Contact Mobile No.", "Travel Sector", "Travel Cost", "No. of Tickets - Employee (Year)", "Ticket Balance (%)", "No. of Tickets - Family",
  "Salary Pay Type", "Company Accommodation", "Company Transportation", "Overtime Eligible", "Company Food", "Company Fuel Card", "Work Permit No.",
  "Work Permit Issue Date", "Work Permit Expiry Date", "Office File No.", "Access Card No.", "Bank Code", "IBAN No.", "Account No.",
  "Highest Education Qualification", "Year of Passing", "Passport No.", "Passport Place of Issue", "Passport Issue Date", "Passport Expiry Date",
  "License Type", "Driving License No.", "Driving License Expiry Date", "Insurance Card No.", "Insurance Issue Date", "Insurance Expiry Date",
  "Basic", "HRA", "Food Allowance", "Mobile Allowance", "Special Allowance", "Overtime Amount", "Total"
] as const;

export const employeeProfileSections = [
  { title: "Core Employment Details", fields: ["Employee Code", "Employee Category", "Full Name", "Work Shift", "Company", "Department", "Designation", "Grade/Band", "Joining Date", "Reporting Manager Employee Code/Name", "Business Unit", "Working Company Name", "Cost Centre", "Hire Type", "Confirmation Date", "ESB Date"] },
  { title: "Personal & Identity", fields: ["First Name", "Last Name", "Date of Birth", "Gender", "Marital Status", "Family Status (Yes/No)", "No. of Dependents", "Nationality", "Blood Group"] },
  { title: "Residency, Visa & Access", fields: ["Sponsor Name", "WPS Sponsor", "RP/ID Number", "RP/ID Profession", "QID Expiry Date", "Visa Type", "Work Permit No.", "Work Permit Issue Date", "Work Permit Expiry Date", "Office File No.", "Access Card No."] },
  { title: "Contact & Addresses", fields: ["Office Mobile No.", "Personal Mobile No.", "E-Mail ID (Work)", "Local Building/Villa #", "Local Street #", "Local Zone #", "International Apartment", "International Building", "International Floor", "International Street", "International State", "International Country", "International Zip Code"] },
  { title: "Leave, Travel & Benefits", fields: ["Leave Policy", "Last Rejoin Date", "Annual Leave Balance (As on Date)", "Annual Leave Balance", "LOP Days (Loss of Pay)", "Travel Sector", "Travel Cost", "No. of Tickets - Employee (Year)", "Ticket Balance (%)", "No. of Tickets - Family", "Company Accommodation", "Company Transportation", "Overtime Eligible", "Company Food", "Company Fuel Card"] },
  { title: "Bank & Salary", fields: ["Salary Pay Type", "Bank Code", "IBAN No.", "Account No.", "Basic", "HRA", "Food Allowance", "Mobile Allowance", "Special Allowance", "Overtime Amount", "Total"] },
  { title: "Qualifications & Documents", fields: ["Highest Education Qualification", "Year of Passing", "Passport No.", "Passport Place of Issue", "Passport Issue Date", "Passport Expiry Date", "License Type", "Driving License No.", "Driving License Expiry Date", "Insurance Card No.", "Insurance Issue Date", "Insurance Expiry Date"] },
  { title: "Emergency Contact", fields: ["Emergency Contact Name", "Emergency Contact Relationship", "Emergency Contact Mobile No."] }
] as const;

export type AttendanceCode = "P" | "H" | "L" | "A";
export type AttendanceApproval = "Approved" | "Not approved";
export type EmployeeStatus = "Active" | "On Leave" | "Resigned" | "Terminated";
export type EmployeeRecord = { id: string; status: EmployeeStatus; fields: Record<string, string>; photo?: string };
export type LeaveStatus = "Pending" | "Approved" | "Rejected";

export type LeaveRequest = {
  id: string;
  employeeId: string;
  type: string;
  from: string;
  to: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  reviewStage?: "Manager" | "HR";
  appliedOn: string;
  decidedOn?: string;
};

export type PayrollSlip = {
  id: string;
  employeeId: string;
  year: number;
  month: number;
  basic: number;
  housing: number;
  allowances: number;
  overtime: number;
  bonus: number;
  deductions: number;
  loanDeduction: number;
  loanDeductions: PayrollLoanDeduction[];
  lopDays: number;
  lopAmount: number;
  gross: number;
  net: number;
  note: string;
  status: "Draft" | "Finalized";
};

export type LoanRepaymentMode = "Duration" | "Monthly limit" | "Manual";
export type LoanStatus = "Draft" | "Active" | "Paused" | "Settled" | "Cancelled";
export type LoanDeductionOverride = { amount: number; reason: string; approvedAboveLimit?: boolean; updatedOn: string };
export type PayrollLoanDeduction = { loanId: string; amount: number };

export type EmployeeLoan = {
  id: string;
  employeeId: string;
  type: string;
  principal: number;
  disbursementDate: string;
  startPeriod: string;
  repaymentMode: LoanRepaymentMode;
  termMonths: number;
  monthlyLimit: number;
  status: LoanStatus;
  reference: string;
  notes: string;
  createdOn: string;
  deductionOverrides: Record<string, LoanDeductionOverride>;
};

export type LoanRepayment = {
  id: string;
  loanId: string;
  payrollId?: string;
  year: number;
  month: number;
  amount: number;
  source: "Payroll" | "Manual";
  status: "Posted" | "Reversed";
  note: string;
  postedOn: string;
};

export type BusinessTrip = {
  id: string;
  employeeId: string;
  destination: string;
  purpose: string;
  from: string;
  to: string;
  days: number;
  perDiem: number;
  travelCost: number;
  advanceAmount: number;
  status: "Pending" | "Approved" | "Rejected" | "Closed";
  createdOn: string;
};

export type EmployeeExpense = {
  id: string;
  employeeId: string;
  tripId?: string;
  category: string;
  date: string;
  amount: number;
  description: string;
  status: "Submitted" | "Approved" | "Rejected" | "Paid";
  createdOn: string;
};

export type RecruitmentJobStatus = "Open" | "On Hold" | "Closed";
export type CandidateStage = "Applied" | "Screening" | "Interview" | "Offer" | "Hired" | "Rejected";

export type RecruitmentJob = {
  id: string;
  title: string;
  dept: string;
  openings: number;
  status: RecruitmentJobStatus;
  postedOn: string;
  description: string;
};

export type RecruitmentCandidate = {
  id: string;
  jobId: string;
  name: string;
  email: string;
  phone: string;
  stage: CandidateStage;
  rating: number;
  notes: string;
  appliedOn: string;
  employeeId?: string;
};

export type EosRecord = {
  id: string;
  employeeId: string;
  asOf: string;
  reason: string;
  serviceYears: number;
  gratuity: number;
  leaveEncashment: number;
  lopDeduction: number;
  expenseReimbursement: number;
  tripAdvanceDeduction: number;
  netSettlement: number;
  status: "Draft" | "Approved" | "Paid";
  createdOn: string;
};

export type DocumentLog = {
  id: string;
  template: PdfTemplate;
  employeeId: string;
  documentNumber: string;
  generatedOn: string;
  status: "Generated";
  filename?: string;
  dataUrl?: string;
  downloadUrl?: string;
  sizeBytes?: number;
};

export type HrSettings = {
  company: {
    name: string;
    legalName: string;
    tagline: string;
    address: string;
    phone: string;
    email: string;
    website: string;
    currency: string;
    wpsEmployerEid?: string;
    wpsPayerEid?: string;
    wpsPayerQid?: string;
    wpsPayerBank?: string;
    wpsPayerIban?: string;
    accountPhoto?: string;
  };
  departments: string[];
  leaveTypes: Array<{ id: string; name: string; days: number }>;
  documentSeq: number;
  workdayHours: number;
  halfDayHours: number;
  loanDeductionCap: { type: "Amount" | "Percent"; value: number };
};

export type HrState = {
  employees: EmployeeRecord[];
  attendance: Record<string, Record<string, AttendanceCode>>;
  attendanceApprovals: Record<string, Record<string, AttendanceApproval>>;
  leaves: LeaveRequest[];
  payroll: PayrollSlip[];
  businessTrips: BusinessTrip[];
  expenses: EmployeeExpense[];
  loans: EmployeeLoan[];
  loanRepayments: LoanRepayment[];
  jobs: RecruitmentJob[];
  candidates: RecruitmentCandidate[];
  eosRecords: EosRecord[];
  documents: DocumentLog[];
  settings: HrSettings;
};

export type PdfTemplate =
  | "offer_letter"
  | "appointment_letter"
  | "employment_contract"
  | "salary_certificate"
  | "experience_certificate"
  | "warning_letter"
  | "payslip"
  | "leave_approval"
  | "clearance_certificate"
  | "final_settlement"
  | "gratuity_statement"
  | "employee_profile"
  | "employee_directory"
  | "attendance_report"
  | "leave_report"
  | "payroll_register"
  | "headcount_report";

export const pdfTemplates: Array<{ id: PdfTemplate; label: string; category: string }> = [
  { id: "offer_letter", label: "Offer Letter", category: "Recruitment" },
  { id: "appointment_letter", label: "Appointment Letter", category: "Employment" },
  { id: "employment_contract", label: "Employment Contract", category: "Employment" },
  { id: "salary_certificate", label: "Salary Certificate", category: "Letters" },
  { id: "experience_certificate", label: "Experience Certificate", category: "Letters" },
  { id: "warning_letter", label: "Warning Letter", category: "Employee Relations" },
  { id: "payslip", label: "Payslip", category: "Payroll" },
  { id: "leave_approval", label: "Leave Approval", category: "Leave" },
  { id: "clearance_certificate", label: "Clearance Certificate", category: "Exit" },
  { id: "final_settlement", label: "Final Settlement", category: "Exit" },
  { id: "gratuity_statement", label: "Gratuity Statement", category: "Exit" }
];

export const reportTemplates: Array<{ id: PdfTemplate; label: string; description: string }> = [
  { id: "employee_directory", label: "Employee Directory", description: "Full staff directory with employment, contact and status fields." },
  { id: "attendance_report", label: "Monthly Attendance", description: "Present, half-day, leave, absent and attendance percentage by employee." },
  { id: "leave_report", label: "Leave Register", description: "Leave applications with date range, duration, reason and approval state." },
  { id: "payroll_register", label: "Payroll Register", description: "Gross, additions, deductions, loss of pay and net salary for the month." },
  { id: "headcount_report", label: "Department Headcount", description: "Active headcount split by department." }
];

export const navItems = [
  "Dashboard",
  "My HR",
  "Team",
  "Employees",
  "Attendance",
  "Leave",
  "Business Trips",
  "Expenses",
  "Loans",
  "Payroll",
  "Recruitment",
  "EOS",
  "Documents",
  "Reports",
  "Audit",
  "System",
  "Settings"
] as const;

export type NavItem = typeof navItems[number];

export const statusOptions: EmployeeStatus[] = ["Active", "On Leave", "Resigned", "Terminated"];
export const candidateStages: CandidateStage[] = ["Applied", "Screening", "Interview", "Offer", "Hired", "Rejected"];
export const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function splitEmployeeName(fullName: string) {
  const [firstName = "", ...lastName] = fullName.trim().split(/\s+/).filter(Boolean);
  return { firstName, lastName: lastName.join(" ") };
}

export function createEmptyEmployee(code: string): EmployeeRecord {
  const fields = Object.fromEntries(employeeImportColumns.map(column => [column, ""]));
  return {
    id: newId(),
    status: "Active",
    fields: {
      ...fields,
      "Employee Code": code,
      "Employee Category": "Staff",
      "Company": "MedTech Corporation Trading W.L.L.",
      "Working Company Name": "MedTech Corporation Trading W.L.L.",
      "Work Shift": "Standard day",
      "Leave Policy": "Qatar standard",
      "Salary Pay Type": "Bank Transfer",
      "Hire Type": "Direct",
      "Overtime Eligible": "No"
    }
  };
}

export function normalizeEmployee(employee: EmployeeRecord): EmployeeRecord {
  const fields = { ...Object.fromEntries(employeeImportColumns.map(column => [column, ""])), ...employee.fields };
  const fullName = fields["Full Name"] || `${fields["First Name"]} ${fields["Last Name"]}`.trim();
  const name = splitEmployeeName(fullName);
  const total = fields.Total || String(
    moneyField(fields.Basic) +
    moneyField(fields.HRA) +
    moneyField(fields["Food Allowance"]) +
    moneyField(fields["Mobile Allowance"]) +
    moneyField(fields["Special Allowance"]) +
    moneyField(fields["Overtime Amount"])
  );

  return {
    ...employee,
    fields: {
      ...fields,
      "First Name": fields["First Name"] || name.firstName,
      "Last Name": fields["Last Name"] || name.lastName,
      "Full Name": fullName,
      Total: total
    }
  };
}

export function defaultState(): HrState {
  return {
    employees: [],
    attendance: {},
    attendanceApprovals: {},
    leaves: [],
    payroll: [],
    businessTrips: [],
    expenses: [],
    loans: [],
    loanRepayments: [],
    jobs: [],
    candidates: [],
    eosRecords: [],
    documents: [],
    settings: {
      company: {
        name: "MedTech",
        legalName: "MedTech Corporation Trading W.L.L.",
        tagline: "Human Resources Operations",
        address: "Doha, State of Qatar",
        phone: "+974 4000 0000",
        email: "hr@medtech.qa",
        website: "www.medtech.qa",
        currency: "QAR",
        wpsEmployerEid: "",
        wpsPayerEid: "",
        wpsPayerQid: "",
        wpsPayerBank: "",
        wpsPayerIban: "",
        accountPhoto: ""
      },
      departments: ["Sales", "Service", "Warehouse", "Finance", "Projects", "Procurement", "Human Resources", "Quality", "Management"],
      leaveTypes: [
        { id: "lt-annual", name: "Annual leave", days: 30 },
        { id: "lt-sick", name: "Sick leave", days: 14 },
        { id: "lt-emergency", name: "Emergency leave", days: 3 },
        { id: "lt-unpaid", name: "Unpaid leave", days: 0 }
      ],
      documentSeq: 0,
      workdayHours: 8,
      halfDayHours: 4,
      loanDeductionCap: { type: "Amount", value: 0 }
    }
  };
}

function moneyField(value: string) {
  const number = Number(String(value || "0").replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}
