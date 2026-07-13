import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarCheck,
  Download,
  Eye,
  FileText,
  ImagePlus,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Search,
  ShieldCheck,
  Settings,
  Sun,
  Trash2,
  Upload,
  UserRoundPlus,
  UsersRound,
  WalletCards,
  X
} from "lucide-react";
import {
  createEmptyEmployee,
  defaultState,
  employeeProfileSections,
  months,
  navItems,
  pdfTemplates,
  reportTemplates,
  statusOptions,
  type AttendanceCode,
  type BusinessTrip,
  candidateStages,
  type EmployeeRecord,
  type EosRecord,
  type EmployeeExpense,
  type HrState,
  type NavItem,
  type PayrollSlip,
  type PdfTemplate,
  type RecruitmentCandidate,
  type RecruitmentJob
} from "./data";
import { applyEmployeeRows, parseEmployeeSheet, parseEmployeeWorkbook } from "./employeeSheet";
import { applyAttendanceRows, attendanceTemplateHtml, parseAttendanceSheet } from "./attendanceSheet";
import { payrollExportWarnings, payrollSheetHtml, sifCsv } from "./payrollExports";
import {
  activeEmployees,
  attendanceStats,
  candidatePipeline,
  clearAttendanceDay,
  decideAttendance,
  createEosRecord,
  createPayroll,
  deleteEmployee,
  deleteLeave,
  decideLeave,
  documentNumber,
  employeeName,
  employeeSalary,
  eosSummary,
  expenseTotals,
  formatDate,
  formatMoney,
  hireCandidateAsEmployee,
  inclusiveDays,
  initials,
  leaveBalanceSummary,
  markAllAttendance,
  nextEmployeeCode,
  recalcSlip,
  setAttendance,
  todayISO,
  tripTotal,
  upcomingBirthdays,
  upsertEmployee,
  withNextDocumentSeq
} from "./domain";
import {
  apiBaseUrl,
  backendSessionKey,
  createBackendBackup,
  generateBackendPayroll,
  loadBackupStatus,
  loadBackendSession,
  loadBackendState,
  loginBackend,
  logoutBackend,
  rollbackLatestBackendBackup,
  saveBackendState,
  type BackendBackupStatus,
  type BackendSession
} from "./api";
import { newId } from "./id";
import { preparePhoto } from "./photo";
import type { GeneratedPdf } from "./pdf";
import { openDataUrl } from "./dataUrl";
import "./styles.css";

const storageKey = "medtech-hr-erp-v1";
const themeKey = "medtech-hr-theme";
type Theme = "light" | "dark";
const LoginScene = React.lazy(() => import("./LoginScene"));
const navIcon = {
  Dashboard: LayoutDashboard,
  Employees: UsersRound,
  Attendance: CalendarCheck,
  Leave: BriefcaseBusiness,
  "Business Trips": BriefcaseBusiness,
  Expenses: WalletCards,
  Payroll: WalletCards,
  Recruitment: UserRoundPlus,
  EOS: FileText,
  Documents: FileText,
  Reports: BarChart3,
  Settings
};

async function withPdf<T>(action: (pdf: typeof import("./pdf")) => T) {
  return action(await import("./pdf"));
}

function templateName(id: PdfTemplate) {
  return pdfTemplates.find(item => item.id === id)?.label ?? reportTemplates.find(item => item.id === id)?.label ?? id;
}

function confirmDelete(label: string) {
  return window.confirm(`Delete ${label}? This cannot be undone.`);
}

function accountInitials(value: string) {
  return value.split("@")[0].split(/[.\s_-]+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "HR";
}

function LoginPage({ onLogin, notify, theme, toggleTheme }: { onLogin: (session: BackendSession) => void; notify: (message: string) => void; theme: Theme; toggleTheme: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      onLogin(await loginBackend(email, password));
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <span className="login-logo"><img src="/logos/brand-mark.svg" alt="MedTech" /></span>
          <span><ShieldCheck size={18} /> Secure HR access</span>
        </div>
        <div>
          <p className="section-label">MedTech Corporation Trading W.L.L.</p>
          <h1>Secure workforce control for healthcare operations.</h1>
          <p className="muted">Built around MedTech's medical and laboratory equipment operations: precise records, protected access, and payroll-ready HR data.</p>
          <div className="login-proof"><span>Excellence</span><span>Expertise</span><span>Ethics</span></div>
        </div>
        <form className="login-form" onSubmit={submit}>
          <label htmlFor="login-email">Email<input id="login-email" name="email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label>
          <label htmlFor="login-password">Password<input id="login-password" name="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
          <button className="primary" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
        </form>
        <button className="theme-login" type="button" onClick={toggleTheme}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />} {theme === "dark" ? "Light mode" : "Dark mode"}</button>
      </section>
      <section className="login-stage" aria-label="MedTech secure workforce platform">
        <React.Suspense fallback={<div className="login-scene-fallback" />}><LoginScene /></React.Suspense>
        <div className="login-stage-copy">
          <span>Protected HR workspace</span>
          <strong>Precision in every people decision.</strong>
          <small>Role-based access, local PostgreSQL records and payroll-ready controls.</small>
        </div>
      </section>
    </main>
  );
}

function App() {
  const [state, setState] = useState<HrState>(() => loadState());
  const [nav, setNav] = useState<NavItem>("Dashboard");
  const [toast, setToast] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modal, setModal] = useState<React.ReactNode>(null);
  const [backendSession, setBackendSession] = useState<BackendSession | null>(() => loadBackendSession());
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem(themeKey) === "dark" ? "dark" : "light");
  const backendReady = useRef(false);
  const backendSessionRef = useRef<BackendSession | null>(backendSession);

  useEffect(() => {
    localStorage.removeItem(storageKey);
  }, []);

  useEffect(() => {
    backendSessionRef.current = backendSession;
    if (backendSession) sessionStorage.setItem(backendSessionKey, JSON.stringify(backendSession));
    else sessionStorage.removeItem(backendSessionKey);
    localStorage.removeItem(backendSessionKey);
  }, [backendSession]);

  useEffect(() => {
    if (!backendSession) {
      backendReady.current = false;
      return;
    }
    backendReady.current = false;
    loadBackendState(state, backendSession)
      .then(({ state: nextState, updatedAt }) => {
        setState(hydrateState(nextState));
        setBackendSession(prev => prev && updatedAt ? { ...prev, stateUpdatedAt: updatedAt } : prev);
      })
      .catch(error => notify(errorMessage(error)))
      .finally(() => {
        backendReady.current = true;
      });
  }, [backendSession?.token]);

  useEffect(() => {
    if (!backendSession?.token || !backendReady.current) return;
    const timer = window.setTimeout(() => {
      const session = backendSessionRef.current;
      if (!session) return;
      void saveBackendState(state, session)
        .then(saved => setBackendSession(prev => prev ? { ...prev, stateUpdatedAt: saved.updatedAt } : prev))
        .catch(error => notify(errorMessage(error)));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [state, backendSession?.token]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(themeKey, theme);
  }, [theme]);

  useEffect(() => {
    if (!modal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [modal]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  function closeModal() {
    setModal(null);
  }

  function savePdf(file: GeneratedPdf | undefined, template: PdfTemplate, employeeId = "") {
    if (!file) return;
    setState(prev => {
      const number = documentNumber(prev);
      const next = withNextDocumentSeq(prev);
      return {
        ...next,
        documents: [...next.documents, {
          id: newId(),
          employeeId,
          template,
          documentNumber: number,
          generatedOn: todayISO(),
          status: "Generated",
          filename: file.filename,
          dataUrl: file.dataUrl,
          sizeBytes: file.sizeBytes
        }]
      };
    });
    notify(`${file.filename} saved and added to Documents.`);
  }

  function toggleTheme() {
    setTheme(prev => prev === "dark" ? "light" : "dark");
  }

  async function logout() {
    const session = backendSessionRef.current;
    setBackendSession(null);
    if (!session) return;
    try {
      await logoutBackend(session);
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  if (!backendSession) {
    return (
      <>
        <LoginPage onLogin={session => { setBackendSession(session); notify(`Signed in as ${session.email}.`); }} notify={notify} theme={theme} toggleTheme={toggleTheme} />
        {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
      </>
    );
  }

  const pageHint = pageDescription(nav);

  return (
    <div className="app">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`} aria-label="Main navigation">
        <div className="brand-block">
          <span className="logo-crop wordmark"><img src="/logos/brand-mark.svg" alt="MedTech" /></span>
          <div>
            <strong>HR ERP</strong>
            <span>Qatar workforce operations</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="HR modules">
          {navItems.map(item => {
            const Icon = navIcon[item];
            return (
              <button key={item} className={item === nav ? "active" : ""} aria-current={item === nav ? "page" : undefined} onClick={() => { setNav(item); setSidebarOpen(false); }}>
                <Icon size={18} />
                {item}
              </button>
            );
          })}
        </nav>
        <AccountMenu
          state={state}
          backendSession={backendSession}
          onLogout={() => void logout()}
          setNav={setNav}
          theme={theme}
          toggleTheme={toggleTheme}
        />
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          <div className="page-title">
            <p className="section-label">MedTech Corporation Trading W.L.L.</p>
            <h1>{nav}</h1>
            <p className="page-hint">{pageHint}</p>
          </div>
        </header>

        <div className="content">
          {nav === "Dashboard" && <Dashboard state={state} setNav={setNav} onAddEmployee={() => {
            setNav("Employees");
            setModal(<EmployeeEditor state={state} close={closeModal} notify={notify} save={employee => setState(prev => upsertEmployee(prev, employee))} />);
          }} />}
          {nav === "Employees" && <Employees state={state} setState={setState} setModal={setModal} notify={notify} close={closeModal} savePdf={savePdf} />}
          {nav === "Attendance" && <Attendance state={state} setState={setState} savePdf={savePdf} notify={notify} />}
          {nav === "Leave" && <Leave state={state} setState={setState} setModal={setModal} notify={notify} close={closeModal} savePdf={savePdf} />}
          {nav === "Business Trips" && <BusinessTrips state={state} setState={setState} notify={notify} />}
          {nav === "Expenses" && <Expenses state={state} setState={setState} notify={notify} />}
          {nav === "Payroll" && <Payroll state={state} setState={setState} setModal={setModal} notify={notify} close={closeModal} savePdf={savePdf} />}
          {nav === "Recruitment" && <Recruitment state={state} setState={setState} notify={notify} setNav={setNav} />}
          {nav === "EOS" && <EOS state={state} setState={setState} notify={notify} savePdf={savePdf} />}
          {nav === "Documents" && <Documents state={state} setState={setState} notify={notify} savePdf={savePdf} />}
          {nav === "Reports" && <Reports state={state} notify={notify} savePdf={savePdf} />}
          {nav === "Settings" && <SettingsPage state={state} setState={setState} notify={notify} backendSession={backendSession} setBackendSession={setBackendSession} />}
        </div>
      </main>

      {sidebarOpen && <button aria-label="Close menu" className="scrim" onClick={() => setSidebarOpen(false)} />}
      {modal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeModal(); }}><div className="modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={closeModal} aria-label="Close"><X size={18} /></button>{modal}</div></div>}
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  );
}

function AccountMenu({
  state,
  backendSession,
  onLogout,
  setNav,
  theme,
  toggleTheme
}: {
  state: HrState;
  backendSession: BackendSession;
  onLogout: () => void;
  setNav: (nav: NavItem) => void;
  theme: Theme;
  toggleTheme: () => void;
}) {
  const [open, setOpen] = useState(false);
  const photo = state.settings.company.accountPhoto;

  function goSettings() {
    setOpen(false);
    setNav("Settings");
  }

  return <div className="account-menu">
    {open && <div className="account-popover" role="menu">
      <button role="menuitem" onClick={() => { toggleTheme(); setOpen(false); }}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />} {theme === "dark" ? "Light mode" : "Dark mode"}</button>
      <button role="menuitem" onClick={goSettings}><Settings size={16} /> Profile and settings</button>
      <button role="menuitem" onClick={goSettings}><Download size={16} /> Backups</button>
      <button role="menuitem" onClick={onLogout}><LogOut size={16} /> Log out</button>
    </div>}
    <button className="account-trigger" aria-expanded={open} onClick={() => setOpen(prev => !prev)}>
      <span className="account-avatar">{photo ? <img src={photo} alt="" /> : accountInitials(backendSession.email)}</span>
      <span className="account-label">
        <strong>{backendSession.email}</strong>
        <small>{backendSession.role}</small>
      </span>
    </button>
  </div>;
}

function Dashboard({ state, setNav, onAddEmployee }: { state: HrState; setNav: (nav: NavItem) => void; onAddEmployee: () => void }) {
  const active = activeEmployees(state.employees);
  const today = state.attendance[todayISO()] || {};
  const pendingLeave = state.leaves.filter(item => item.status === "Pending");
  const currentPayroll = state.payroll.filter(item => item.year === new Date().getFullYear() && item.month === new Date().getMonth() + 1);
  const expiringDocs = state.employees.filter(employee => daysUntil(employee.fields["QID Expiry Date"]) <= 60 || daysUntil(employee.fields["Passport Expiry Date"]) <= 60);
  const openJobs = state.jobs.filter(job => job.status === "Open");
  const pipelineCandidates = state.candidates.filter(candidate => candidate.stage !== "Hired" && candidate.stage !== "Rejected");
  const payrollTotal = currentPayroll.reduce((sum, slip) => sum + slip.net, 0);
  const headcount = state.settings.departments.map(department => ({
    department,
    count: active.filter(employee => employee.fields.Department === department).length
  })).filter(item => item.count > 0);
  const maxHeadcount = Math.max(1, ...headcount.map(item => item.count));
  const birthdays = upcomingBirthdays(state.employees, 30);
  const recentJoiners = [...state.employees]
    .sort((a, b) => (b.fields["Joining Date"] || "").localeCompare(a.fields["Joining Date"] || ""))
    .slice(0, 6);

  return (
    <>
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="section-label">Workforce command center</p>
          <span className="hero-logo-crop"><img src="/logos/brand-mark.svg" alt="MedTech" /></span>
          <h2>HR operations, payroll and workforce documents in one controlled workspace.</h2>
          <p>Use this HR-only ERP for employee records, attendance, leave approvals, payroll drafts, official PDFs and audit-ready backups.</p>
        </div>
        <div className="dashboard-snapshot">
          <span>Today's snapshot</span>
          <strong>{formatDate(todayISO())}</strong>
          <dl>
            <div><dt>Attendance</dt><dd>{Object.keys(today).length}/{active.length}</dd></div>
            <div><dt>Leave approvals</dt><dd>{pendingLeave.length}</dd></div>
            <div><dt>Compliance alerts</dt><dd>{expiringDocs.length}</dd></div>
          </dl>
        </div>
        <div className="hero-actions">
          <button className="primary" onClick={onAddEmployee}><UserRoundPlus size={17} /> Add employee</button>
          <button onClick={() => setNav("Payroll")}><WalletCards size={17} /> Run payroll</button>
        </div>
      </section>

      <section className="metric-grid">
        <Metric label="Active employees" value={active.length} hint={`${state.employees.length - active.length} inactive records`} />
        <Metric label="Marked today" value={Object.keys(today).length} hint="attendance entries" />
        <Metric label="Pending leave" value={pendingLeave.length} hint="manager/HR action" tone={pendingLeave.length ? "warn" : "ok"} />
        <Metric label="Open positions" value={openJobs.length} hint={`${pipelineCandidates.length} candidates in pipeline`} />
        <Metric label="Payroll this month" value={formatMoney(payrollTotal, state.settings.company.currency)} hint={`${currentPayroll.length} payslips`} />
        <Metric label="Docs expiring" value={expiringDocs.length} hint="next 60 days" tone={expiringDocs.length ? "warn" : "ok"} />
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="panel-head"><h3>Headcount by Department</h3><span>{active.length} active</span></div>
          <div className="bars">
            {headcount.map(item => (
              <div className="bar-row" key={item.department}>
                <span>{item.department}</span>
                <div><i style={{ width: `${Math.round(item.count / maxHeadcount * 100)}%` }} /></div>
                <b>{item.count}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h3>Pending Leave Approvals</h3><span>{pendingLeave.length} open</span></div>
          <DataTable
            empty="No pending leave requests."
            columns={["Employee", "Type", "Dates", "Days", "Status"]}
            rows={pendingLeave.slice(0, 6).map(leave => {
              const employee = state.employees.find(item => item.id === leave.employeeId);
              return [employeeName(employee), leave.type, `${formatDate(leave.from)} - ${formatDate(leave.to)}`, leave.days, leave.status];
            })}
          />
        </div>
      </section>

      <section className="two-col dashboard-secondary">
        <div className="panel">
          <div className="panel-head"><h3>Birthdays - next 30 days</h3><span>{birthdays.length} upcoming</span></div>
          {birthdays.length ? (
            <div className="event-list">
              {birthdays.slice(0, 8).map(item => (
                <div className="event-row" key={item.employee.id}>
                  <EmployeeAvatar employee={item.employee} small />
                  <div>
                    <strong>{employeeName(item.employee)}</strong>
                    <span>{item.employee.fields.Department || "Unassigned"}</span>
                  </div>
                  <Badge value={item.daysUntil === 0 ? "Today" : formatDate(item.date).replace(/\s\d{4}$/, "")} />
                </div>
              ))}
            </div>
          ) : <div className="empty">No upcoming birthdays.</div>}
        </div>

        <div className="panel">
          <div className="panel-head"><h3>Recent Joiners</h3><span>latest employee records</span></div>
          <DataTable
            empty="No employees yet."
            columns={["Name", "Designation", "Joined", "Status"]}
            rows={recentJoiners.map(employee => [
              <strong key="name">{employeeName(employee)}</strong>,
              employee.fields.Designation || "-",
              formatDate(employee.fields["Joining Date"]),
              <Badge key="status" value={employee.status} />
            ])}
          />
        </div>
      </section>
    </>
  );
}

function Metric({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint: string; tone?: "warn" | "ok" }) {
  return <div className={`metric ${tone || ""}`}><span>{label}</span><strong>{value}</strong><p>{hint}</p></div>;
}

function EmployeeAvatar({ employee, small = false }: { employee: EmployeeRecord; small?: boolean }) {
  return <span className={`avatar${small ? " small" : ""}`}>{employee.photo ? <img src={employee.photo} alt="" /> : initials(employee)}</span>;
}

function pageDescription(nav: NavItem) {
  const descriptions: Record<NavItem, string> = {
    Dashboard: "Executive overview for headcount, approvals, payroll and compliance signals.",
    Employees: "Search, import, edit and export employee records.",
    Attendance: "Mark daily status and review payroll impact.",
    Leave: "Approve requests and monitor balances.",
    "Business Trips": "Track travel advances, approvals and settlement.",
    Expenses: "Manage reimbursements and expense approvals.",
    Payroll: "Generate payslips, WPS exports and salary records.",
    Recruitment: "Move jobs and candidates through the hiring pipeline.",
    EOS: "Calculate gratuity, settlements and employee closure.",
    Documents: "Generate official HR letters and PDF records.",
    Reports: "Download audit-ready operational reports.",
    Settings: "Configure company profile, backend sync and HR defaults."
  };
  return descriptions[nav];
}

function Employees({ state, setState, setModal, notify, close, savePdf }: CommonProps) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const activeCount = state.employees.filter(employee => employee.status === "Active").length;
  const onLeaveCount = state.employees.filter(employee => employee.status === "On Leave").length;
  const departmentCount = new Set(state.employees.map(employee => employee.fields.Department).filter(Boolean)).size;
  const employees = useMemo(() => state.employees.filter(employee => {
    const haystack = Object.values(employee.fields).join(" ").toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) &&
      (!department || employee.fields.Department === department) &&
      (!status || employee.status === status);
  }).sort((a, b) => a.fields["Employee Code"].localeCompare(b.fields["Employee Code"])), [state.employees, query, department, status]);

  function edit(employee?: EmployeeRecord) {
    setModal(<EmployeeEditor state={state} employee={employee} close={close} notify={notify} save={next => setState(prev => upsertEmployee(prev, next))} />);
  }

  function remove(employee: EmployeeRecord) {
    const confirmed = window.confirm(`Delete ${employeeName(employee)}? This also removes linked attendance, leave, payroll, expenses, trips, EOS records and generated documents.`);
    if (!confirmed) return;
    setState(prev => deleteEmployee(prev, employee.id));
    notify("Employee and linked records deleted.");
  }

  return (
    <section className="stack employee-workspace">
      <div className="employee-hero panel">
        <div>
          <p className="section-label">People operations</p>
          <h3>Employee Directory</h3>
          <span>{employees.length} shown / {state.employees.length} total records</span>
        </div>
        <div className="employee-hero-actions">
          <button onClick={() => void withPdf(pdf => savePdf(pdf.saveReportPdf("employee_directory", state, new Date().getFullYear(), new Date().getMonth() + 1), "employee_directory"))}><Download size={16} /> Directory PDF</button>
          <button onClick={downloadEmployeeTemplate}><Download size={16} /> Excel template</button>
          <label className="button-like"><Upload size={16} /> Import employees<input type="file" accept=".xlsx,.xlsm,.xltx,.xltm,.xls,.html,.csv,.tsv,text/html,text/csv" onChange={async event => { const file = event.target.files?.[0]; event.currentTarget.value = ""; await importEmployees(file); }} /></label>
          <button className="primary" onClick={() => edit()}><UserRoundPlus size={16} /> Add employee</button>
        </div>
      </div>
      <div className="employee-stats">
        <Metric label="Active" value={activeCount} hint="working employees" tone="ok" />
        <Metric label="On leave" value={onLeaveCount} hint="currently away" tone={onLeaveCount ? "warn" : undefined} />
        <Metric label="Departments" value={departmentCount} hint="operational groups" />
      </div>
      <div className="panel employee-directory-panel">
        <div className="filters employee-filters">
          <label><Search size={16} /><input placeholder="Search employee, code, email, department..." value={query} onChange={event => setQuery(event.target.value)} /></label>
          <select value={department} onChange={event => setDepartment(event.target.value)}><option value="">All departments</option>{state.settings.departments.map(item => <option key={item}>{item}</option>)}</select>
          <select value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option>{statusOptions.map(item => <option key={item}>{item}</option>)}</select>
        </div>
        {employees.length ? (
          <div className="employee-card-grid">
            {employees.map(employee => {
              const salary = employeeSalary(employee);
              return (
                <article className="employee-card" key={employee.id}>
                  <button className="employee-card-main" onClick={() => setModal(<EmployeeProfile employee={employee} state={state} close={close} edit={() => edit(employee)} savePdf={savePdf} />)}>
                    <EmployeeAvatar employee={employee} />
                    <span>
                      <strong>{employeeName(employee)}</strong>
                      <em>{employee.fields["Employee Code"]} - {employee.fields.Designation || "No designation"}</em>
                    </span>
                    <Badge value={employee.status} />
                  </button>
                  <div className="employee-card-details">
                    <span><b>Department</b>{employee.fields.Department || "-"}</span>
                    <span><b>Manager</b>{employee.fields["Reporting Manager Employee Code/Name"] || "-"}</span>
                    <span><b>Joined</b>{formatDate(employee.fields["Joining Date"])}</span>
                    <span><b>Total pay</b>{formatMoney(salary.total, state.settings.company.currency)}</span>
                  </div>
                  <div className="row-actions">
                    <button onClick={() => setModal(<EmployeeProfile employee={employee} state={state} close={close} edit={() => edit(employee)} savePdf={savePdf} />)}>Open profile</button>
                    <button onClick={() => edit(employee)}>Edit</button>
                    <button onClick={() => void withPdf(pdf => savePdf(pdf.saveEmployeeProfilePdf(employee, state.settings), "employee_profile", employee.id))}>PDF</button>
                    <button className="danger-outline" onClick={() => remove(employee)}><Trash2 size={15} /> Delete</button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : <div className="empty">No employees match the filters.</div>}
      </div>
    </section>
  );

  function downloadEmployeeTemplate() {
    const link = document.createElement("a");
    link.href = "/templates/MedTech-Employee-Import-Template.xlsx";
    link.download = "MedTech-Employee-Import-Template.xlsx";
    document.body.append(link);
    link.click();
    link.remove();
  }

  async function importEmployees(file?: File) {
    if (!file) return;
    try {
      const spreadsheet = /\.(xlsx|xlsm|xltx|xltm)$/i.test(file.name);
      const parsed = spreadsheet
        ? await parseEmployeeWorkbook(file)
        : { rows: parseEmployeeSheet(await file.text()), skipped: 0 };

      if (!parsed.rows.length) {
        notify(parsed.skipped ? `No employees were imported. ${parsed.skipped} row${parsed.skipped === 1 ? "" : "s"} need a unique Employee Code.` : "No employee rows were found in this file.");
        return;
      }

      const result = applyEmployeeRows(state, parsed.rows);
      setState(result.state);
      notify(`Employee import complete: ${result.added} added, ${result.updated} updated${parsed.skipped ? `, ${parsed.skipped} skipped` : ""}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Employee import failed. Use the downloaded .xlsx template or a CSV exported from Excel.");
    }
  }
}

function EmployeeEditor({ state, employee, save, close, notify }: {
  state: HrState;
  employee?: EmployeeRecord;
  save: (employee: EmployeeRecord) => void;
  close: () => void;
  notify: (message: string) => void;
}) {
  const [draft, setDraft] = useState<EmployeeRecord>(() => structuredClone(employee ?? createEmptyEmployee(nextEmployeeCode(state.employees))));
  const setField = (field: string, value: string) => setDraft(prev => ({ ...prev, fields: { ...prev.fields, [field]: value } }));

  async function updateEmployeePhoto(file?: File) {
    if (!file) return;
    try {
      const photo = await preparePhoto(file);
      setDraft(prev => ({ ...prev, photo }));
      notify("Photo ready. Save the employee to keep it.");
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  function submit() {
    if (!draft.fields["Employee Code"].trim() || !draft.fields["Full Name"].trim()) {
      notify("Employee code and full name are required.");
      return;
    }
    save(draft);
    notify(employee ? "Employee updated." : "Employee added.");
    close();
  }

  return (
    <div>
      <h2>{employee ? "Edit employee" : "Add employee"}</h2>
      <p className="muted">The master record includes the 90 MedTech HR fields from the reference module.</p>
      <div className="employee-photo-editor">
        <EmployeeAvatar employee={draft} />
        <div>
          <strong>Employee photo</strong>
          <p>Stored with this employee record on the local PC backend.</p>
          <div className="inline-controls">
            <label className="button-like"><ImagePlus size={16} /> {draft.photo ? "Replace photo" : "Add photo"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { void updateEmployeePhoto(event.target.files?.[0]); event.target.value = ""; }} /></label>
            {draft.photo && <button type="button" onClick={() => setDraft(prev => ({ ...prev, photo: "" }))}><Trash2 size={16} /> Remove</button>}
          </div>
        </div>
      </div>
      <div className="employee-status">
        <label>Status<select value={draft.status} onChange={event => setDraft(prev => ({ ...prev, status: event.target.value as EmployeeRecord["status"] }))}>{statusOptions.map(item => <option key={item}>{item}</option>)}</select></label>
      </div>
      <div className="employee-form">
        {employeeProfileSections.map((section, index) => (
          <details key={section.title} open={index < 3}>
            <summary>{section.title}</summary>
            <div className="form-grid">
              {section.fields.map(field => (
                <label key={field}>{field}
                  {field === "Department"
                    ? <select value={draft.fields[field] || ""} onChange={event => setField(field, event.target.value)}><option value="" />{state.settings.departments.map(item => <option key={item}>{item}</option>)}</select>
                    : <input type={fieldType(field)} value={draft.fields[field] || ""} onChange={event => setField(field, event.target.value)} />}
                </label>
              ))}
            </div>
          </details>
        ))}
      </div>
      <div className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={submit}>Save employee</button></div>
    </div>
  );
}

function EmployeeProfile({ employee, state, edit, close, savePdf }: { employee: EmployeeRecord; state: HrState; edit: () => void; close: () => void; savePdf: (file: GeneratedPdf | undefined, template: PdfTemplate, employeeId?: string) => void }) {
  const salary = employeeSalary(employee);
  return (
    <div className="employee-profile">
      <div className="profile-head">
        <EmployeeAvatar employee={employee} />
        <div><h2>{employeeName(employee)}</h2><p>{employee.fields.Designation} - {employee.fields.Department}</p></div>
        <Badge value={employee.status} />
      </div>
      <section className="profile-grid">
        {["Employee Code", "Joining Date", "Reporting Manager Employee Code/Name", "E-Mail ID (Work)", "Personal Mobile No.", "Nationality", "QID Expiry Date", "Bank Code", "IBAN No."].map(field => (
          <div key={field}><span>{field}</span><strong>{field.includes("Date") || field.includes("Expiry") ? formatDate(employee.fields[field]) : employee.fields[field] || "-"}</strong></div>
        ))}
        <div><span>Monthly Total</span><strong>{formatMoney(salary.total, state.settings.company.currency)}</strong></div>
      </section>
      <div className="profile-sections">
        {employeeProfileSections.map(section => (
          <section key={section.title}>
            <h3>{section.title}</h3>
            <div className="profile-field-grid">
              {section.fields.map(field => (
                <div key={field}><span>{field}</span><strong>{field.includes("Date") || field.includes("Expiry") ? formatDate(employee.fields[field]) : employee.fields[field] || "-"}</strong></div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="modal-actions">
        <button onClick={() => void withPdf(pdf => savePdf(pdf.saveEmployeeProfilePdf(employee, state.settings), "employee_profile", employee.id))}>Profile PDF</button>
        <button onClick={edit}>Edit</button>
        <button className="primary" onClick={close}>Done</button>
      </div>
    </div>
  );
}

function Attendance({ state, setState, savePdf, notify }: { state: HrState; setState: React.Dispatch<React.SetStateAction<HrState>>; savePdf: (file: GeneratedPdf | undefined, template: PdfTemplate, employeeId?: string) => void; notify: (message: string) => void }) {
  const now = new Date();
  const [date, setDate] = useState(todayISO);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const active = activeEmployees(state.employees).sort((a, b) => a.fields["Employee Code"].localeCompare(b.fields["Employee Code"]));
  const day = state.attendance[date] || {};
  const stats = attendanceStats(state.employees, state.attendance, year, month);
  const statusLabels: Record<AttendanceCode, string> = { P: "Present", H: "Half-day", L: "Leave", A: "Absent" };
  const statusCounts = (["P", "H", "L", "A"] as AttendanceCode[]).reduce((counts, code) => ({ ...counts, [code]: Object.values(day).filter(value => value === code).length }), {} as Record<AttendanceCode, number>);
  const departments = Array.from(new Set(active.map(employee => employee.fields.Department || "Unassigned"))).sort();
  const visibleEmployees = active.filter(employee => {
    const text = [employee.fields["Employee Code"], employeeName(employee), employee.fields.Department, employee.fields.Designation].join(" ").toLowerCase();
    const code = day[employee.id];
    const label = code ? statusLabels[code] : "Unmarked";
    return (!department || (employee.fields.Department || "Unassigned") === department) &&
      (!status || label === status) &&
      (!query || text.includes(query.toLowerCase()));
  });
  const marked = Object.keys(day).length;
  const payrollImpact = stats.reduce((sum, row) => sum + (employeeSalary(row.employee).total / 30) * (row.A + row.H * 0.5), 0);
  const grouped = departments
    .map(name => ({ name, employees: visibleEmployees.filter(employee => (employee.fields.Department || "Unassigned") === name) }))
    .filter(group => group.employees.length);

  function downloadAttendanceTemplate() {
    downloadBlob(new Blob([attendanceTemplateHtml()], { type: "application/vnd.ms-excel;charset=utf-8" }), `MedTech-Attendance-Import-Template-${todayISO()}.xls`);
  }

  async function importAttendance(file?: File) {
    if (!file) return;
    try {
      const result = applyAttendanceRows(state, parseAttendanceSheet(await file.text()));
      if (!result.imported) {
        notify(`No attendance rows imported${result.skipped ? `; ${result.skipped} invalid row(s) were skipped` : ""}.`);
        return;
      }
      setState(result.state);
      if (result.latestDate) setDate(result.latestDate);
      notify(`Attendance import complete: ${result.imported} row(s) across ${result.dates} date(s)${result.skipped ? `; ${result.skipped} skipped` : ""}.`);
    } catch {
      notify("Attendance import failed. Use the downloaded template or a CSV exported from Excel.");
    }
  }

  return (
    <section className="stack attendance-workspace">
      <div className="panel attendance-control">
        <div className="attendance-hero">
          <div>
            <h3>Attendance Control</h3>
            <p>Department view of daily attendance, leave marks and payroll-impacting exceptions.</p>
          </div>
          <div className="inline-controls">
            <button onClick={downloadAttendanceTemplate}><Download size={16} /> Template</button>
            <label className="button-like"><Upload size={16} /> Import attendance<input type="file" accept=".xls,.html,.csv,.tsv,text/html,text/csv" onChange={event => { void importAttendance(event.target.files?.[0]); event.target.value = ""; }} /></label>
            <button onClick={() => setState(prev => markAllAttendance(prev, date, "P"))}>Mark all present</button>
            <button onClick={() => setState(prev => clearAttendanceDay(prev, date))}>Clear day</button>
          </div>
        </div>

        <div className="attendance-metrics">
          <AttendanceMetric label="Present" value={statusCounts.P} tone="present" />
          <AttendanceMetric label="Half-day" value={statusCounts.H} tone="half" />
          <AttendanceMetric label="Leave" value={statusCounts.L} tone="leave" />
          <AttendanceMetric label="Absent" value={statusCounts.A} tone="absent" />
          <AttendanceMetric label="Payroll impact" value={formatMoney(payrollImpact, state.settings.company.currency)} tone="payroll" />
        </div>

        <div className="attendance-toolbar department-style">
          <label><Search size={16} /><input id="attendance-search" name="attendance-search" aria-label="Search attendance" placeholder="Search employee, department or status..." value={query} onChange={event => setQuery(event.target.value)} /></label>
          <input id="attendance-date" name="attendance-date" type="date" value={date} onChange={event => setDate(event.target.value)} />
          <select value={department} onChange={event => setDepartment(event.target.value)} aria-label="Department filter"><option value="">All departments</option>{departments.map(item => <option key={item}>{item}</option>)}</select>
          <select value={status} onChange={event => setStatus(event.target.value)} aria-label="Status filter"><option value="">All statuses</option>{["Present", "Half-day", "Leave", "Absent", "Unmarked"].map(item => <option key={item}>{item}</option>)}</select>
        </div>

        <div className="attendance-board">
          {grouped.map(group => {
            const present = group.employees.filter(employee => day[employee.id] === "P").length;
            return (
              <section className="attendance-dept-group" key={group.name}>
                <div className="attendance-dept-head">
                  <div><UsersRound size={16} /><h3>{group.name}</h3></div>
                  <span>{present} present / {group.employees.length}</span>
                </div>
                <div className="attendance-table-head">
                  <span>Employee</span><span>Date</span><span>Punch in</span><span>Punch out</span><span>Hours</span><span>Status</span><span>Approval</span><span>Action</span>
                </div>
                {group.employees.map(employee => {
                  const code = day[employee.id];
                  const punch = attendancePunch(employee, code, state.settings.workdayHours, state.settings.halfDayHours);
                  const approval = state.attendanceApprovals[date]?.[employee.id];
                  const needsReview = (code === "H" || code === "A") && !approval;
                  return (
                    <div className="attendance-record" key={employee.id}>
                      <div className="attendance-row">
                        <div className="employee-cell"><strong>{employeeName(employee)}</strong><span>{employee.fields["Employee Code"]} - {employee.fields.Designation || "-"}</span></div>
                        <span>{formatDate(date)}</span>
                        <strong>{punch.in}</strong>
                        <strong>{punch.out}</strong>
                        <strong>{punch.hours}</strong>
                        <Badge value={punch.status} />
                        <Badge value={approval || (needsReview ? "Pending" : code ? "Approved" : "Not marked")} />
                        <div className="att-btns">{(["P", "H", "L", "A"] as AttendanceCode[]).map(item => <button key={item} aria-label={`${statusLabels[item]} - ${employeeName(employee)}`} className={`att-btn ${code === item ? `on-${item}` : ""}`} onClick={() => setState(prev => setAttendance(prev, date, employee.id, item))}>{item}</button>)}</div>
                      </div>
                      {needsReview && (
                        <div className="attendance-review">
                          <span><strong>{punch.status}: </strong>{punch.note}</span>
                          <div><button onClick={() => setState(prev => decideAttendance(prev, date, employee.id, "Approved"))}>Approve</button><button className="danger-outline" onClick={() => setState(prev => decideAttendance(prev, date, employee.id, "Not approved"))}>Not approved</button></div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}
          {!grouped.length && <div className="empty">No attendance records match the filters.</div>}
        </div>
        <p className="attendance-foot">Marked: <strong>{marked}</strong>/{active.length} - Present {statusCounts.P} - Half-day {statusCounts.H} - Leave {statusCounts.L} - Absent {statusCounts.A} - Payroll impact {formatMoney(payrollImpact, state.settings.company.currency)}</p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div><h3>Monthly Summary</h3><span>Counts for {months[month - 1]} {year}</span></div>
          <div className="inline-controls">
            <select id="attendance-month" name="attendance-month" value={month} onChange={event => setMonth(Number(event.target.value))}>{months.map((item, index) => <option value={index + 1} key={item}>{item}</option>)}</select>
            <input id="attendance-year" name="attendance-year" type="number" value={year} onChange={event => setYear(Number(event.target.value))} />
            <button onClick={() => void withPdf(pdf => savePdf(pdf.saveReportPdf("attendance_report", state, year, month), "attendance_report"))}>PDF</button>
          </div>
        </div>
        <DataTable columns={["Code", "Employee", "Present", "Half-day", "Leave", "Absent", "%"]} rows={stats.map(row => [row.employee.fields["Employee Code"], employeeName(row.employee), row.P, row.H, row.L, row.A, `${row.pct}%`])} />
      </div>
    </section>
  );
}

function attendancePunch(employee: EmployeeRecord, code: AttendanceCode | undefined, workdayHours: number, halfDayHours: number) {
  void employee;
  if (!code) return { in: "-", out: "-", hours: "-", status: "Unmarked", note: "Attendance has not been recorded yet." };
  if (code === "L") return { in: "Leave", out: "-", hours: "0.00", status: "Leave", note: "Approved leave day." };
  if (code === "A") return { in: "-", out: "-", hours: "0.00", status: "Absent", note: "Absence recorded. Review whether this should remain loss of pay." };
  if (code === "H") return { in: "Marked", out: "-", hours: halfDayHours.toFixed(2), status: "Half-day", note: "Half-day attendance recorded. Review whether this is approved." };
  return { in: "Marked", out: "-", hours: workdayHours.toFixed(2), status: "Present", note: "Attendance marked manually. Connect a clocking device/import for real punch times." };
}

function AttendanceMetric({ label, value, tone }: { label: string; value: React.ReactNode; tone: "present" | "half" | "leave" | "absent" | "payroll" }) {
  return <div className={`attendance-metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function Leave({ state, setState, setModal, notify, close, savePdf }: CommonProps) {
  const [status, setStatus] = useState("");
  const rows = state.leaves.filter(item => !status || item.status === status);

  function openLeaveForm() {
    setModal(<LeaveForm state={state} close={close} notify={notify} save={leave => setState(prev => ({ ...prev, leaves: [...prev.leaves, leave] }))} />);
  }

  return (
    <section className="stack">
      <div className="panel">
        <div className="panel-head">
          <div><h3>Leave Requests</h3><span>{state.leaves.filter(item => item.status === "Pending").length} pending</span></div>
          <div className="inline-controls">
            <select value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option><option>Pending</option><option>Approved</option><option>Rejected</option></select>
            <button onClick={() => void withPdf(pdf => savePdf(pdf.saveReportPdf("leave_report", state, new Date().getFullYear(), new Date().getMonth() + 1), "leave_report"))}>Leave PDF</button>
            <button className="primary" onClick={openLeaveForm}>Apply leave</button>
          </div>
        </div>
        <DataTable
          empty="No leave requests yet."
          columns={["Employee", "Type", "From", "To", "Days", "Reason", "Status", "Actions"]}
          rows={rows.map(leave => {
            const employee = state.employees.find(item => item.id === leave.employeeId);
            return [
              employeeName(employee),
              leave.type,
              formatDate(leave.from),
              formatDate(leave.to),
              leave.days,
              leave.reason,
              <Badge key="status" value={leave.status} />,
              <div className="row-actions" key="actions">
                {leave.status === "Pending" && <><button onClick={() => setState(prev => decideLeave(prev, leave.id, "Approved"))}>Approve</button><button onClick={() => setState(prev => decideLeave(prev, leave.id, "Rejected"))}>Reject</button></>}
                <button onClick={() => confirmDelete(`${leave.type} request`) && setState(prev => deleteLeave(prev, leave.id))}>Delete</button>
              </div>
            ];
          })}
        />
      </div>
      <LeaveBalances state={state} />
    </section>
  );
}

function LeaveForm({ state, save, close, notify }: { state: HrState; save: (leave: HrState["leaves"][number]) => void; close: () => void; notify: (message: string) => void }) {
  const [employeeId, setEmployeeId] = useState(activeEmployees(state.employees)[0]?.id || "");
  const [type, setType] = useState(state.settings.leaveTypes[0]?.name || "Annual leave");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [reason, setReason] = useState("");
  const days = from && to && to >= from ? inclusiveDays(from, to) : 0;

  function submit() {
    if (!employeeId || !days) return notify("Select employee and valid leave dates.");
    const balance = leaveBalanceSummary(state, employeeId, type, new Date(`${from}T00:00:00`).getFullYear());
    if (balance.total > 0 && balance.remaining < days) return notify(`Only ${balance.remaining} day(s) available for ${type}.`);
    save({ id: newId(), employeeId, type, from, to, days, reason, status: "Pending", appliedOn: todayISO() });
    notify("Leave request submitted.");
    close();
  }

  return <div><h2>Apply for leave</h2><div className="form-grid compact">
    <label>Employee<select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>{activeEmployees(state.employees).map(employee => <option key={employee.id} value={employee.id}>{employee.fields["Employee Code"]} - {employeeName(employee)}</option>)}</select></label>
    <label>Leave type<select value={type} onChange={event => setType(event.target.value)}>{state.settings.leaveTypes.map(item => <option key={item.id}>{item.name}</option>)}</select></label>
    <label>From<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
    <label>To<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
    <label className="wide">Reason<textarea value={reason} onChange={event => setReason(event.target.value)} /></label>
  </div><p className="muted">Duration: {days || "-"} calendar day(s), inclusive.</p><div className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={submit}>Submit leave</button></div></div>;
}

function LeaveBalances({ state }: { state: HrState }) {
  const year = new Date().getFullYear();
  const employees = activeEmployees(state.employees);
  const quotaTypes = state.settings.leaveTypes.filter(item => item.days > 0);
  return <div className="panel"><div className="panel-head"><h3>Leave Balances</h3><span>{year}</span></div>
    <DataTable columns={["Employee", ...quotaTypes.map(item => item.name)]} rows={employees.map(employee => [
      employeeName(employee),
      ...quotaTypes.map(type => {
        const balance = leaveBalanceSummary(state, employee.id, type.name, year);
        return `${balance.remaining} / ${balance.total} (${balance.used} used, ${balance.pending} pending)`;
      })
    ])} />
  </div>;
}

function BusinessTrips({ state, setState, notify }: { state: HrState; setState: React.Dispatch<React.SetStateAction<HrState>>; notify: (message: string) => void }) {
  const employees = activeEmployees(state.employees);
  const [employeeId, setEmployeeId] = useState(employees[0]?.id || "");
  const [destination, setDestination] = useState("");
  const [purpose, setPurpose] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [perDiem, setPerDiem] = useState("250");
  const [travelCost, setTravelCost] = useState("0");
  const [advanceAmount, setAdvanceAmount] = useState("0");
  const days = from && to && to >= from ? inclusiveDays(from, to) : 0;

  function updateTrip(id: string, patch: Partial<BusinessTrip>) {
    setState(prev => ({ ...prev, businessTrips: prev.businessTrips.map(item => item.id === id ? { ...item, ...patch } : item) }));
  }

  function submit() {
    if (!employeeId || !destination.trim() || !purpose.trim() || !days) return notify("Employee, destination, purpose and valid dates are required.");
    setState(prev => ({
      ...prev,
      businessTrips: [...prev.businessTrips, {
        id: newId(),
        employeeId,
        destination,
        purpose,
        from,
        to,
        days,
        perDiem: Number(perDiem) || 0,
        travelCost: Number(travelCost) || 0,
        advanceAmount: Number(advanceAmount) || 0,
        status: "Pending",
        createdOn: todayISO()
      }]
    }));
    setDestination("");
    setPurpose("");
    notify("Business trip request added.");
  }

  return <section className="stack">
    <div className="panel">
      <div className="panel-head"><div><h3>Business Trips</h3><span>Requests, approval, allowances and open advances.</span></div></div>
      <div className="form-grid compact">
        <label>Employee<select id="trip-employee" name="trip-employee" value={employeeId} onChange={event => setEmployeeId(event.target.value)}>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.fields["Employee Code"]} - {employeeName(employee)}</option>)}</select></label>
        <label>Destination<input id="trip-destination" name="trip-destination" value={destination} onChange={event => setDestination(event.target.value)} placeholder="Doha, Riyadh, Dubai..." /></label>
        <label>From<input id="trip-from" name="trip-from" type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
        <label>To<input id="trip-to" name="trip-to" type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
        <label>Per diem<input id="trip-per-diem" name="trip-per-diem" type="number" min="0" value={perDiem} onChange={event => setPerDiem(event.target.value)} /></label>
        <label>Travel cost<input id="trip-travel-cost" name="trip-travel-cost" type="number" min="0" value={travelCost} onChange={event => setTravelCost(event.target.value)} /></label>
        <label>Advance paid<input id="trip-advance" name="trip-advance" type="number" min="0" value={advanceAmount} onChange={event => setAdvanceAmount(event.target.value)} /></label>
        <label className="wide" htmlFor="trip-purpose">Purpose<textarea id="trip-purpose" name="trip-purpose" value={purpose} onChange={event => setPurpose(event.target.value)} /></label>
      </div>
      <p className="muted">Duration: {days || "-"} day(s). Estimated trip cost: {formatMoney(tripTotal({ days, perDiem: Number(perDiem) || 0, travelCost: Number(travelCost) || 0 }), state.settings.company.currency)}.</p>
      <div className="modal-actions"><button className="primary" onClick={submit}>Add trip request</button></div>
    </div>
    <div className="panel">
      <div className="panel-head"><h3>Trip Register</h3><span>{state.businessTrips.length} records</span></div>
      <DataTable empty="No business trips yet." columns={["Employee", "Destination", "Dates", "Days", "Cost", "Advance", "Status", "Actions"]} rows={state.businessTrips.map(trip => {
        const employee = state.employees.find(item => item.id === trip.employeeId);
        return [
          employeeName(employee),
          trip.destination,
          `${formatDate(trip.from)} - ${formatDate(trip.to)}`,
          trip.days,
          formatMoney(tripTotal(trip), state.settings.company.currency),
          formatMoney(trip.advanceAmount, state.settings.company.currency),
          <Badge key="status" value={trip.status} />,
          <div className="row-actions" key="actions">
            {trip.status === "Pending" && <><button onClick={() => updateTrip(trip.id, { status: "Approved" })}>Approve</button><button onClick={() => updateTrip(trip.id, { status: "Rejected" })}>Reject</button></>}
            {trip.status === "Approved" && <button onClick={() => updateTrip(trip.id, { status: "Closed" })}>Close</button>}
            <button onClick={() => confirmDelete(`trip to ${trip.destination}`) && setState(prev => ({ ...prev, businessTrips: prev.businessTrips.filter(item => item.id !== trip.id) }))}>Delete</button>
          </div>
        ];
      })} />
    </div>
  </section>;
}

function Expenses({ state, setState, notify }: { state: HrState; setState: React.Dispatch<React.SetStateAction<HrState>>; notify: (message: string) => void }) {
  const employees = activeEmployees(state.employees);
  const [employeeId, setEmployeeId] = useState(employees[0]?.id || "");
  const [tripId, setTripId] = useState("");
  const [category, setCategory] = useState("Travel");
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const totals = expenseTotals(state.expenses);
  const employeeTrips = state.businessTrips.filter(item => item.employeeId === employeeId);

  function updateExpense(id: string, patch: Partial<EmployeeExpense>) {
    setState(prev => ({ ...prev, expenses: prev.expenses.map(item => item.id === id ? { ...item, ...patch } : item) }));
  }

  function submit() {
    const value = Number(amount);
    if (!employeeId || !category.trim() || !date || !Number.isFinite(value) || value <= 0) return notify("Employee, category, date and positive amount are required.");
    setState(prev => ({
      ...prev,
      expenses: [...prev.expenses, { id: newId(), employeeId, tripId: tripId || undefined, category, date, amount: value, description, status: "Submitted", createdOn: todayISO() }]
    }));
    setAmount("");
    setDescription("");
    notify("Expense submitted.");
  }

  return <section className="stack">
    <div className="settlement-preview">
      <div><span>Submitted</span><strong>{formatMoney(totals.submitted, state.settings.company.currency)}</strong></div>
      <div><span>Approved unpaid</span><strong>{formatMoney(totals.approved, state.settings.company.currency)}</strong></div>
      <div><span>Paid</span><strong>{formatMoney(totals.paid, state.settings.company.currency)}</strong></div>
    </div>
    <div className="panel">
      <div className="panel-head"><div><h3>Employee Expenses</h3><span>Submit, approve, reject and mark reimbursements paid.</span></div></div>
      <div className="form-grid compact">
        <label>Employee<select id="expense-employee" name="expense-employee" value={employeeId} onChange={event => { setEmployeeId(event.target.value); setTripId(""); }}>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.fields["Employee Code"]} - {employeeName(employee)}</option>)}</select></label>
        <label>Trip<select id="expense-trip" name="expense-trip" value={tripId} onChange={event => setTripId(event.target.value)}><option value="">No trip link</option>{employeeTrips.map(trip => <option key={trip.id} value={trip.id}>{trip.destination} - {formatDate(trip.from)}</option>)}</select></label>
        <label>Category<select id="expense-category" name="expense-category" value={category} onChange={event => setCategory(event.target.value)}><option>Travel</option><option>Hotel</option><option>Meal</option><option>Medical</option><option>Fuel</option><option>Other</option></select></label>
        <label>Date<input id="expense-date" name="expense-date" type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
        <label htmlFor="expense-amount">Amount<input id="expense-amount" name="expense-amount" type="number" min="0" value={amount} onChange={event => setAmount(event.target.value)} /></label>
        <label className="wide" htmlFor="expense-description">Description<textarea id="expense-description" name="expense-description" value={description} onChange={event => setDescription(event.target.value)} /></label>
      </div>
      <div className="modal-actions"><button className="primary" onClick={submit}>Submit expense</button></div>
    </div>
    <div className="panel">
      <div className="panel-head"><h3>Expense Register</h3><span>{state.expenses.length} records</span></div>
      <DataTable empty="No expenses yet." columns={["Employee", "Category", "Date", "Amount", "Trip", "Status", "Actions"]} rows={state.expenses.map(expense => {
        const employee = state.employees.find(item => item.id === expense.employeeId);
        const trip = state.businessTrips.find(item => item.id === expense.tripId);
        return [
          employeeName(employee),
          expense.category,
          formatDate(expense.date),
          formatMoney(expense.amount, state.settings.company.currency),
          trip?.destination || "-",
          <Badge key="status" value={expense.status} />,
          <div className="row-actions" key="actions">
            {expense.status === "Submitted" && <><button onClick={() => updateExpense(expense.id, { status: "Approved" })}>Approve</button><button onClick={() => updateExpense(expense.id, { status: "Rejected" })}>Reject</button></>}
            {expense.status === "Approved" && <button onClick={() => updateExpense(expense.id, { status: "Paid" })}>Mark paid</button>}
            <button onClick={() => confirmDelete(`${expense.category} expense`) && setState(prev => ({ ...prev, expenses: prev.expenses.filter(item => item.id !== expense.id) }))}>Delete</button>
          </div>
        ];
      })} />
    </div>
  </section>;
}

function Recruitment({ state, setState, notify, setNav }: { state: HrState; setState: React.Dispatch<React.SetStateAction<HrState>>; notify: (message: string) => void; setNav: (nav: NavItem) => void }) {
  const [editingJobId, setEditingJobId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobDept, setJobDept] = useState(state.settings.departments[0] || "");
  const [jobOpenings, setJobOpenings] = useState("1");
  const [jobStatus, setJobStatus] = useState<RecruitmentJob["status"]>("Open");
  const [jobPostedOn, setJobPostedOn] = useState(todayISO());
  const [jobDescription, setJobDescription] = useState("");
  const [editingCandidateId, setEditingCandidateId] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [candidateJobId, setCandidateJobId] = useState(state.jobs[0]?.id || "");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [candidatePhone, setCandidatePhone] = useState("");
  const [candidateStage, setCandidateStage] = useState<RecruitmentCandidate["stage"]>("Applied");
  const [candidateRating, setCandidateRating] = useState("0");
  const [candidateNotes, setCandidateNotes] = useState("");
  const pipeline = candidatePipeline(state.candidates);
  const openJobs = state.jobs.filter(job => job.status === "Open");
  const openPositions = openJobs.reduce((sum, job) => sum + job.openings, 0);
  const activeCandidates = state.candidates.filter(candidate => candidate.stage !== "Hired" && candidate.stage !== "Rejected");

  useEffect(() => {
    if (!candidateJobId && state.jobs[0]) setCandidateJobId(state.jobs[0].id);
    if (candidateJobId && !state.jobs.some(job => job.id === candidateJobId)) setCandidateJobId(state.jobs[0]?.id || "");
  }, [candidateJobId, state.jobs]);

  function resetJobForm() {
    setEditingJobId("");
    setJobTitle("");
    setJobDept(state.settings.departments[0] || "");
    setJobOpenings("1");
    setJobStatus("Open");
    setJobPostedOn(todayISO());
    setJobDescription("");
  }

  function editJob(job: RecruitmentJob) {
    setEditingJobId(job.id);
    setJobTitle(job.title);
    setJobDept(job.dept);
    setJobOpenings(String(job.openings));
    setJobStatus(job.status);
    setJobPostedOn(job.postedOn);
    setJobDescription(job.description);
  }

  function saveJob() {
    if (!jobTitle.trim()) return notify("Job title is required.");
    const record: RecruitmentJob = {
      id: editingJobId || newId(),
      title: jobTitle.trim(),
      dept: jobDept,
      openings: Math.max(1, Number(jobOpenings) || 1),
      status: jobStatus,
      postedOn: jobPostedOn || todayISO(),
      description: jobDescription.trim()
    };

    setState(prev => ({
      ...prev,
      jobs: editingJobId ? prev.jobs.map(job => job.id === editingJobId ? record : job) : [...prev.jobs, record]
    }));
    if (!candidateJobId) setCandidateJobId(record.id);
    notify(editingJobId ? "Opening updated." : "Opening added.");
    resetJobForm();
  }

  function deleteJob(id: string) {
    const job = state.jobs.find(item => item.id === id);
    if (!confirmDelete(`${job?.title || "job opening"} and its linked candidates`)) return;
    setState(prev => ({
      ...prev,
      jobs: prev.jobs.filter(job => job.id !== id),
      candidates: prev.candidates.filter(candidate => candidate.jobId !== id)
    }));
    if (editingJobId === id) resetJobForm();
    notify("Opening and linked candidates deleted.");
  }

  function resetCandidateForm() {
    setEditingCandidateId("");
    setCandidateName("");
    setCandidateEmail("");
    setCandidatePhone("");
    setCandidateStage("Applied");
    setCandidateRating("0");
    setCandidateNotes("");
  }

  function editCandidate(candidate: RecruitmentCandidate) {
    setEditingCandidateId(candidate.id);
    setCandidateName(candidate.name);
    setCandidateJobId(candidate.jobId);
    setCandidateEmail(candidate.email);
    setCandidatePhone(candidate.phone);
    setCandidateStage(candidate.stage);
    setCandidateRating(String(candidate.rating || 0));
    setCandidateNotes(candidate.notes);
  }

  function saveCandidate() {
    if (!state.jobs.length) return notify("Add a job opening first.");
    if (!candidateName.trim()) return notify("Candidate name is required.");
    const record: RecruitmentCandidate = {
      id: editingCandidateId || newId(),
      jobId: candidateJobId || state.jobs[0].id,
      name: candidateName.trim(),
      email: candidateEmail.trim(),
      phone: candidatePhone.trim(),
      stage: candidateStage,
      rating: Math.min(5, Math.max(0, Number(candidateRating) || 0)),
      notes: candidateNotes.trim(),
      appliedOn: editingCandidateId ? state.candidates.find(candidate => candidate.id === editingCandidateId)?.appliedOn || todayISO() : todayISO(),
      employeeId: state.candidates.find(candidate => candidate.id === editingCandidateId)?.employeeId
    };

    setState(prev => ({
      ...prev,
      candidates: editingCandidateId ? prev.candidates.map(candidate => candidate.id === editingCandidateId ? record : candidate) : [...prev.candidates, record]
    }));
    notify(editingCandidateId ? "Candidate updated." : "Candidate added.");
    resetCandidateForm();
  }

  function moveCandidate(id: string, stage: RecruitmentCandidate["stage"]) {
    setState(prev => ({
      ...prev,
      candidates: prev.candidates.map(candidate => candidate.id === id ? { ...candidate, stage } : candidate)
    }));
  }

  function addAsEmployee(candidate: RecruitmentCandidate) {
    if (candidate.employeeId) return notify("Candidate is already linked to an employee.");
    setState(prev => hireCandidateAsEmployee(prev, candidate.id));
    notify(`${candidate.name} added as an employee. Set salary details in Employees.`);
    setNav("Employees");
  }

  return <section className="stack recruitment-workspace">
    <div className="settlement-preview">
      <div><span>Open positions</span><strong>{openPositions}</strong></div>
      <div><span>Open jobs</span><strong>{openJobs.length}</strong></div>
      <div><span>Pipeline</span><strong>{activeCandidates.length}</strong></div>
      <div><span>Offer stage</span><strong>{pipeline.Offer}</strong></div>
      <div><span>Hired</span><strong>{pipeline.Hired}</strong></div>
    </div>

    <div className="panel">
      <div className="panel-head">
        <div><h3>Job Openings</h3><span>{openJobs.length} open</span></div>
        {editingJobId && <button onClick={resetJobForm}>Cancel edit</button>}
      </div>
      <div className="form-grid compact">
        <label htmlFor="recruitment-job-title">Job title *<input id="recruitment-job-title" name="recruitment-job-title" value={jobTitle} onChange={event => setJobTitle(event.target.value)} /></label>
        <label>Department<select id="recruitment-job-dept" name="recruitment-job-dept" value={jobDept} onChange={event => setJobDept(event.target.value)}>{state.settings.departments.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>No. of openings<input id="recruitment-job-openings" name="recruitment-job-openings" type="number" min="1" value={jobOpenings} onChange={event => setJobOpenings(event.target.value)} /></label>
        <label>Status<select id="recruitment-job-status" name="recruitment-job-status" value={jobStatus} onChange={event => setJobStatus(event.target.value as RecruitmentJob["status"])}><option>Open</option><option>On Hold</option><option>Closed</option></select></label>
        <label>Posted on<input id="recruitment-job-posted" name="recruitment-job-posted" type="date" value={jobPostedOn} onChange={event => setJobPostedOn(event.target.value)} /></label>
        <label className="wide" htmlFor="recruitment-job-description">Description<textarea id="recruitment-job-description" name="recruitment-job-description" value={jobDescription} onChange={event => setJobDescription(event.target.value)} /></label>
      </div>
      <div className="modal-actions"><button className="primary" onClick={saveJob}>{editingJobId ? "Update opening" : "Add opening"}</button></div>
      <DataTable
        empty="No job openings yet."
        columns={["Title", "Department", "Openings", "Candidates", "Posted", "Status", "Actions"]}
        rows={state.jobs.map(job => {
          const count = state.candidates.filter(candidate => candidate.jobId === job.id).length;
          return [
            <strong key="title">{job.title}</strong>,
            job.dept || "-",
            job.openings,
            count,
            formatDate(job.postedOn),
            <Badge key="status" value={job.status} />,
            <div className="row-actions" key="actions"><button onClick={() => editJob(job)}>Edit</button><button onClick={() => deleteJob(job.id)}>Delete</button></div>
          ];
        })}
      />
    </div>

    <div className="panel">
      <div className="panel-head">
        <div><h3>Candidate Pipeline</h3><span>Move candidates between stages with the dropdown on each card.</span></div>
        {editingCandidateId && <button onClick={resetCandidateForm}>Cancel edit</button>}
      </div>
      <div className="form-grid compact">
        <label htmlFor="candidate-name">Full name *<input id="candidate-name" name="candidate-name" value={candidateName} onChange={event => setCandidateName(event.target.value)} /></label>
        <label>Applying for<select id="candidate-job" name="candidate-job" value={candidateJobId} disabled={!state.jobs.length} onChange={event => setCandidateJobId(event.target.value)}>{state.jobs.map(job => <option key={job.id} value={job.id}>{job.title}</option>)}</select></label>
        <label htmlFor="candidate-email">Email<input id="candidate-email" name="candidate-email" type="email" value={candidateEmail} onChange={event => setCandidateEmail(event.target.value)} /></label>
        <label htmlFor="candidate-phone">Phone<input id="candidate-phone" name="candidate-phone" value={candidatePhone} onChange={event => setCandidatePhone(event.target.value)} /></label>
        <label>Stage<select id="candidate-stage" name="candidate-stage" value={candidateStage} onChange={event => setCandidateStage(event.target.value as RecruitmentCandidate["stage"])}>{candidateStages.map(stage => <option key={stage}>{stage}</option>)}</select></label>
        <label>Rating (0-5)<input id="candidate-rating" name="candidate-rating" type="number" min="0" max="5" value={candidateRating} onChange={event => setCandidateRating(event.target.value)} /></label>
        <label className="wide" htmlFor="candidate-notes">Notes<textarea id="candidate-notes" name="candidate-notes" value={candidateNotes} onChange={event => setCandidateNotes(event.target.value)} /></label>
      </div>
      <div className="modal-actions"><button className="primary" onClick={saveCandidate}>{editingCandidateId ? "Update candidate" : "Add candidate"}</button></div>

      <div className="recruitment-pipeline">
        {candidateStages.map(stage => {
          const cards = state.candidates.filter(candidate => candidate.stage === stage);
          return <div className="pipeline-column" key={stage}>
            <div className="pipeline-head"><strong>{stage}</strong><span>{cards.length}</span></div>
            {cards.length ? cards.map(candidate => {
              const job = state.jobs.find(item => item.id === candidate.jobId);
              return <article className="candidate-card" key={candidate.id}>
                <div><strong>{candidate.name}</strong><span>{job?.title || "(no job)"}</span></div>
                <p>{candidate.email || candidate.phone || "No contact added"}</p>
                {candidate.rating > 0 && <em>Rating: {candidate.rating}/5</em>}
                <select aria-label={`Move ${candidate.name}`} value={candidate.stage} onChange={event => moveCandidate(candidate.id, event.target.value as RecruitmentCandidate["stage"])}>{candidateStages.map(option => <option key={option}>{option}</option>)}</select>
                {candidate.notes && <small>{candidate.notes}</small>}
                <div className="row-actions">
                  {candidate.stage === "Hired" && (candidate.employeeId ? <Badge value="Employee added" /> : <button className="primary" onClick={() => addAsEmployee(candidate)}>Add as employee</button>)}
                  <button onClick={() => editCandidate(candidate)}>Edit</button>
                  <button onClick={() => confirmDelete(candidate.name) && setState(prev => ({ ...prev, candidates: prev.candidates.filter(item => item.id !== candidate.id) }))}>Delete</button>
                </div>
              </article>;
            }) : <div className="empty compact">No {stage.toLowerCase()} candidates.</div>}
          </div>;
        })}
      </div>
    </div>
  </section>;
}

function Payroll({ state, setState, setModal, notify, close, savePdf }: CommonProps) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const slips = state.payroll.filter(item => item.month === month && item.year === year);
  const payrollNet = slips.reduce((sum, slip) => sum + slip.net, 0);
  const payrollLop = slips.reduce((sum, slip) => sum + slip.lopAmount, 0);
  const finalized = slips.filter(slip => slip.status === "Finalized").length;
  const warnings = payrollExportWarnings(state, slips);

  function runPayroll() {
    const result = createPayroll(state, year, month);
    setState(result.state);
    notify(result.created || result.updated ? `${result.created} payslip(s) created, ${result.updated} draft payslip(s) refreshed.` : "Payroll is already finalized or up to date.");
  }

  function exportPayrollSheet() {
    downloadBlob(new Blob([payrollSheetHtml(state, slips)], { type: "application/vnd.ms-excel;charset=utf-8" }), `MedTech-Payroll-${year}-${String(month).padStart(2, "0")}.xls`);
  }

  function exportSifSheet() {
    downloadBlob(new Blob([sifCsv(state, slips, year, month)], { type: "text/csv;charset=utf-8" }), `SIF_${state.settings.company.name}_${year}${String(month).padStart(2, "0")}.csv`);
  }

  return (
    <section className="stack payroll-workspace">
      <div className="payroll-hero panel">
        <div>
          <p className="section-label">Payroll command centre</p>
          <h3>{months[month - 1]} {year}</h3>
          <span>Absences, half-days and unpaid leave refresh draft payslips automatically when payroll is rerun.</span>
        </div>
        <div className="inline-controls">
          <select value={month} onChange={event => setMonth(Number(event.target.value))}>{months.map((item, index) => <option value={index + 1} key={item}>{item}</option>)}</select>
          <input type="number" value={year} onChange={event => setYear(Number(event.target.value))} />
          <button className="primary" onClick={runPayroll}>Run payroll</button>
        </div>
      </div>
      <div className="payroll-grid">
        <div className="payroll-tile"><span>Net payable</span><strong>{formatMoney(payrollNet, state.settings.company.currency)}</strong><p>{slips.length} payslips</p></div>
        <div className="payroll-tile"><span>LOP impact</span><strong>{formatMoney(payrollLop, state.settings.company.currency)}</strong><p>From attendance and unpaid leave</p></div>
        <div className="payroll-tile"><span>Finalized</span><strong>{finalized}/{slips.length}</strong><p>Protected from refresh</p></div>
        <div className={`payroll-tile ${warnings.length ? "warn" : "ok"}`}><span>WPS readiness</span><strong>{warnings.length ? `${warnings.length} issue(s)` : "Ready"}</strong><p>{warnings[0] || "Bank sheet can be exported"}</p></div>
      </div>
      <div className="panel payroll-register">
        <div className="panel-head">
          <div><h3>Payroll Register</h3><span>Draft slips update from attendance; finalized slips stay locked.</span></div>
          <div className="inline-controls">
          <button onClick={() => void withPdf(pdf => savePdf(pdf.saveReportPdf("payroll_register", state, year, month), "payroll_register"))}>Register PDF</button>
            <button disabled={!slips.length} onClick={exportPayrollSheet}>WPS sheet</button>
            <button disabled={!slips.length} onClick={exportSifSheet}>SIF file</button>
          </div>
        </div>
      <DataTable
        empty="No payslips for this period. Run payroll to create drafts."
        columns={["Code", "Employee", "Gross", "LOP", "Net Pay", "Status", "Actions"]}
        rows={slips.map(slip => {
          const employee = state.employees.find(item => item.id === slip.employeeId);
          return [
            employee?.fields["Employee Code"] || "-",
            employeeName(employee),
            formatMoney(slip.gross, state.settings.company.currency),
            `${slip.lopDays}d / ${formatMoney(slip.lopAmount, state.settings.company.currency)}`,
            formatMoney(slip.net, state.settings.company.currency),
            <Badge key="status" value={slip.status} />,
            employee && <div className="row-actions" key="actions">
              <button onClick={() => setModal(<PayslipEditor slip={slip} close={close} save={next => setState(prev => ({ ...prev, payroll: prev.payroll.map(item => item.id === next.id ? next : item) }))} />)}>Adjust</button>
              {slip.status === "Draft" && <button onClick={() => setState(prev => ({ ...prev, payroll: prev.payroll.map(item => item.id === slip.id ? { ...item, status: "Finalized" } : item) }))}>Finalize</button>}
              <button onClick={() => void withPdf(pdf => savePdf(pdf.savePayslipPdf(slip, employee, state.settings), "payslip", employee.id))}>PDF</button>
            </div>
          ];
        })}
      />
      </div>
    </section>
  );
}

function PayslipEditor({ slip, save, close }: { slip: PayrollSlip; save: (slip: PayrollSlip) => void; close: () => void }) {
  const [draft, setDraft] = useState(slip);
  const setNumber = (key: keyof PayrollSlip, value: string) => setDraft(prev => recalcSlip({ ...prev, [key]: Number(value) || 0 }));
  return <div><h2>Adjust payslip</h2><div className="form-grid compact">
    <label>Bonus<input type="number" value={draft.bonus} onChange={event => setNumber("bonus", event.target.value)} /></label>
    <label>Overtime<input type="number" value={draft.overtime} onChange={event => setNumber("overtime", event.target.value)} /></label>
    <label>Deductions<input type="number" value={draft.deductions} onChange={event => setNumber("deductions", event.target.value)} /></label>
    <label>LOP amount<input type="number" value={draft.lopAmount} onChange={event => setNumber("lopAmount", event.target.value)} /></label>
    <label className="wide">Note<input value={draft.note} onChange={event => setDraft(prev => ({ ...prev, note: event.target.value }))} /></label>
  </div><div className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={() => { save(draft); close(); }}>Save payslip</button></div></div>;
}

function EOS({ state, setState, notify, savePdf }: { state: HrState; setState: React.Dispatch<React.SetStateAction<HrState>>; notify: (message: string) => void; savePdf: (file: GeneratedPdf | undefined, template: PdfTemplate, employeeId?: string) => void }) {
  const employees = state.employees;
  const [employeeId, setEmployeeId] = useState(activeEmployees(employees)[0]?.id || employees[0]?.id || "");
  const [asOf, setAsOf] = useState(todayISO());
  const [reason, setReason] = useState("End of service");
  const employee = employees.find(item => item.id === employeeId);
  const summary = employee ? eosSummary(employee, state, asOf) : undefined;

  function updateRecord(id: string, patch: Partial<EosRecord>) {
    setState(prev => ({ ...prev, eosRecords: prev.eosRecords.map(item => item.id === id ? { ...item, ...patch } : item) }));
  }

  function createRecord() {
    setState(prev => {
      const row = prev.employees.find(item => item.id === employeeId);
      if (prev.eosRecords.some(record => record.employeeId === employeeId && record.asOf === asOf && record.status !== "Paid")) return prev;
      return row ? { ...prev, eosRecords: [...prev.eosRecords, createEosRecord(prev, row, asOf, reason)] } : prev;
    });
    notify(state.eosRecords.some(record => record.employeeId === employeeId && record.asOf === asOf && record.status !== "Paid") ? "Open EOS draft already exists for this employee and date." : "EOS draft created.");
  }

  function closeEmployee(record: EosRecord) {
    setState(prev => ({
      ...prev,
      employees: prev.employees.map(item => item.id === record.employeeId ? { ...item, status: "Resigned", fields: { ...item.fields, "ESB Date": record.asOf } } : item)
    }));
    notify("Employee marked resigned.");
  }

  return <section className="stack">
    <div className="panel">
      <div className="panel-head"><div><h3>EOS, Gratuity & Settlement</h3><span>Qatar gratuity, leave encashment, LOP, expenses and trip advances.</span></div></div>
      {employee && summary && <div className="eos-mode-grid">
        <article><span>EOS</span><strong>{formatMoney(summary.netSettlement, state.settings.company.currency)}</strong><p>Final payable after reimbursements and advances.</p></article>
        <article><span>Gratuity</span><strong>{formatMoney(summary.gratuity, state.settings.company.currency)}</strong><p>Basic salary based service benefit estimate.</p></article>
        <article><span>Settlement</span><strong>{formatMoney(summary.leaveEncashment - summary.lopDeduction, state.settings.company.currency)}</strong><p>Leave encashment minus LOP deductions.</p></article>
      </div>}
      <div className="document-grid">
        <label>Employee<select id="eos-employee" name="eos-employee" value={employeeId} onChange={event => setEmployeeId(event.target.value)}>{employees.map(item => <option key={item.id} value={item.id}>{item.fields["Employee Code"]} - {employeeName(item)}</option>)}</select></label>
        <label>Settlement date<input id="eos-date" name="eos-date" type="date" value={asOf} onChange={event => setAsOf(event.target.value)} /></label>
        <label className="wide">Reason<textarea id="eos-reason" name="eos-reason" value={reason} onChange={event => setReason(event.target.value)} /></label>
        <button className="primary" disabled={!employee} onClick={createRecord}>Create settlement draft</button>
      </div>
      {employee && summary && <div className="settlement-preview">
        <div><span>Service</span><strong>{summary.years.toFixed(2)} years</strong></div>
        <div><span>Gratuity</span><strong>{formatMoney(summary.gratuity, state.settings.company.currency)}</strong></div>
        <div><span>Leave encashment</span><strong>{formatMoney(summary.leaveEncashment, state.settings.company.currency)}</strong></div>
        <div><span>LOP deduction</span><strong>{formatMoney(summary.lopDeduction, state.settings.company.currency)}</strong></div>
        <div><span>Approved expenses</span><strong>{formatMoney(summary.expenseReimbursement, state.settings.company.currency)}</strong></div>
        <div><span>Open advances</span><strong>{formatMoney(summary.tripAdvanceDeduction, state.settings.company.currency)}</strong></div>
        <div><span>EOS payable</span><strong>{formatMoney(summary.netSettlement, state.settings.company.currency)}</strong></div>
      </div>}
      {employee && <div className="modal-actions">
        <button onClick={() => void withPdf(pdf => savePdf(pdf.saveEmployeeDocumentPdf("gratuity_statement", employee, state, reason), "gratuity_statement", employee.id))}>Gratuity PDF</button>
        <button onClick={() => void withPdf(pdf => savePdf(pdf.saveEmployeeDocumentPdf("final_settlement", employee, state, reason), "final_settlement", employee.id))}>Settlement PDF</button>
      </div>}
    </div>
    <div className="panel">
      <div className="panel-head"><h3>EOS Register</h3><span>{state.eosRecords.length} records</span></div>
      <DataTable empty="No EOS records yet." columns={["Employee", "Date", "Gratuity", "Expenses", "Advances", "Net", "Status", "Actions"]} rows={state.eosRecords.map(record => {
        const rowEmployee = state.employees.find(item => item.id === record.employeeId);
        return [
          employeeName(rowEmployee),
          formatDate(record.asOf),
          formatMoney(record.gratuity, state.settings.company.currency),
          formatMoney(record.expenseReimbursement, state.settings.company.currency),
          formatMoney(record.tripAdvanceDeduction, state.settings.company.currency),
          formatMoney(record.netSettlement, state.settings.company.currency),
          <Badge key="status" value={record.status} />,
          <div className="row-actions" key="actions">
            {record.status === "Draft" && <button onClick={() => updateRecord(record.id, { status: "Approved" })}>Approve</button>}
            {record.status === "Approved" && <button onClick={() => updateRecord(record.id, { status: "Paid" })}>Mark paid</button>}
            {record.status === "Paid" && <button onClick={() => closeEmployee(record)}>Close employee</button>}
            {rowEmployee && <button onClick={() => void withPdf(pdf => savePdf(pdf.saveEosPdf(record, rowEmployee, state.settings), "final_settlement", rowEmployee.id))}>PDF</button>}
            <button onClick={() => confirmDelete(`EOS record dated ${formatDate(record.asOf)}`) && setState(prev => ({ ...prev, eosRecords: prev.eosRecords.filter(item => item.id !== record.id) }))}>Delete</button>
          </div>
        ];
      })} />
    </div>
  </section>;
}

function Documents({ state, setState, notify, savePdf }: { state: HrState; setState: React.Dispatch<React.SetStateAction<HrState>>; notify: (message: string) => void; savePdf: (file: GeneratedPdf | undefined, template: PdfTemplate, employeeId?: string) => void }) {
  const active = activeEmployees(state.employees);
  const [employeeId, setEmployeeId] = useState(active[0]?.id || "");
  const [template, setTemplate] = useState<PdfTemplate>("offer_letter");
  const [notes, setNotes] = useState("");
  const employee = state.employees.find(item => item.id === employeeId);

  function generate() {
    if (!employee) return notify("Select an employee first.");
    void withPdf(pdf => savePdf(pdf.saveEmployeeDocumentPdf(template, employee, state, notes), template, employee.id));
  }

  function removeDocument(id: string, name: string) {
    if (!confirmDelete(name)) return;
    setState(prev => ({ ...prev, documents: prev.documents.filter(item => item.id !== id) }));
    notify("Generated document deleted.");
  }

  return (
    <section className="stack">
      <div className="panel">
        <div className="panel-head"><div><h3>HR Documents & Letters</h3><span>Branded A4 PDFs using the required HR template list.</span></div></div>
        <div className="document-grid">
          <label>Employee<select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>{active.map(item => <option key={item.id} value={item.id}>{item.fields["Employee Code"]} - {employeeName(item)}</option>)}</select></label>
          <label>Template<select value={template} onChange={event => setTemplate(event.target.value as PdfTemplate)}>{pdfTemplates.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          <label className="wide">Notes / purpose<textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Bank request, visa processing, warning details, settlement notes..." /></label>
          <button className="primary" onClick={generate}>Generate PDF</button>
        </div>
        {employee && ["final_settlement", "gratuity_statement", "clearance_certificate"].includes(template) && <SettlementPreview employee={employee} state={state} />}
      </div>
      <div className="panel">
        <div className="panel-head"><h3>Required HR PDF Formats</h3><span>{pdfTemplates.length} templates</span></div>
        <div className="template-grid">{pdfTemplates.map(item => <div className="template-card" key={item.id}><FileText size={18} /><strong>{item.label}</strong><span>{item.category}</span></div>)}</div>
      </div>
      <div className="panel">
        <div className="panel-head"><h3>Generated Document Log</h3><span>{state.documents.length} records</span></div>
        <DataTable columns={["Document No.", "Template", "Employee", "Generated", "File", "Actions"]} rows={state.documents.map(doc => {
          const rowEmployee = state.employees.find(item => item.id === doc.employeeId);
          return [
            doc.documentNumber,
            templateName(doc.template),
            doc.employeeId ? employeeName(rowEmployee) : "-",
            formatDate(doc.generatedOn),
            doc.filename || doc.status,
            <div className="row-actions" key="actions">
              {doc.dataUrl ? <><button onClick={() => { try { openDataUrl(doc.dataUrl!); } catch (error) { notify(errorMessage(error)); } }}>View</button><button onClick={() => downloadDataUrl(doc.dataUrl!, doc.filename || `${doc.documentNumber}.pdf`)}>Download</button></> : <Badge value={doc.status} />}
              <button className="danger-outline" onClick={() => removeDocument(doc.id, doc.filename || doc.documentNumber)}><Trash2 size={15} /> Delete</button>
            </div>
          ];
        })} empty="No documents generated yet." />
      </div>
    </section>
  );
}

function SettlementPreview({ employee, state }: { employee: EmployeeRecord; state: HrState }) {
  const settlement = eosSummary(employee, state);
  return <div className="settlement-preview">
    <div><span>Service</span><strong>{settlement.years.toFixed(2)} years</strong></div>
    <div><span>Gratuity</span><strong>{formatMoney(settlement.gratuity, state.settings.company.currency)}</strong></div>
    <div><span>Leave encashment</span><strong>{formatMoney(settlement.leaveEncashment, state.settings.company.currency)}</strong></div>
    <div><span>LOP deduction</span><strong>{formatMoney(settlement.lopDeduction, state.settings.company.currency)}</strong></div>
    <div><span>Approved expenses</span><strong>{formatMoney(settlement.expenseReimbursement, state.settings.company.currency)}</strong></div>
    <div><span>Open advances</span><strong>{formatMoney(settlement.tripAdvanceDeduction, state.settings.company.currency)}</strong></div>
    <div><span>Net settlement</span><strong>{formatMoney(settlement.netSettlement, state.settings.company.currency)}</strong></div>
  </div>;
}

function Reports({ state, savePdf }: { state: HrState; notify: (message: string) => void; savePdf: (file: GeneratedPdf | undefined, template: PdfTemplate, employeeId?: string) => void }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  return <section className="report-grid">{reportTemplates.map(report => (
    <div className="report-card" key={report.id}>
      <BarChart3 size={20} />
      <h3>{report.label}</h3>
      <p>{report.description}</p>
      {["attendance_report", "payroll_register"].includes(report.id) && <div className="inline-controls report-controls"><select value={month} onChange={event => setMonth(Number(event.target.value))}>{months.map((item, index) => <option value={index + 1} key={item}>{item}</option>)}</select><input type="number" value={year} onChange={event => setYear(Number(event.target.value))} /></div>}
      {report.id === "leave_report" && <div className="inline-controls report-controls"><input type="number" value={year} onChange={event => setYear(Number(event.target.value))} /></div>}
      <button className="primary" onClick={() => void withPdf(pdf => savePdf(pdf.saveReportPdf(report.id, state, year, month), report.id))}><Download size={16} /> Download PDF</button>
    </div>
  ))}</section>;
}

function SettingsPage({
  state,
  setState,
  notify,
  backendSession,
  setBackendSession
}: {
  state: HrState;
  setState: React.Dispatch<React.SetStateAction<HrState>>;
  notify: (message: string) => void;
  backendSession: BackendSession | null;
  setBackendSession: React.Dispatch<React.SetStateAction<BackendSession | null>>;
}) {
  const [company, setCompany] = useState(state.settings.company);
  const [departments, setDepartments] = useState(state.settings.departments.join("\n"));
  const [leaveTypes, setLeaveTypes] = useState(state.settings.leaveTypes.map(item => `${item.name}:${item.days}`).join("\n"));
  const [workdayHours, setWorkdayHours] = useState(state.settings.workdayHours);
  const [halfDayHours, setHalfDayHours] = useState(state.settings.halfDayHours);
  const [backupStatus, setBackupStatus] = useState<BackendBackupStatus | null>(null);
  const [backupBusy, setBackupBusy] = useState("");

  useEffect(() => {
    if (!backendSession) return;
    void loadBackupStatus(backendSession).then(setBackupStatus).catch(error => notify(errorMessage(error)));
  }, [backendSession?.token]);

  async function updatePhoto(file?: File) {
    if (!file) return;
    try {
      const accountPhoto = await preparePhoto(file);
      setCompany(prev => ({ ...prev, accountPhoto }));
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  function saveSettings() {
    const nextDepartments = departments.split("\n").map(item => item.trim()).filter(Boolean);
    const nextLeaveTypes = leaveTypes.split("\n").map((line, index) => {
      const [name, days] = line.split(":");
      return { id: `lt-${index + 1}`, name: name.trim(), days: Number(days) || 0 };
    }).filter(item => item.name);
    setState(prev => ({ ...prev, settings: { ...prev.settings, company, departments: nextDepartments, leaveTypes: nextLeaveTypes, workdayHours: Math.max(0.25, workdayHours), halfDayHours: Math.max(0.25, Math.min(halfDayHours, workdayHours)) } }));
    notify("Settings saved.");
  }

  async function takeBackup() {
    if (!backendSession) return;
    setBackupBusy("backup");
    try {
      const saved = await saveBackendState(state, backendSession);
      const session = { ...backendSession, stateUpdatedAt: saved.updatedAt };
      setBackendSession(session);
      await createBackendBackup(session);
      setBackupStatus(await loadBackupStatus(session));
      notify("Backup stored.");
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBackupBusy("");
    }
  }

  async function rollbackBackup() {
    if (!backendSession || !window.confirm("Roll back to the latest backup? Current workspace data will be replaced.")) return;
    setBackupBusy("rollback");
    try {
      const restored = await rollbackLatestBackendBackup(backendSession);
      setState(hydrateState(restored.data));
      setBackendSession(prev => prev ? { ...prev, stateUpdatedAt: restored.updatedAt } : prev);
      setBackupStatus(await loadBackupStatus({ ...backendSession, stateUpdatedAt: restored.updatedAt }));
      notify("Latest backup restored.");
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBackupBusy("");
    }
  }

  return <section className="settings-grid">
    <div className="panel account-photo-panel">
      <div className="panel-head"><h3>Account Photo</h3><span>Shown in the sidebar</span></div>
      <div className="account-photo-row">
        <span className="account-photo-preview">{company.accountPhoto ? <img src={company.accountPhoto} alt="Account" /> : accountInitials(backendSession?.email || "HR")}</span>
        <div className="account-photo-actions">
          <label className="button-like"><Upload size={15} /> Upload photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { void updatePhoto(event.target.files?.[0]); event.target.value = ""; }} /></label>
          {company.accountPhoto && <button onClick={() => setCompany(prev => ({ ...prev, accountPhoto: "" }))}>Remove</button>}
          <p className="muted">JPEG, PNG or WebP under 8 MB. The app compresses it before saving.</p>
        </div>
      </div>
    </div>
    <div className="panel">
      <div className="panel-head"><h3>Backup & Rollback</h3><span>Automatic every 8 hours</span></div>
      <p className="muted">{backupStatus?.latest ? `Latest: ${new Date(backupStatus.latest.createdAt).toLocaleString()} (${backupStatus.latest.kind.toLowerCase()})` : "No backup stored yet."}</p>
      <div className="inline-controls"><button disabled={!!backupBusy} onClick={() => void takeBackup()}>{backupBusy === "backup" ? "Backing up..." : "Take backup now"}</button><button className="danger-outline" disabled={!!backupBusy || !backupStatus?.latest} onClick={() => void rollbackBackup()}>{backupBusy === "rollback" ? "Rolling back..." : "Roll back latest"}</button></div>
    </div>
    <div className="panel"><div className="panel-head"><h3>Company Profile</h3></div><div className="form-grid compact">
      {(["name", "legalName", "tagline", "address", "phone", "email", "website", "currency", "wpsEmployerEid", "wpsPayerEid", "wpsPayerQid", "wpsPayerBank", "wpsPayerIban"] as const).map(key => {
        const fieldId = `company-${key}`;
        return <label htmlFor={fieldId} key={key}>{labelize(key)}<input id={fieldId} name={fieldId} value={company[key]} onChange={event => setCompany(prev => ({ ...prev, [key]: event.target.value }))} /></label>;
      })}
    </div></div>
    <div className="panel"><div className="panel-head"><h3>Departments</h3></div><textarea id="settings-departments" name="settings-departments" aria-label="Departments" value={departments} onChange={event => setDepartments(event.target.value)} /></div>
    <div className="panel"><div className="panel-head"><h3>Leave Types</h3><span>Format: Name:days</span></div><textarea id="settings-leave-types" name="settings-leave-types" aria-label="Leave types" value={leaveTypes} onChange={event => setLeaveTypes(event.target.value)} /></div>
    <div className="panel"><div className="panel-head"><h3>Attendance Defaults</h3><span>Used for manual attendance</span></div><div className="form-grid compact"><label>Full day hours<input type="number" min="0.25" step="0.25" value={workdayHours} onChange={event => setWorkdayHours(Number(event.target.value))} /></label><label>Half-day hours<input type="number" min="0.25" step="0.25" max={workdayHours} value={halfDayHours} onChange={event => setHalfDayHours(Number(event.target.value))} /></label></div></div>
    <div className="panel"><div className="panel-head"><h3>Save Changes</h3></div><p className="muted">Save company, account photo, department and leave type changes.</p><button className="primary" onClick={saveSettings}>Save settings</button></div>
    <BackendPanel state={state} setState={setState} notify={notify} backendSession={backendSession} setBackendSession={setBackendSession} />
  </section>;
}

function BackendPanel({
  state,
  setState,
  notify,
  backendSession,
  setBackendSession
}: {
  state: HrState;
  setState: React.Dispatch<React.SetStateAction<HrState>>;
  notify: (message: string) => void;
  backendSession: BackendSession | null;
  setBackendSession: React.Dispatch<React.SetStateAction<BackendSession | null>>;
}) {
  const now = new Date();
  const [email, setEmail] = useState(backendSession?.email || "");
  const [password, setPassword] = useState("");
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [busy, setBusy] = useState("");
  const [savedAt, setSavedAt] = useState("");

  async function login() {
    setBusy("login");
    try {
      const session = await loginBackend(email, password);
      setBackendSession(session);
      notify(`Backend connected as ${session.role}.`);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function sync() {
    if (!backendSession) return notify("Login to the backend first.");
    setBusy("sync");
    try {
      const { state: nextState, updatedAt } = await loadBackendState(state, backendSession);
      setState(hydrateState(nextState));
      setBackendSession(prev => prev && updatedAt ? { ...prev, stateUpdatedAt: updatedAt } : prev);
      notify("Backend data loaded into the HR console.");
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function saveAll() {
    if (!backendSession) return notify("Login to the backend first.");
    setBusy("save");
    try {
      const saved = await saveBackendState(state, backendSession);
      setBackendSession(prev => prev ? { ...prev, stateUpdatedAt: saved.updatedAt } : prev);
      setSavedAt(new Date(saved.updatedAt).toLocaleString());
      notify("Full HR workspace saved to backend.");
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function runBackendPayroll() {
    if (!backendSession) return notify("Login to the backend first.");
    setBusy("payroll");
    try {
      await generateBackendPayroll(backendSession, year, month);
      const { state: nextState, updatedAt } = await loadBackendState(state, backendSession);
      setState(hydrateState(nextState));
      setBackendSession(prev => prev && updatedAt ? { ...prev, stateUpdatedAt: updatedAt } : prev);
      notify(`Backend payroll generated for ${months[month - 1]} ${year}.`);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function disconnect() {
    const session = backendSession;
    setBackendSession(null);
    if (!session) return;
    try {
      await logoutBackend(session);
      notify("Backend session ended.");
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  return <div className="panel backend-panel">
    <div className="panel-head"><div><h3>Backend Connection</h3><span>{apiBaseUrl}</span></div><Badge value={backendSession ? "Connected" : "Disconnected"} /></div>
    <div className="form-grid compact">
      <label htmlFor="backend-email">Email<input id="backend-email" name="backend-email" type="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label htmlFor="backend-password">Password<input id="backend-password" name="backend-password" type="password" value={password} placeholder="Backend password" onChange={event => setPassword(event.target.value)} /></label>
    </div>
    <div className="backend-actions">
      <button className="primary" disabled={busy === "login"} onClick={login}>{busy === "login" ? "Connecting..." : "Login"}</button>
      <button disabled={!backendSession || busy === "save"} onClick={saveAll}>{busy === "save" ? "Saving..." : "Save full workspace"}</button>
      <button disabled={!backendSession || busy === "sync"} onClick={sync}>{busy === "sync" ? "Loading..." : "Load from backend"}</button>
      {backendSession && <button onClick={() => void disconnect()}>Disconnect</button>}
    </div>
    <div className="backend-payroll">
      <select id="backend-payroll-month" name="backend-payroll-month" aria-label="Backend payroll month" value={month} onChange={event => setMonth(Number(event.target.value))}>{months.map((item, index) => <option value={index + 1} key={item}>{item}</option>)}</select>
      <input id="backend-payroll-year" name="backend-payroll-year" aria-label="Backend payroll year" type="number" value={year} onChange={event => setYear(Number(event.target.value))} />
      <button disabled={!backendSession || busy === "payroll"} onClick={runBackendPayroll}>{busy === "payroll" ? "Generating..." : "Generate API payroll"}</button>
    </div>
    <p className="muted">{savedAt ? `Last backend save: ${savedAt}. ` : "Backend autosave is enabled after login."}</p>
  </div>;
}

function DataTable({ columns, rows, empty }: { columns: React.ReactNode[]; rows: React.ReactNode[][]; empty?: string }) {
  if (!rows.length) return <div className="empty">{empty || "No records."}</div>;
  return <div className="table-wrap"><table><thead><tr>{columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function Badge({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const tone = lower.includes("active") || lower.includes("approved") || lower.includes("final") || lower.includes("present") ? "good" : lower.includes("pending") || lower.includes("draft") || lower.includes("review") || lower.includes("late") || lower.includes("half") || lower.includes("leave") ? "warn" : lower.includes("reject") || lower.includes("terminat") || lower.includes("absent") ? "bad" : "neutral";
  return <span className={`badge ${tone}`}>{value}</span>;
}

type CommonProps = {
  state: HrState;
  setState: React.Dispatch<React.SetStateAction<HrState>>;
  setModal: (node: React.ReactNode) => void;
  notify: (message: string) => void;
  close: () => void;
  savePdf: (file: GeneratedPdf | undefined, template: PdfTemplate, employeeId?: string) => void;
};

function fieldType(field: string) {
  if (/(date|expiry|joining|issue|confirmation|passing|esb)/i.test(field)) return "date";
  if (/(salary|allowance|amount|total|tickets|balance|cost|dependents|lop|basic|hra)/i.test(field)) return "number";
  return "text";
}

function daysUntil(value?: string) {
  if (!value) return Number.POSITIVE_INFINITY;
  return Math.ceil((Number(new Date(`${value}T00:00:00`)) - Date.now()) / 86_400_000);
}

function labelize(value: string) {
  return value.replace(/[A-Z]/g, match => ` ${match.toLowerCase()}`).replace(/^./, match => match.toUpperCase());
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Backend request failed.";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

function loadState(): HrState {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? hydrateState(JSON.parse(raw)) : defaultState();
  } catch {
    return defaultState();
  }
}

function hydrateState(value: Partial<HrState>): HrState {
  const base = defaultState();
  return {
    ...base,
    ...value,
    attendance: value.attendance ?? base.attendance,
    attendanceApprovals: value.attendanceApprovals ?? {},
    leaves: value.leaves ?? [],
    payroll: value.payroll ?? [],
    businessTrips: value.businessTrips ?? [],
    expenses: value.expenses ?? [],
    jobs: value.jobs ?? base.jobs,
    candidates: value.candidates ?? base.candidates,
    eosRecords: value.eosRecords ?? [],
    documents: value.documents ?? [],
    settings: {
      ...base.settings,
      ...value.settings,
      company: { ...base.settings.company, ...value.settings?.company },
      departments: value.settings?.departments ?? base.settings.departments,
      leaveTypes: value.settings?.leaveTypes ?? base.settings.leaveTypes,
      documentSeq: value.settings?.documentSeq ?? base.settings.documentSeq,
      workdayHours: value.settings?.workdayHours ?? base.settings.workdayHours,
      halfDayHours: value.settings?.halfDayHours ?? base.settings.halfDayHours
    }
  };
}

createRoot(document.getElementById("root")!).render(<App />);
