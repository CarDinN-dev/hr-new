import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
  useRouterState
} from "@tanstack/react-router";
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarCheck,
  Download,
  Eye,
  FileText,
  GitBranch,
  HandCoins,
  ImagePlus,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
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
  splitEmployeeName,
  statusOptions,
  type AttendanceCode,
  type BusinessTrip,
  candidateStages,
  type EmployeeRecord,
  type EosRecord,
  type EmployeeExpense,
  type EmployeeLoan,
  type HrState,
  type InterviewAssessment,
  type NavItem,
  type OfferDetails,
  type PdfTemplate,
  type RecruitmentCandidate,
  type RecruitmentJob
} from "./data";
import {
  activeEmployees,
  attendanceDaySummary,
  attendanceStats,
  candidatePipeline,
  clearAttendanceDay,
  companyLoanDeductionCap,
  decideAttendance,
  createEosRecord,
  employeeName,
  employeeSalary,
  eosSummary,
  expenseTotals,
  formatDate,
  formatMoney,
  hireCandidateAsEmployee,
  inclusiveDays,
  initials,
  loanBalance,
  loanEstimatedEndPeriod,
  loanEstimatedMonths,
  loanScheduledAmount,
  markAllAttendance,
  nextEmployeeCode,
  payrollLoanDeductions,
  recordManualLoanRepayment,
  recruitmentJobVacancies,
  setAttendance,
  setLoanDeductionOverride,
  todayISO,
  tripTotal,
  upsertEmployee
} from "./domain";
import {
  backendSessionKey,
  authorizationExpiredEvent,
  ApiError,
  apiDownload,
  apiList,
  apiPage,
  apiRequest,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  loadBackendSession,
  loadBackendState,
  loginBackend,
  logoutBackend,
  restoreBackendSession,
  startMicrosoftLogin,
  type BackendSession
} from "./api";
import { AuthorizationProvider, canAccessRoute, useAuthorization } from "./authorization";
import { importWithReleaseRetry } from "./dynamic-import";
import { persistNormalizedStateDelta } from "./normalizedSync";
import { newId } from "./id";
import { preparePhoto } from "./photo";
import type { GeneratedPdf } from "./pdf";
import { dataUrlBlob, openDataUrl } from "./dataUrl";
import { navItemForPath, navPaths } from "./routing";
import { ApprovalInboxPanel, DocumentsLibraryPanel, LeaveWorkflowPage, MyLeaveStatusPanel, PayrollWorkflowPage, ServiceRequestsPanel } from "./features/workflows";
import { workflowKey } from "./features/workflow-utils";
import { NotificationsPanel } from "./features/notifications-panel";
import { Dialog } from "./dialog";
import { EmployeePicker, type EmployeePickerOption } from "./employee-picker";
import { PageSearchBar, PageSearchProvider, rankedPageSearchItems, usePageSearch, usePageSearchStatus } from "./page-search";
import "./styles.css";

const storageKey = "medtech-hr-erp-v1";
const themeKey = "medtech-hr-theme";
const compactNavigationQuery = "(max-width: 1080px)";
type Theme = "light" | "dark";
const employeeFieldOptions: Record<string, readonly string[]> = {
  "Employee Category": ["Staff", "Management", "Worker", "Intern"],
  "Work Shift": ["Standard day", "Morning shift", "Evening shift", "Night shift", "Rotating shift"],
  "Hire Type": ["Direct", "Recruitment", "Transfer", "Contract"],
  Gender: ["Male", "Female", "Other", "Prefer not to say"],
  "Marital Status": ["Single", "Married", "Divorced", "Widowed"],
  "Family Status (Yes/No)": ["Yes", "No"],
  "Blood Group": ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
  "Visa Type": ["Work residence", "Family residence", "Business visa", "Visit visa", "Other"],
  "Salary Pay Type": ["Bank Transfer", "Cash", "Cheque"],
  "Company Accommodation": ["Yes", "No"],
  "Company Transportation": ["Yes", "No"],
  "Company Conveyance": ["Yes", "No"],
  "Company Fuel": ["Yes", "No"],
  "Company Other": ["Yes", "No"],
  "Overtime Eligible": ["Yes", "No"],
  "Company Food": ["Yes", "No"],
  "Company Fuel Card": ["Yes", "No"]
};
const SystemAccessPage = React.lazy(() => importWithReleaseRetry("system-access", () => import("./features/system-access").then(module => ({ default: module.SystemAccessPage }))));
const HierarchyPage = React.lazy(() => importWithReleaseRetry("hierarchy-page", () => import("./features/hierarchy-page").then(module => ({ default: module.HierarchyPage }))));
const AuditHistoryPage = React.lazy(() => importWithReleaseRetry("audit-page", () => import("./features/audit-page").then(module => ({ default: module.AuditHistoryPage }))));
const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => !(error instanceof ApiError && [401, 403].includes(error.status)) && failureCount < 2
    },
    mutations: { retry: false }
  }
});

function workspaceQueryKey(session: BackendSession) {
  return ["workspace", session.sessionId, session.authorizationVersion] as const;
}

function pageSearchPath(path: string, search: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}search=${encodeURIComponent(search)}`;
}

function usePageSearchList<T>(key: string, path: string, enabled = true, reportStatus = true) {
  const { search, active } = usePageSearch();
  const query = useQuery({
    queryKey: ["page-search", key, path, search],
    queryFn: () => apiList<T>(pageSearchPath(path, search)),
    enabled: active && enabled,
    placeholderData: previous => previous,
  });
  usePageSearchStatus(key, { count: query.data?.length, loading: query.isFetching, error: query.error?.message }, reportStatus);
  return query;
}

function useSectionSearch(page: "dashboard" | "reports" | "settings") {
  const { search, active } = usePageSearch();
  const query = useQuery({
    queryKey: ["section-search", page, search],
    queryFn: () => apiRequest<{ data: Array<{ id: string; score: number }> }>(`/search/sections?page=${page}&search=${encodeURIComponent(search)}`),
    enabled: active,
  });
  const ids = new Set(query.data?.data.map(item => item.id));
  usePageSearchStatus(`sections-${page}`, { count: query.data?.data.length, loading: query.isFetching, error: query.error?.message });
  return { active, ids, visible: (id: string) => !active || query.isPending || ids.has(id), query };
}

function backendSessionMarker(session: BackendSession) {
  return `${session.sessionId}:${session.authorizationVersion}`;
}

const navIcon = {
  Dashboard: LayoutDashboard,
  "My HR": UserRoundPlus,
  Team: UsersRound,
  Employees: UsersRound,
  Attendance: CalendarCheck,
  Leave: BriefcaseBusiness,
  Loans: HandCoins,
  Payroll: WalletCards,
  Recruitment: UserRoundPlus,
  EOS: FileText,
  Documents: FileText,
  Reports: BarChart3,
  Audit: ShieldCheck,
  Hierarchy: GitBranch,
  System: Settings,
  Settings
};

async function withPdf<T>(action: (pdf: typeof import("./pdf")) => T) {
  return action(await importWithReleaseRetry("pdf", () => import("./pdf")));
}

function templateName(id: PdfTemplate) {
  return pdfTemplates.find(item => item.id === id)?.label ?? reportTemplates.find(item => item.id === id)?.label ?? id;
}

function employeePickerOptions(employees: readonly EmployeeRecord[]): EmployeePickerOption[] {
  return employees.map(employee => ({ id: employee.id, label: `${employee.fields["Employee Code"]} — ${employeeName(employee)}` }));
}

function confirmDelete(label: string) {
  return window.confirm(`Delete ${label}? This cannot be undone.`);
}

function accountInitials(value: string) {
  return value.split("@")[0].split(/[.\s_-]+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "HR";
}

function LoginPage({ onLogin, notify }: { onLogin: (session: BackendSession) => void; notify: (message: string) => void }) {
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
      <section className="login-card" aria-labelledby="login-title">
        <header className="login-header">
          <div className="login-product">
            <img src="/logos/brand-mark.svg?v=4" alt="" aria-hidden="true" />
            <span>HR sign in</span>
          </div>
        </header>
        <div className="login-content">
          <div className="login-mobile-logo">
            <img src="/logos/medtech-lockup.svg?v=4" alt="MedTech Corporation Trading W.L.L." />
          </div>
          <div className="login-intro">
            <span className="login-eyebrow"><ShieldCheck size={15} /> Secure HR access</span>
            <h1 id="login-title">Welcome back</h1>
            <p>Sign in with your MedTech work account.</p>
          </div>
          <button className="microsoft-login" type="button" onClick={startMicrosoftLogin}>
            <ShieldCheck size={17} /> Sign in with Microsoft
          </button>
          <div className="login-divider" aria-hidden="true"><span>or</span></div>
          <form className="login-form" onSubmit={submit}>
            <label htmlFor="login-email"><span>Email</span><input id="login-email" name="email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label>
            <label htmlFor="login-password"><span>Password</span><input id="login-password" name="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
            <button className="primary" type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
          </form>
        </div>

        <footer className="login-footer">MedTech Corporation Trading W.L.L.</footer>
      </section>
      <section className="login-stage" aria-label="MedTech HR system">
        <div className="login-stage-art" aria-hidden="true" />
        <div className="login-stage-content">
          <div className="login-stage-logo"><img src="/logos/medtech-lockup.svg?v=4" alt="MedTech Corporation Trading W.L.L." /></div>
          <div className="login-stage-copy">
            <span>HR and payroll</span>
            <strong>People, payroll, and attendance. One secure workspace.</strong>
          </div>
        </div>
      </section>
    </main>
  );
}

function App() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const nav = useRouterState({ select: routerState => navItemForPath(routerState.location.pathname) });
  const [state, setState] = useState<HrState>(() => loadState());
  const [toast, setToast] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [compactNavigation, setCompactNavigation] = useState(() => window.matchMedia(compactNavigationQuery).matches);
  const [modal, setModal] = useState<React.ReactNode>(null);
  const [backendSession, setBackendSession] = useState<BackendSession | null | undefined>(() => loadBackendSession() ?? undefined);
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem(themeKey) === "dark" ? "dark" : "light");
  const [syncError, setSyncError] = useState("");
  const [syncAlertDismissed, setSyncAlertDismissed] = useState(false);
  const backendReady = useRef(false);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const sidebarCloseRef = useRef<HTMLButtonElement>(null);
  const sidebarWasOpen = useRef(false);
  const hydratedWorkspaceSession = useRef("");
  const backendSessionRef = useRef<BackendSession | null | undefined>(backendSession);
  const stateRef = useRef(state);
  const persistedStateRef = useRef(state);
  const backendSaveQueue = useRef<Promise<void>>(Promise.resolve());
  stateRef.current = state;
  const workspaceQuery = useQuery({
    queryKey: backendSession ? workspaceQueryKey(backendSession) : ["workspace", "signed-out"],
    queryFn: () => loadBackendState(stateRef.current, backendSession!),
    enabled: Boolean(backendSession),
    staleTime: 30_000
  });
  const workspaceLoadError = workspaceQuery.isError ? errorMessage(workspaceQuery.error) : "";
  const workspaceLoading = Boolean(backendSession) && !workspaceLoadError && (
    workspaceQuery.isPending || hydratedWorkspaceSession.current !== backendSessionMarker(backendSession!)
  );

  useEffect(() => {
    localStorage.removeItem(storageKey);
  }, []);

  useEffect(() => {
    const expireAuthorization = () => {
      queryClient.clear();
      setBackendSession(null);
    };
    window.addEventListener(authorizationExpiredEvent, expireAuthorization);
    return () => window.removeEventListener(authorizationExpiredEvent, expireAuthorization);
  }, [queryClient]);

  useEffect(() => {
    if (backendSession !== undefined) return;
    let active = true;
    const microsoftResult = new URLSearchParams(window.location.search).get("microsoft");
    void restoreBackendSession()
      .then(session => {
        if (!active) return;
        setBackendSession(session);
        if (microsoftResult === "success" && session) notify(`Signed in as ${session.email}.`);
        if (microsoftResult === "denied") notify("Microsoft sign-in was not permitted.");
      })
      .catch(error => {
        if (!active) return;
        setBackendSession(null);
        notify(errorMessage(error));
      })
      .finally(() => {
        if (microsoftResult && active) window.history.replaceState(null, "", window.location.pathname);
      });
    return () => { active = false; };
  }, [backendSession]);

  useEffect(() => {
    backendSessionRef.current = backendSession;
    if (backendSession === undefined) return;
    if (backendSession) sessionStorage.setItem(backendSessionKey, JSON.stringify(backendSession));
    else sessionStorage.removeItem(backendSessionKey);
    localStorage.removeItem(backendSessionKey);
  }, [backendSession]);

  useEffect(() => {
    if (!backendSession) {
      backendReady.current = false;
      hydratedWorkspaceSession.current = "";
      setSyncError("");
      return;
    }
    if (workspaceQuery.error instanceof ApiError && [401, 403].includes(workspaceQuery.error.status)) {
      queryClient.removeQueries({ queryKey: workspaceQueryKey(backendSession) });
      setBackendSession(null);
      notify(errorMessage(workspaceQuery.error));
      return;
    }
    const sessionMarker = backendSessionMarker(backendSession);
    if (!workspaceQuery.data || hydratedWorkspaceSession.current === sessionMarker) return;
    hydratedWorkspaceSession.current = sessionMarker;
    const hydrated = hydrateState(workspaceQuery.data.state);
    persistedStateRef.current = hydrated;
    setState(hydrated);
    setBackendSession(prev => prev && workspaceQuery.data.updatedAt ? { ...prev, stateUpdatedAt: workspaceQuery.data.updatedAt } : prev);
    backendReady.current = true;
    setSyncError("");
  }, [backendSession?.sessionId, backendSession?.authorizationVersion, workspaceQuery.data, workspaceQuery.error, queryClient]);

  useEffect(() => {
    if (!backendSession || !backendReady.current) return;
    const timer = window.setTimeout(() => {
      void saveBackendNow().catch(error => {
        backendReady.current = false;
        setSyncError(errorMessage(error));
        setSyncAlertDismissed(false);
      });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [state, backendSession?.sessionId, backendSession?.authorizationVersion]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(themeKey, theme);
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia(compactNavigationQuery);
    const updateNavigationMode = (event: MediaQueryListEvent | MediaQueryList) => {
      setCompactNavigation(event.matches);
      if (!event.matches) setSidebarOpen(false);
    };
    updateNavigationMode(media);
    media.addEventListener("change", updateNavigationMode);
    return () => media.removeEventListener("change", updateNavigationMode);
  }, []);

  useEffect(() => {
    const wasOpen = sidebarWasOpen.current;
    sidebarWasOpen.current = sidebarOpen;
    if (!compactNavigation || !sidebarOpen) {
      if (wasOpen && compactNavigation) mobileMenuRef.current?.focus();
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebarCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [compactNavigation, sidebarOpen]);

  useEffect(() => {
    document.title = backendSession === null
      ? "Sign in | MedTech HR ERP"
      : nav
        ? `${nav} | MedTech HR ERP`
        : "Page not found | MedTech HR ERP";
  }, [backendSession, nav]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  function saveBackendNow(): Promise<BackendSession> {
    const save = backendSaveQueue.current.then(async () => {
      const session = backendSessionRef.current;
      if (!session) throw new Error("Your session has ended. Sign in again.");
      const previous = persistedStateRef.current;
      const next = stateRef.current;
      if (JSON.stringify(previous) === JSON.stringify(next)) return session;
      await persistNormalizedStateDelta(previous, next, session);
      const linkedEmployee = next.employees.find(employee => employee.fields["E-Mail ID (Work)"].trim().toLowerCase() === session.email.toLowerCase());
      const nextSession = (linkedEmployee && linkedEmployee.id !== session.employeeId ? await restoreBackendSession() : null) ?? session;
      const loaded = await loadBackendState(next, nextSession);
      const hydrated = hydrateState(loaded.state);
      persistedStateRef.current = hydrated;
      stateRef.current = hydrated;
      setState(hydrated);
      if (backendSessionRef.current && backendSessionMarker(backendSessionRef.current) === backendSessionMarker(session)) {
        backendSessionRef.current = nextSession;
        setBackendSession(nextSession);
      }
      queryClient.setQueryData(workspaceQueryKey(nextSession), { state: hydrated });
      await queryClient.invalidateQueries({ queryKey: ["dashboard-birthdays"] });
      setSyncError("");
      return nextSession;
    });
    backendSaveQueue.current = save.then(() => undefined, () => undefined);
    return save;
  }

  function closeModal() {
    setModal(null);
    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(".content button.primary, .content a[href], .content button") ?? document.querySelector<HTMLElement>("main button");
      target?.focus({ preventScroll: true });
    }, 0);
  }

  async function refreshWorkspace() {
    const session = backendSessionRef.current;
    if (!session) return;
    const loaded = await loadBackendState(stateRef.current, session);
    const hydrated = hydrateState(loaded.state);
    persistedStateRef.current = hydrated;
    stateRef.current = hydrated;
    setState(hydrated);
    queryClient.setQueryData(workspaceQueryKey(session), { state: hydrated });
    await queryClient.invalidateQueries({ queryKey: ["dashboard-birthdays"] });
  }

  function savePdf(file: GeneratedPdf | undefined, _template: PdfTemplate, _employeeId = "") {
    if (!file) return;
    // ponytail: a browser download must not mutate HR data; document archival uses the Documents upload flow.
    notify(`${file.filename} downloaded.`);
  }

  function toggleTheme() {
    setTheme(prev => prev === "dark" ? "light" : "dark");
  }

  async function logout() {
    const session = backendSessionRef.current;
    queryClient.clear();
    setBackendSession(null);
    if (!session) return;
    try {
      await logoutBackend(session);
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  async function retrySave() {
    backendReady.current = true;
    setSyncError("");
    try {
      await saveBackendNow();
    } catch (error) {
      backendReady.current = false;
      setSyncError(errorMessage(error));
      setSyncAlertDismissed(false);
    }
  }

  function setNav(next: NavItem) {
    void navigate({ to: navPaths[next] });
  }

  if (backendSession === undefined) {
    return (
      <main className="workspace-gate">
        <section className="workspace-gate-card" aria-live="polite">
          <ShieldCheck size={28} />
          <h1>Checking secure session</h1>
          <p>Verifying your access.</p>
        </section>
      </main>
    );
  }

  if (backendSession === null) {
    return (
      <>
        <LoginPage onLogin={session => { setBackendSession(session); notify(`Signed in as ${session.email}.`); }} notify={notify} />
        {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
      </>
    );
  }

  if (workspaceLoading || workspaceLoadError) {
    return (
      <main className="workspace-gate">
        <section className="workspace-gate-card" aria-live="polite">
          <ShieldCheck size={28} />
          <h1>{workspaceLoading ? "Loading HR workspace" : "Workspace could not be loaded"}</h1>
          <p>{workspaceLoading ? "Your records are being loaded securely." : workspaceLoadError}</p>
          {!workspaceLoading && <div className="form-actions">
            <button className="primary" type="button" onClick={() => void workspaceQuery.refetch()}>Try again</button>
            <button type="button" onClick={() => void logout()}>Sign out</button>
          </div>}
        </section>
      </main>
    );
  }

  const visibleNavItems = navItems.filter(item => canAccessRoute(backendSession, item));
  if (!nav) return <NotFoundPage />;
  if (!canAccessRoute(backendSession, nav)) return <AccessDenied onBack={() => setNav("Dashboard")} />;
  const canViewSalary = hasAnyPermission(backendSession, "employee.self.read_compensation", "payroll.read_compensation");
  const canManageAttendance = hasPermission(backendSession, "attendance.hr.manage");
  const canManageLoans = hasPermission(backendSession, "loan.hr.manage");
  const pageHint = pageDescription(nav);

  return (
    <AuthorizationProvider session={backendSession}><PageSearchProvider key={nav} page={nav}><div className={`app${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside
        id="main-navigation"
        className={`sidebar ${sidebarOpen ? "open" : ""}`}
        aria-label="Main navigation"
        aria-hidden={compactNavigation && !sidebarOpen ? true : undefined}
        inert={compactNavigation && !sidebarOpen ? true : undefined}
        hidden={!compactNavigation && sidebarCollapsed}
      >
        <div className="brand-block">
          <span className="logo-crop wordmark"><img src="/logos/medtech-logo-page-2.svg" alt="MedTech Corporation Trading W.L.L." /></span>
          <button ref={sidebarCloseRef} className="sidebar-close" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        </div>
        <nav className="nav-list" aria-label="HR modules">
          {visibleNavItems.map(item => {
            const Icon = navIcon[item];
            return (
              <Link key={item} to={navPaths[item]} className={item === nav ? "active" : ""} aria-current={item === nav ? "page" : undefined} onClick={() => setSidebarOpen(false)}>
                <Icon size={18} />
                {item}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="workspace">
        {syncError && !syncAlertDismissed && <div className="sync-alert" role="alert">
          <span><strong>Changes are not saved.</strong> {syncError}</span>
          <button type="button" onClick={() => void retrySave()}>Retry save</button>
          <button type="button" aria-label="Dismiss save error" title="Dismiss" onClick={() => setSyncAlertDismissed(true)}><X size={16} /></button>
        </div>}
        <header className="topbar">
          <button ref={mobileMenuRef} className="mobile-menu" type="button" aria-label="Open menu" aria-controls="main-navigation" aria-expanded={sidebarOpen} onClick={() => { setSidebarCollapsed(false); setSidebarOpen(true); }}><Menu size={20} /></button>
          <div className="topbar-heading">
            <span className="topbar-brand-mark" aria-hidden="true"><img src="/logos/medtech-logo-page-2.svg" alt="" /></span>
            <button
              className="desktop-sidebar-toggle"
              type="button"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-controls="main-navigation"
              aria-expanded={!sidebarCollapsed}
              onClick={() => setSidebarCollapsed(collapsed => !collapsed)}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
            <div className="page-title">
              <p className="section-label">MedTech Corporation Trading W.L.L.</p>
              <h1>{nav}</h1>
              <p className="page-hint">{pageHint}</p>
            </div>
          </div>
          {nav !== "Employees" && <PageSearchBar page={nav} />}
          <div className="topbar-actions">
            <NotificationsPanel session={backendSession} notify={notify} />
            <button className="icon-button" type="button" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"}>
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <AccountMenu
              state={state}
              backendSession={backendSession}
              onLogout={() => void logout()}
              setNav={setNav}
              theme={theme}
              toggleTheme={toggleTheme}
            />
          </div>
        </header>

        <div className={`content${nav === "Hierarchy" ? " hierarchy-content" : ""}`}><React.Suspense fallback={<section className="module-loading" aria-live="polite"><span className="spinner" /><p>Loading module…</p></section>}>
          {nav === "Dashboard" && <Dashboard state={state} session={backendSession} setNav={setNav} notify={notify} canAddEmployee={hasPermission(backendSession, "employee.hr.create")} canRunPayroll={hasPermission(backendSession, "payroll.generate")} canOpenPayroll={canAccessRoute(backendSession, "Payroll")} onAddEmployee={() => {
            setNav("Employees");
            setModal(<EmployeeEditor state={state} close={closeModal} notify={notify} save={employee => setState(prev => upsertEmployee(prev, employee))} />);
          }} />}
          {nav === "My HR" && <MyHrPage state={state} session={backendSession} notify={notify} refreshWorkspace={refreshWorkspace} onOpenLeave={() => setNav("Leave")} />}
          {nav === "Team" && <TeamPage state={state} session={backendSession} notify={notify} />}
          {nav === "Employees" && <Employees state={state} setState={setState} setModal={setModal} notify={notify} close={closeModal} savePdf={savePdf} canCreate={hasPermission(backendSession, "employee.hr.create")} canUpdate={hasPermission(backendSession, "employee.hr.update")} canTerminate={hasPermission(backendSession, "employee.hr.terminate")} canImport={hasAllPermissions(backendSession, "import.run", "employee.hr.create", "employee.hr.update", "employee.hr.read_sensitive", "department.manage", "position.manage", "payroll.configure")} canExport={hasAnyPermission(backendSession, "report.export", "audit.export")} canViewSalary={canViewSalary} session={backendSession} refreshWorkspace={refreshWorkspace} />}
          {nav === "Attendance" && <Attendance state={state} setState={setState} savePdf={savePdf} notify={notify} canManage={canManageAttendance} canExport={hasAnyPermission(backendSession, "report.export", "audit.export")} />}
          {nav === "Leave" && <LeaveWorkflowPage session={backendSession} notify={notify} />}
          {nav === "Loans" && <Loans state={state} setState={setState} setModal={setModal} notify={notify} close={closeModal} canOverrideLimit={canManageLoans} />}
          {nav === "Payroll" && <PayrollWorkflowPage session={backendSession} notify={notify} />}
          {nav === "Recruitment" && <Recruitment state={state} setState={setState} notify={notify} setNav={setNav} />}
          {nav === "EOS" && <EOS state={state} setState={setState} notify={notify} savePdf={savePdf} />}
          {nav === "Documents" && <Documents state={state} session={backendSession} notify={notify} savePdf={savePdf} />}
          {nav === "Reports" && <Reports state={state} notify={notify} savePdf={savePdf} />}
          {nav === "Audit" && <AuditHistoryPage session={backendSession} notify={notify} />}
          {nav === "Hierarchy" && <HierarchyPage session={backendSession} employees={state.employees} onAddNode={(role, parent) => {
            const draft = createEmptyEmployee(nextEmployeeCode(state.employees));
            draft.fields = {
              ...draft.fields,
              Designation: ({ HR: "HR", MANAGER: "Manager", LINE_MANAGER: "Line manager", EMPLOYEE: "Employee" } as const)[role],
              Department: parent?.fields.Department || "",
              "Joining Date": todayISO(),
              "Line Manager Employee Code/Name": role === "EMPLOYEE" && parent ? `${parent.fields["Employee Code"]} - ${employeeName(parent)}` : "",
              "Manager Employee Code/Name": role === "LINE_MANAGER" && parent ? `${parent.fields["Employee Code"]} - ${employeeName(parent)}` : role === "EMPLOYEE" ? parent?.fields["Manager Employee Code/Name"] || "" : "",
              "Reporting Manager Employee Code/Name": role === "EMPLOYEE" && parent ? `${parent.fields["Employee Code"]} - ${employeeName(parent)}` : "",
            };
            setModal(<EmployeeEditor state={state} template={draft} close={closeModal} notify={notify} save={employee => setState(previous => upsertEmployee(previous, employee))} />);
          }} onUpdateReporting={async (employeeId, reporting) => {
            await apiRequest(`/employees/${employeeId}`, { method: "PATCH", csrfToken: backendSession.csrfToken, body: JSON.stringify(reporting) });
            await refreshWorkspace();
            notify("Reporting lines updated in Employees and Hierarchy.");
          }} onExportRoleHierarchy={() => void withPdf(pdf => {
            const file = pdf.saveRoleHierarchyPdf(state.employees, state.settings);
            notify(`${file.filename} downloaded.`);
          })} />}
          {nav === "System" && <SystemAccessPage session={backendSession} notify={notify} />}
          {nav === "Settings" && <SettingsPage state={state} setState={setState} notify={notify} backendSession={backendSession} />}
        </React.Suspense></div>
      </main>

      {compactNavigation && sidebarOpen && <button type="button" aria-label="Close menu" className="scrim" onClick={() => setSidebarOpen(false)} />}
      {modal && <Dialog onClose={closeModal}>{modal}</Dialog>}
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </div></PageSearchProvider></AuthorizationProvider>
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const photo = state.employees.find(employee => employee.id === backendSession.employeeId)?.photo;

  useEffect(() => {
    if (!open) return;
    popoverRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function go(destination: NavItem) {
    setOpen(false);
    setNav(destination);
  }

  return <div className="account-menu account-menu--topbar">
    {open && <div id="account-popover" ref={popoverRef} className="account-popover" role="menu" aria-label="Account options" onKeyDown={event => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]"));
      const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
      items[(current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }}>
      <div className="account-popover-identity" role="presentation">
        <span className="account-avatar">{photo ? <img src={photo} alt="" /> : accountInitials(backendSession.email)}</span>
        <span className="account-label">
          <strong>{backendSession.displayName || backendSession.email}</strong>
          <small>{backendSession.roles.join(", ")}</small>
        </span>
      </div>
      <button role="menuitem" onClick={() => { toggleTheme(); setOpen(false); }}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />} {theme === "dark" ? "Light mode" : "Dark mode"}</button>
      {canAccessRoute(backendSession, "My HR") && <button role="menuitem" onClick={() => go("My HR")}><UsersRound size={16} /> My HR</button>}
      {canAccessRoute(backendSession, "Settings") && <button role="menuitem" onClick={() => go("Settings")}><Settings size={16} /> Settings</button>}
      <button role="menuitem" onClick={onLogout}><LogOut size={16} /> Log out</button>
    </div>}
    <button ref={triggerRef} className="account-trigger" aria-label="Open account menu" title={backendSession.displayName || backendSession.email} aria-haspopup="menu" aria-controls="account-popover" aria-expanded={open} onClick={() => setOpen(prev => !prev)}>
      <span className="account-avatar">{photo ? <img src={photo} alt="" /> : accountInitials(backendSession.email)}</span>
    </button>
  </div>;
}

function AccessDenied({ onBack }: { onBack: () => void }) {
  return <main className="workspace-gate"><section className="workspace-gate-card" role="alert">
    <ShieldCheck size={28} />
    <h1>Access not available</h1>
    <p>Your account does not have permission to open this area.</p>
    <button className="primary" type="button" onClick={onBack}>Return to dashboard</button>
  </section></main>;
}

function MyHrPage({ state, session, notify, refreshWorkspace, onOpenLeave }: { state: HrState; session: BackendSession; notify: (message: string) => void; refreshWorkspace: () => Promise<void>; onOpenLeave: () => void }) {
  const employee = state.employees.find(item => item.id === session.employeeId);
  const { active: searchActive } = usePageSearch();
  const matches = usePageSearchList<{ id: string }>("my-hr-employee", "/employees");
  const profileMatches = !searchActive || matches.data?.some(item => item.id === employee?.id);

  return <div className="dashboard-grid">
    {profileMatches && <ProfilePhotoPanel employee={employee} session={session} notify={notify} refreshWorkspace={refreshWorkspace} />}
    {profileMatches && <section className="panel span-2"><div className="panel-head"><div><h3>Personal information</h3><span>HR maintains these details in Employees.</span></div></div>
      {!employee ? <p className="muted">No employee record is linked to this account.</p> : <div className="form-grid">
        {[
          ["Name", employeeName(employee)], ["Employee ID", employee.fields["Employee Code"]], ["Designation", employee.fields.Designation],
          ["Reporting manager", employee.fields["Reporting Manager Employee Code/Name"] || employee.fields["Line Manager Employee Code/Name"]],
          ["Department", employee.fields.Department], ["Phone number", employee.fields["Personal Mobile No."] || employee.fields["Office Mobile No."]],
          ["Email address", employee.fields["E-Mail ID (Work)"]]
        ].map(([label, value]) => <label key={label}>{label}<input value={value || "-"} readOnly aria-readonly="true" /></label>)}
      </div>}
    </section>}
    <MyLeaveStatusPanel session={session} onOpenLeave={onOpenLeave} />
    {searchActive && matches.isSuccess && !profileMatches && <div className="empty span-2">No profile fields match this search.</div>}
  </div>;
}

function TeamPage({ state, session, notify }: { state: HrState; session: BackendSession; notify: (message: string) => void }) {
  const { active: searchActive } = usePageSearch();
  const matches = usePageSearchList<{ id: string }>("team-employees", "/employees");
  const employees = rankedPageSearchItems(state.employees, matches.data, searchActive, employee => employee.id, match => match.id);
  return <div className="dashboard-grid">
    <Metric label="PEOPLE IN SCOPE" value={state.employees.length} hint="Direct reports and managed departments" />
    <section className="panel span-2"><div className="panel-head"><div><h3>People in your scope</h3><span>Compensation, bank and confidential HR fields are not included.</span></div></div>
      <DataTable label="People in scope" empty="No team members match this search." columns={["Employee", "Department", "Status", "Joined"]} rows={employees.map(employee => [employeeName(employee), employee.fields.Department || "-", employee.status, formatDate(employee.fields["Joining Date"])])} />
    </section>
    <ApprovalInboxPanel session={session} notify={notify} />
  </div>;
}

type DashboardAttendanceReport = { summary: { totalRecords: number; byStatus: Record<string, number> } };
type DashboardLeave = { id: string; status: string; startDate: string; endDate: string; totalDays: string; employee: { firstName: string; lastName: string }; leaveType: { name: string } };
type DashboardPayrollRun = { id: string; year: number; month: number; status: string; _count?: { payrolls: number } };
type DashboardLeaveBalance = { leaveType: { name: string }; availableDays: string | number; totalDays: string | number; usedDays: string | number; pendingDays: string | number; eligible: boolean; noBalanceRequired: boolean };
type DashboardServiceRequest = { id: string; requestType: string; status: string; createdAt: string };
type DashboardAnnouncement = { id: string; title: string; content: string; publishedAt: string | null; createdAt: string };
type DashboardApprovalInbox = { leave: unknown[]; certificates: unknown[]; payroll: unknown[] };
type DashboardPagination = { total: number };
type DashboardPersona = "employee" | "line-manager" | "manager" | "hr" | "cpo" | "coo";

const dashboardPersonaPriority: Array<[string, DashboardPersona]> = [
  ["COO", "coo"], ["CPO", "cpo"], ["HR", "hr"], ["MANAGER", "manager"], ["LINE_MANAGER", "line-manager"], ["EMPLOYEE", "employee"],
];

function dashboardPersona(session: BackendSession): DashboardPersona {
  if (session.roles.includes("SUPER_ADMIN") || session.roles.includes("ADMIN")) return "hr";
  return dashboardPersonaPriority.find(([role]) => session.roles.includes(role))?.[1] || "employee";
}

function dashboardGreeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function dashboardRoleCopy(persona: DashboardPersona) {
  return ({
    employee: ["Employee", "Here’s your personal leave, document and request update."],
    "line-manager": ["Line Manager", "Here’s what your team needs from you today."],
    manager: ["Manager", "Here’s your department’s leave and approval overview."],
    hr: ["Human Resources", "Here’s the operational people snapshot for today."],
    cpo: ["Chief People Officer", "Here’s the people strategy snapshot for today."],
    coo: ["Chief Operating Officer", "Here’s the organization overview for today."],
  } as const)[persona];
}

function dashboardPending(items: DashboardLeave[]) {
  return items.filter(item => item.status.startsWith("PENDING_") || item.status === "BLOCKED_APPROVER_MISSING" || item.status === "RETURNED_FOR_CORRECTION");
}

function Dashboard({ state, session, setNav, notify, onAddEmployee, canAddEmployee, canRunPayroll, canOpenPayroll }: { state: HrState; session: BackendSession; setNav: (nav: NavItem) => void; notify: (message: string) => void; onAddEmployee: () => void; canAddEmployee: boolean; canRunPayroll: boolean; canOpenPayroll: boolean }) {
  const { search, active: searchActive } = usePageSearch();
  const employeeSearch = usePageSearchList<{ id: string }>("dashboard-employees", "/employees");
  const persona = dashboardPersona(session);
  const [roleLabel, roleSubtitle] = dashboardRoleCopy(persona);
  const personalDashboard = persona === "employee";
  const managementDashboard = persona === "line-manager" || persona === "manager";
  const operationalDashboard = persona === "hr";
  const executiveDashboard = persona === "cpo" || persona === "coo";
  const active = activeEmployees(state.employees);
  const matchingActive = rankedPageSearchItems(active, employeeSearch.data, searchActive, employee => employee.id, match => match.id);
  const todayValue = todayISO();
  const canReadScopedEmployees = !personalDashboard && hasAnyPermission(session, "employee.team.read", "employee.management.read", "employee.hr.read", "employee.read_all");
  const canReadAttendanceSummary = (operationalDashboard || executiveDashboard) && hasAnyPermission(session, "attendance.hr.read", "attendance.audit.read", "attendance.read_all");
  const attendance = useQuery({ queryKey: ["dashboard-attendance", session.sessionId, session.authorizationVersion, todayValue], queryFn: () => apiRequest<DashboardAttendanceReport>(`/attendance/reports/summary?dateFrom=${todayValue}&dateTo=${todayValue}&limit=100`), enabled: canReadAttendanceSummary });
  const canReadLeave = hasAnyPermission(session, "leave.self.read", "leave.team.read", "leave.management.read", "leave.hr.read", "leave.read_all");
  const broadLeave = !personalDashboard && hasAnyPermission(session, "leave.team.read", "leave.management.read", "leave.hr.read", "leave.read_all");
  const canLoadDashboardLeave = personalDashboard ? canReadLeave : broadLeave;
  const leavePath = broadLeave ? "/leave/requests" : "/leave/mine";
  const leaveRecords = useQuery({ queryKey: ["dashboard-leave", session.sessionId, session.authorizationVersion, broadLeave], queryFn: () => apiList<DashboardLeave>(leavePath), enabled: canLoadDashboardLeave });
  const searchedLeaveRecords = useQuery({ queryKey: ["dashboard-leave-search", session.sessionId, session.authorizationVersion, broadLeave, search], queryFn: () => apiList<DashboardLeave>(pageSearchPath(leavePath, search)), enabled: canLoadDashboardLeave && searchActive });
  const canOpenApprovalInbox = !personalDashboard && hasAnyPermission(session, "leave.team.approve_line_manager", "leave.management.approve_manager", "leave.hr.approve", "leave.executive.approve_cpo", "leave.executive.approve_coo", "leave.executive.self_approve_coo");
  const approvalInbox = useQuery({ queryKey: [...workflowKey(session, "approval-inbox"), search], queryFn: () => apiRequest<DashboardApprovalInbox>(`/approvals/inbox${search ? `?search=${encodeURIComponent(search)}` : ""}`), enabled: canOpenApprovalInbox });
  const canReadPersonalBalances = personalDashboard && Boolean(session.employeeId) && hasPermission(session, "leave.self.read");
  const canReadPersonalRequests = personalDashboard && hasPermission(session, "service_request.self.read");
  const canReadAnnouncements = personalDashboard && hasPermission(session, "announcement.read");
  const canReadPersonalDocuments = personalDashboard && hasPermission(session, "document.self.read");
  const balances = useQuery({ queryKey: [...workflowKey(session, "dashboard-leave-balances", new Date().getFullYear())], queryFn: () => apiList<DashboardLeaveBalance>(`/leave/balances?employeeId=${encodeURIComponent(session.employeeId || "")}&year=${new Date().getFullYear()}`), enabled: canReadPersonalBalances });
  const serviceRequests = useQuery({ queryKey: [...workflowKey(session, "dashboard-service-requests"), search], queryFn: () => apiPage<DashboardServiceRequest, DashboardPagination>(`/service-requests?page=1&limit=4${search ? `&search=${encodeURIComponent(search)}` : ""}`), enabled: canReadPersonalRequests });
  const announcements = useQuery({ queryKey: [...workflowKey(session, "dashboard-announcements")], queryFn: () => apiPage<DashboardAnnouncement>("/announcements?page=1&limit=3"), enabled: canReadAnnouncements });
  const currentYear = new Date().getFullYear(); const currentMonth = new Date().getMonth() + 1;
  const canReadPayrollDashboard = operationalDashboard && canOpenPayroll && hasAnyPermission(session, "payroll.read", "payroll.audit.read");
  const payrollRuns = useQuery({ queryKey: ["dashboard-payroll-runs", session.sessionId, session.authorizationVersion, currentYear, currentMonth], queryFn: () => apiList<DashboardPayrollRun>(`/payroll/runs?year=${currentYear}&month=${currentMonth}`), enabled: canReadPayrollDashboard });
  const visibleLeaves = searchActive && searchedLeaveRecords.data !== undefined ? searchedLeaveRecords.data : leaveRecords.data ?? [];
  const pendingLeave = dashboardPending(visibleLeaves);
  const approvedLeave = visibleLeaves.filter(item => item.status === "APPROVED");
  const onLeaveToday = approvedLeave.filter(item => item.startDate <= todayValue && item.endDate >= todayValue);
  const upcomingLeave = approvedLeave.filter(item => item.endDate >= todayValue).sort((left, right) => left.startDate.localeCompare(right.startDate));
  const approvalCount = (approvalInbox.data?.leave.length ?? 0) + (approvalInbox.data?.certificates.length ?? 0) + (approvalInbox.data?.payroll.length ?? 0);
  const attendanceStatus = attendance.data?.summary.byStatus;
  const attendancePresent = (attendanceStatus?.PRESENT ?? 0) + (attendanceStatus?.LATE ?? 0);
  const attendanceAbsent = attendanceStatus?.ABSENT ?? 0;
  const attendanceLate = attendanceStatus?.LATE ?? 0;
  const currentPayroll = payrollRuns.data ?? [];
  const canReadRecruitment = executiveDashboard && hasPermission(session, "recruitment.read");
  const openJobs = state.jobs.filter(job => job.status === "Open" && !recruitmentJobVacancies(job, state.candidates).isFilled);
  const openPositions = openJobs.reduce((total, job) => total + recruitmentJobVacancies(job, state.candidates).remaining, 0);
  const headcount = [...new Set(matchingActive.map(employee => employee.fields.Department || "Unassigned"))].map(department => ({
    department,
    count: matchingActive.filter(employee => (employee.fields.Department || "Unassigned") === department).length
  })).filter(item => item.count > 0);
  const recentJoiners = rankedPageSearchItems(
    [...state.employees].sort((a, b) => (b.fields["Joining Date"] || "").localeCompare(a.fields["Joining Date"] || "")),
    employeeSearch.data,
    searchActive,
    employee => employee.id,
    match => match.id,
  )
    .slice(0, 6);
  const leaveDistribution = [
    { department: "Approved", count: approvedLeave.length },
    { department: "Pending", count: pendingLeave.length },
    { department: "Rejected", count: visibleLeaves.filter(item => item.status === "REJECTED").length },
    { department: "Cancelled", count: visibleLeaves.filter(item => item.status === "CANCELLED").length },
  ].filter(item => item.count > 0);
  const availableLeaveDays = (balances.data ?? []).filter(balance => balance.eligible && !balance.noBalanceRequired).reduce((sum, balance) => sum + Number(balance.availableDays), 0);
  const latestDocument = canReadPersonalDocuments ? [...state.documents].sort((left, right) => right.generatedOn.localeCompare(left.generatedOn))[0] : undefined;
  const canOpenLeave = canAccessRoute(session, "Leave") && hasPermission(session, "leave.self.create");
  const canOpenMyHr = canAccessRoute(session, "My HR");
  const canOpenDocuments = canAccessRoute(session, "Documents");
  const canOpenAttendance = operationalDashboard && canAccessRoute(session, "Attendance");
  const canOpenEmployees = operationalDashboard && canAccessRoute(session, "Employees");

  return (
    <div className="dashboard-layout" data-dashboard-persona={persona}>
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="section-label">{roleLabel} dashboard</p>
          <h2>{dashboardGreeting()}, {session.displayName || session.email} <span aria-hidden="true">👋</span></h2>
          <p>{roleSubtitle}</p>
        </div>
        <div className="dashboard-snapshot">
          <span>Today’s brief</span>
          <strong>{formatDate(todayISO())}</strong>
          <dl>
            {personalDashboard ? <>
              {canReadLeave && <div><dt>Leave requests</dt><dd>{pendingLeave.length} pending</dd></div>}
              {canReadPersonalDocuments && <div><dt>Documents</dt><dd>{state.documents.length} available</dd></div>}
            </> : <>
              {canOpenApprovalInbox && <div><dt>Approvals</dt><dd>{approvalCount} assigned</dd></div>}
              {broadLeave && <div><dt>Leave today</dt><dd>{onLeaveToday.length} people</dd></div>}
              {canReadAttendanceSummary && <div><dt>Attendance</dt><dd>{attendance.isPending ? "Loading…" : `${attendancePresent} present`}</dd></div>}
            </>}
          </dl>
        </div>
        <div className="hero-actions">
          {canOpenLeave && <button className="primary" onClick={() => setNav("Leave")}><CalendarCheck size={17} /> Apply leave</button>}
          {canOpenMyHr && <button onClick={() => setNav("My HR")}>My profile</button>}
          {managementDashboard && <button onClick={() => setNav("Leave")}>Review leave</button>}
          {canAddEmployee && <button onClick={onAddEmployee}><UserRoundPlus size={17} /> Add employee</button>}
          {operationalDashboard && canOpenPayroll && <button onClick={() => setNav("Payroll")}><WalletCards size={17} /> {canRunPayroll ? "Run payroll" : "View payroll"}</button>}
        </div>
      </section>

      <section className="metric-grid">
        {personalDashboard ? <>
          {canReadPersonalBalances && <Metric label="Leave balance" value={balances.isPending ? "…" : `${availableLeaveDays} days`} hint="across eligible leave types" icon={<CalendarCheck size={17} />} />}
          {canReadLeave && <Metric label="Pending leave" value={pendingLeave.length} hint="personal requests in progress" tone={pendingLeave.length ? "warn" : "ok"} icon={<LayoutDashboard size={17} />} />}
          {canReadPersonalDocuments && <Metric label="Latest document" value={latestDocument ? formatDate(latestDocument.generatedOn) : "—"} hint={latestDocument?.filename || "No documents yet"} icon={<FileText size={17} />} />}
          {canReadPersonalRequests && <Metric label="Certificate requests" value={serviceRequests.data?.meta?.total ?? "—"} hint="salary, experience and clearance" icon={<BriefcaseBusiness size={17} />} />}
        </> : <>
          {canReadScopedEmployees && <Metric label={persona === "line-manager" ? "Team members" : persona === "manager" ? "Department headcount" : "Total employees"} value={active.length} hint={managementDashboard ? "within your current scope" : `${state.employees.length - active.length} inactive records`} icon={<UsersRound size={17} />} />}
          {canOpenApprovalInbox && <Metric label={persona === "coo" ? "Final approvals" : persona === "cpo" ? "Executive approvals" : "Pending actions"} value={approvalInbox.isPending ? "…" : approvalCount} hint="currently assigned to you" tone={approvalCount ? "warn" : "ok"} icon={<ShieldCheck size={17} />} />}
          {broadLeave && <Metric label="On leave today" value={onLeaveToday.length} hint="approved leave within your scope" icon={<CalendarCheck size={17} />} />}
          {operationalDashboard && canReadScopedEmployees && <Metric label="New joiners" value={recentJoiners.length} hint="latest employee records" icon={<UserRoundPlus size={17} />} />}
          {persona === "cpo" && canReadRecruitment && <Metric label="Open positions" value={openPositions} hint="active recruitment vacancies" icon={<BriefcaseBusiness size={17} />} />}
          {persona === "coo" && canReadScopedEmployees && <Metric label="Departments" value={headcount.length} hint="organizational units in scope" icon={<LayoutDashboard size={17} />} />}
          {canReadPayrollDashboard && <Metric label="Payroll runs" value={payrollRuns.isPending ? "…" : currentPayroll.length} hint="for the current month" icon={<WalletCards size={17} />} />}
          {canReadAttendanceSummary && <Metric label="Attendance today" value={attendance.isPending ? "…" : attendancePresent} hint={`${attendanceAbsent} absent · ${attendanceLate} late`} tone={attendanceAbsent ? "warn" : "ok"} icon={<CalendarCheck size={17} />} />}
        </>}
      </section>

      {personalDashboard ? <>
        <div className="dashboard-row dashboard-row--two">
          {canReadPersonalBalances && <section className="panel dashboard-balance-panel"><div className="panel-head"><div><h3>My leave balance</h3><span>Current-year availability by leave type.</span></div><button type="button" onClick={() => setNav("Leave")}>View Leave</button></div>
            {balances.isPending ? <div className="empty">Loading leave balances…</div> : balances.isError ? <div className="empty">Leave balances could not be loaded.</div> : <div className="dashboard-balance-list">{balances.data?.filter(balance => balance.eligible).map(balance => <div key={balance.leaveType.name}><span>{balance.leaveType.name}</span><strong>{balance.noBalanceRequired ? "No balance required" : `${balance.availableDays} days`}</strong><small>{balance.noBalanceRequired ? "Not deducted from annual allowance" : `${balance.usedDays} used · ${balance.pendingDays} pending`}</small></div>)}{!balances.data?.filter(balance => balance.eligible).length && <div className="empty compact">No available leave balances.</div>}</div>}
          </section>}
          {canReadLeave && <div className="dashboard-embedded-panel"><MyLeaveStatusPanel session={session} onOpenLeave={() => setNav("Leave")} /></div>}
        </div>
        <div className="dashboard-row dashboard-row--two">
          {canReadPersonalRequests && <section className="panel"><div className="panel-head"><div><h3>My recent requests</h3><span>Leave and certificate activity that belongs to you.</span></div>{canOpenDocuments && <button type="button" onClick={() => setNav("Documents")}>Request certificate</button>}</div>
            {serviceRequests.isPending ? <div className="empty">Loading requests…</div> : serviceRequests.isError ? <div className="empty">Requests could not be loaded.</div> : <DataTable label="Recent personal requests" empty="No certificate requests yet." columns={["Type", "Requested", "Status"]} rows={(serviceRequests.data?.data ?? []).map(request => [request.requestType.replaceAll("_", " "), formatDate(request.createdAt), <Badge key={request.id} value={request.status} />])} />}
          </section>}
          {canReadAnnouncements && <section className="panel"><div className="panel-head"><div><h3>Announcements</h3><span>Company updates relevant to you.</span></div></div>
            {announcements.isPending ? <div className="empty">Loading announcements…</div> : announcements.isError ? <div className="empty">Announcements could not be loaded.</div> : <div className="dashboard-announcements">{announcements.data?.data.map(item => <article key={item.id}><strong>{item.title}</strong><p>{item.content}</p><small>{formatDate(item.publishedAt || item.createdAt)}</small></article>)}{!announcements.data?.data.length && <div className="empty compact">No current announcements.</div>}</div>}
          </section>}
        </div>
      </> : <>
        {(canReadScopedEmployees || broadLeave) && <div className={`dashboard-row ${canReadScopedEmployees && broadLeave ? "dashboard-row--two" : "dashboard-row--single"}`}>
          {canReadScopedEmployees && <section className="panel headcount-panel"><div className="panel-head"><div><h3>{managementDashboard ? "People in your scope" : persona === "coo" ? "Organization snapshot" : "Workforce distribution"}</h3><span>{active.length} active employees</span></div></div>{headcount.length ? <HeadcountDonut items={headcount} label={managementDashboard ? "in scope" : "active"} noun="employees" /> : <div className="empty">No employee distribution is available.</div>}</section>}
          {broadLeave && <section className="panel"><div className="panel-head"><div><h3>{managementDashboard ? "Team availability" : persona === "coo" ? "Executive leave summary" : "Leave overview"}</h3><span>{upcomingLeave.length} approved record(s)</span></div></div>
            <DataTable label="Approved leave availability" empty="No current or upcoming approved leave." columns={["Employee", "Leave type", "Dates", "Days"]} rows={upcomingLeave.slice(0, 6).map(leave => [`${leave.employee.firstName} ${leave.employee.lastName}`, leave.leaveType.name, `${formatDate(leave.startDate)} – ${formatDate(leave.endDate)}`, leave.totalDays])} />
          </section>}
        </div>}
        {(operationalDashboard || executiveDashboard) && (broadLeave || canReadAttendanceSummary) && <div className={`dashboard-row ${broadLeave && canReadAttendanceSummary ? "dashboard-row--two" : "dashboard-row--single"}`}>
          {broadLeave && <section className="panel"><div className="panel-head"><div><h3>Leave distribution</h3><span>Requests visible within your current scope.</span></div></div>{leaveDistribution.length ? <HeadcountDonut items={leaveDistribution} label="requests" noun="records" /> : <div className="empty">No leave requests are available.</div>}</section>}
          {canReadAttendanceSummary && <section className="panel dashboard-attendance-panel"><div className="panel-head"><div><h3>Attendance overview</h3><span>High-level organization summary only.</span></div>{canOpenAttendance && <button type="button" onClick={() => setNav("Attendance")}>View attendance</button>}</div>
            {attendance.isPending ? <div className="empty">Loading attendance…</div> : attendance.isError ? <div className="empty">Attendance could not be loaded.</div> : <div className="dashboard-attendance-summary"><div><span>Present</span><strong>{attendancePresent}</strong></div><div><span>Absent</span><strong>{attendanceAbsent}</strong></div><div><span>Late</span><strong>{attendanceLate}</strong></div></div>}
          </section>}
        </div>}
        {operationalDashboard && (canReadScopedEmployees || broadLeave || canReadPayrollDashboard) && <div className="dashboard-row dashboard-row--two">
          {canReadScopedEmployees && <section className="panel"><div className="panel-head"><div><h3>Recent joiners</h3><span>Latest employee records.</span></div>{canOpenEmployees && <button type="button" onClick={() => setNav("Employees")}>View employees</button>}</div>
            <DataTable label="Recent joiners" empty="No employees yet." columns={["Name", "Designation", "Joined", "Status"]} rows={recentJoiners.map(employee => [<strong key="name">{employeeName(employee)}</strong>, employee.fields.Designation || "-", formatDate(employee.fields["Joining Date"]), <Badge key="status" value={employee.status} />])} />
          </section>}
          {(broadLeave || canReadPayrollDashboard) && <section className="panel"><div className="panel-head"><div><h3>Operational focus</h3><span>Real-time priorities from the existing workspace.</span></div></div><div className="dashboard-focus-list">{broadLeave && <><div><span>Approved leave today</span><strong>{onLeaveToday.length}</strong></div><div><span>Pending requests</span><strong>{pendingLeave.length}</strong></div></>}{canReadPayrollDashboard && <div><span>Current-month payroll runs</span><strong>{currentPayroll.length}</strong></div>}</div></section>}
        </div>}
        {canOpenApprovalInbox && <div className="dashboard-row dashboard-row--single"><ApprovalInboxPanel session={session} notify={notify} /></div>}
      </>}
    </div>
  );
}

function Metric({ label, value, hint, tone, icon }: { label: string; value: React.ReactNode; hint: string; tone?: "warn" | "ok"; icon?: React.ReactNode }) {
  return <div className={`metric ${tone || ""}`}>{icon && <span className="metric-icon" aria-hidden="true">{icon}</span>}<span>{label}</span><strong>{value}</strong><p>{hint}</p></div>;
}

function EmployeeAvatar({ employee, small = false }: { employee: EmployeeRecord; small?: boolean }) {
  return <span className={`avatar${small ? " small" : ""}`}>{employee.photo ? <img src={employee.photo} alt="" /> : initials(employee)}</span>;
}

function pageDescription(nav: NavItem) {
  const descriptions: Record<NavItem, string> = {
    Dashboard: "Attendance, leave, payroll and employee totals.",
    "My HR": "Your personal details, leave application, certificates and payslips.",
    Team: "Direct reports and managed department work.",
    Employees: "Employee records.",
    Attendance: "Daily attendance and monthly totals.",
    Leave: "Leave requests and balances.",
    Loans: "Employee loans and payroll deductions.",
    Payroll: "Payslips and payroll exports.",
    Recruitment: "Job openings and candidates.",
    EOS: "End-of-service calculations and records.",
    Documents: "HR letters and PDFs.",
    Reports: "Employee, attendance, leave and payroll reports.",
    Audit: "Security and business activity history.",
    Hierarchy: "Employee reporting lines, approval paths and role access.",
    System: "Users, access roles, permissions and sessions.",
    Settings: "Signed-in devices and company settings."
  };
  return descriptions[nav];
}

function Employees({ state, setState, setModal, notify, close, savePdf, canCreate, canUpdate, canTerminate, canImport, canExport, canViewSalary, session, refreshWorkspace }: CommonProps & { canCreate: boolean; canUpdate: boolean; canTerminate: boolean; canImport: boolean; canExport: boolean; canViewSalary: boolean; session: BackendSession | null | undefined; refreshWorkspace: () => Promise<void> }) {
  const { active: searchActive } = usePageSearch();
  const searchResults = usePageSearchList<{ id: string }>("employees", "/employees");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const activeCount = state.employees.filter(employee => employee.status === "Active").length;
  const onLeaveCount = state.employees.filter(employee => employee.status === "On Leave").length;
  const departmentCount = new Set(state.employees.map(employee => employee.fields.Department).filter(Boolean)).size;
  const employees = useMemo(() => rankedPageSearchItems(
    state.employees.filter(employee => (!department || employee.fields.Department === department) && (!status || employee.status === status))
      .sort((a, b) => a.fields["Employee Code"].localeCompare(b.fields["Employee Code"])),
    searchResults.data,
    searchActive,
    employee => employee.id,
    match => match.id,
  ), [state.employees, searchActive, searchResults.data, department, status]);
  const totalPages = Math.max(1, Math.ceil(employees.length / 20));
  const pageEmployees = employees.slice((page - 1) * 20, page * 20);

  useEffect(() => { setPage(1); }, [department, status, searchActive, searchResults.data]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  function edit(employee?: EmployeeRecord) {
    setModal(<EmployeeEditor state={state} employee={employee} close={close} notify={notify} save={next => setState(prev => upsertEmployee(prev, next))} />);
  }

  async function remove(employee: EmployeeRecord) {
    const confirmed = window.confirm(`Delete ${employeeName(employee)}? This also removes linked attendance, leave, payroll, expenses, trips, EOS records and generated documents.`);
    if (!confirmed) return;
    if (!session) {
      notify("Your session has ended. Sign in again.");
      return;
    }
    try {
      await apiRequest(`/employees/${employee.id}`, { method: "DELETE", csrfToken: session.csrfToken });
      await refreshWorkspace();
      notify("Employee deleted.");
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  return (
    <section className="stack employee-workspace">
      <div className="employee-hero panel">
        <div>
          <p className="section-label">Employees</p>
          <h3>Employee Directory</h3>
          <span>{employees.length} matched / {state.employees.length} total records</span>
        </div>
        <div className="employee-hero-actions">
          {canExport && <button onClick={() => void withPdf(pdf => savePdf(pdf.saveReportPdf("employee_directory", state, new Date().getFullYear(), new Date().getMonth() + 1), "employee_directory"))}><Download size={16} /> Directory PDF</button>}
          {canImport && <><button onClick={downloadEmployeeTemplate}><Download size={16} /> Excel template</button>
          <label className="button-like"><Upload size={16} /> Import employees<input type="file" accept=".xlsx,.xlsm,.xltx,.xltm,.xls,.html,.csv,.tsv,text/html,text/csv" onChange={async event => { const file = event.target.files?.[0]; event.currentTarget.value = ""; await importEmployees(file); }} /></label>
          </>}
          {canCreate && <button className="primary" onClick={() => edit()}><UserRoundPlus size={16} /> Add employee</button>}
        </div>
      </div>
      <div className="employee-stats">
        <Metric label="Active" value={activeCount} hint="working employees" tone="ok" />
        <Metric label="On leave" value={onLeaveCount} hint="currently away" tone={onLeaveCount ? "warn" : undefined} />
        <Metric label="Departments" value={departmentCount} hint="operational groups" />
      </div>
      <div className="panel employee-directory-panel">
        <div className="filters employee-filters">
          <PageSearchBar page="Employees" />
          <select aria-label="Filter employees by department" value={department} onChange={event => setDepartment(event.target.value)}><option value="">All departments</option>{state.settings.departments.map(item => <option key={item}>{item}</option>)}</select>
          <select aria-label="Filter employees by status" value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option>{statusOptions.map(item => <option key={item}>{item}</option>)}</select>
        </div>
        {employees.length ? (
          <div className="employee-card-grid">
            {pageEmployees.map(employee => {
              const salary = employeeSalary(employee);
              return (
                <article className="employee-card" key={employee.id}>
                  <button className="employee-card-main" onClick={() => setModal(<EmployeeProfile employee={employee} state={state} close={close} edit={canUpdate ? () => edit(employee) : undefined} savePdf={savePdf} canExport={canExport} canViewSalary={canViewSalary} />)}>
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
                    <span><b>Phone</b>{employee.fields["Personal Mobile No."] || employee.fields["Office Mobile No."] || "-"}</span>
                    <span><b>Login email</b>{employee.fields["E-Mail ID (Work)"] || "-"}</span>
                    <span><b>Joined</b>{formatDate(employee.fields["Joining Date"])}</span>
                    {canViewSalary && <span><b>Total pay</b>{formatMoney(salary.total, state.settings.company.currency)}</span>}
                  </div>
                  <div className="row-actions">
                    <button className="primary" onClick={() => setModal(<EmployeeProfile employee={employee} state={state} close={close} edit={canUpdate ? () => edit(employee) : undefined} savePdf={savePdf} canExport={canExport} canViewSalary={canViewSalary} />)}>Open profile</button>
                    {(canUpdate || canExport || canTerminate) && <details className="card-actions-menu">
                      <summary>More actions</summary>
                      <div className="card-actions-menu__items">
                        {canUpdate && <button onClick={() => edit(employee)}>Edit employee</button>}
                        {canExport && <button onClick={() => void withPdf(pdf => savePdf(pdf.saveEmployeeProfilePdf(employee, state.settings), "employee_profile", employee.id))}>Download PDF</button>}
                        {canTerminate && <button className="danger-outline" onClick={() => void remove(employee)}><Trash2 size={15} /> Delete employee</button>}
                      </div>
                    </details>}
                  </div>
                </article>
              );
            })}
          </div>
        ) : <div className="empty">No employees match the filters.</div>}
        {employees.length > 20 && <div className="audit-pagination">
          <span className="muted" aria-live="polite">Page {page} of {totalPages} · 20 employees per page</span>
          <div className="inline-controls">
            <button disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Previous</button>
            <button disabled={page >= totalPages} onClick={() => setPage(current => current + 1)}>Next</button>
          </div>
        </div>}
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
      const { applyEmployeeRows, parseEmployeeSheet, parseEmployeeWorkbook } = await importWithReleaseRetry("employee-sheet", () => import("./employeeSheet"));
      if (file.size > 10_000_000) throw new Error("Employee imports are limited to 10 MB.");
      const spreadsheet = /\.(xlsx|xlsm|xltx|xltm)$/i.test(file.name);
      const parsed = spreadsheet
        ? await parseEmployeeWorkbook(file)
        : { rows: parseEmployeeSheet(await file.text()), skipped: 0, errors: [], format: "generic" as const };

      if (parsed.rows.length > 5_000) throw new Error("Employee imports are limited to 5,000 rows at a time.");

      if (!parsed.rows.length) {
        notify(parsed.skipped ? `No employees were imported. ${parsed.skipped} row${parsed.skipped === 1 ? "" : "s"} need a unique Employee Code.` : "No employee rows were found in this file.");
        return;
      }

      if (parsed.format === "master-data") {
        setModal(<EmployeeMasterDataImportPreview rows={parsed.rows} errors={parsed.errors} existingEmployeeCodes={state.employees.map(employee => employee.fields["Employee Code"])} session={session} close={close} notify={notify} refreshWorkspace={refreshWorkspace} />);
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

function ProfilePhotoPanel({ employee, session, notify, refreshWorkspace }: { employee?: EmployeeRecord; session: BackendSession; notify: (message: string) => void; refreshWorkspace: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const canUpdate = hasPermission(session, "employee.self.update_basic");

  async function save(profilePhoto: string) {
    setSaving(true);
    try {
      await apiRequest("/employees/me/basic", { method: "PATCH", csrfToken: session.csrfToken, body: JSON.stringify({ profilePhoto }) });
      await refreshWorkspace();
      notify(profilePhoto ? "Profile photo updated." : "Profile photo removed.");
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function upload(file?: File) {
    if (!file) return;
    try {
      await save(await preparePhoto(file));
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  return <section className="panel account-photo-panel"><div className="panel-head"><div><h3>Profile photo</h3><span>Shown only as your account avatar.</span></div></div>
    {!employee ? <p className="muted">Link an employee record to this account to add a profile photo.</p> : <div className="account-photo-row">
      <span className="account-photo-preview">{employee.photo ? <img src={employee.photo} alt="Your profile" /> : accountInitials(session.email)}</span>
      <div className="account-photo-actions">
        {canUpdate && <label className="button-like"><ImagePlus size={16} /> {employee.photo ? "Replace photo" : "Upload photo"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={saving} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} /></label>}
        {canUpdate && employee.photo && <button type="button" disabled={saving} onClick={() => void save("")}> <Trash2 size={16} /> Remove photo</button>}
        {!canUpdate && <p className="muted">You do not have permission to change this photo.</p>}
        <p className="muted">JPEG, PNG or WebP; up to 8 MB.</p>
      </div>
    </div>}
  </section>;
}

function EmployeeMasterDataImportPreview({ rows, errors, existingEmployeeCodes, session, close, notify, refreshWorkspace }: {
  rows: Array<Record<string, string>>;
  errors: string[];
  existingEmployeeCodes: string[];
  session: BackendSession | null | undefined;
  close: () => void;
  notify: (message: string) => void;
  refreshWorkspace: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const existing = useMemo(() => new Set(existingEmployeeCodes.map(code => code.toLocaleLowerCase())), [existingEmployeeCodes]);
  const updates = rows.filter(row => existing.has((row["Employee Code"] || "").toLocaleLowerCase())).length;
  const adjustments = rows.filter(row => Number(row["Gross Adjustment"] || 0) !== 0).length;
  const departments = new Set(rows.map(row => row.Department).filter(Boolean)).size;
  const positions = new Set(rows.map(row => `${row.Department}:${row.Designation}`).filter(value => value !== ":")).size;

  async function confirm() {
    if (!session || errors.length) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const result = await apiRequest<{ created: number; updated: number; relationshipUpdates: number; departments: number; positions: number }>("/employees/import-master-data", {
        method: "POST", csrfToken: session.csrfToken, body: JSON.stringify({ rows: rows.map(masterDataImportRow) })
      });
      await refreshWorkspace();
      close();
      notify(`Employee import complete: ${result.created} added, ${result.updated} updated.`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Employee import failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="import-preview">
    <div className="panel-head"><div><p className="section-label">Employee master data</p><h3>Review import</h3></div></div>
    <p>{rows.length} valid employee rows: {rows.length - updates} new and {updates} existing records to update.</p>
    <div className="profile-field-grid">
      <div><span>Departments</span><strong>{departments}</strong></div><div><span>Positions</span><strong>{positions}</strong></div><div><span>Gross adjustments</span><strong>{adjustments}</strong></div>
    </div>
    {errors.length > 0 && <div className="form-error"><strong>Fix these rows before importing:</strong><ul>{errors.slice(0, 12).map(error => <li key={error}>{error}</li>)}</ul>{errors.length > 12 && <p>{errors.length - 12} more issue(s).</p>}</div>}
    {submitError && <p className="form-error">{submitError}</p>}
    <div className="table-wrap table-wide" role="region" aria-label="Employee import preview"><table><thead><tr><th>Employee Code</th><th>Employee</th><th>Department</th><th>Designation</th><th>Gross salary</th></tr></thead><tbody>{rows.slice(0, 12).map(row => <tr key={row["Employee Code"]}><td data-label="Employee Code">{row["Employee Code"]}</td><td data-label="Employee">{row["Full Name"]}</td><td data-label="Department">{row.Department}</td><td data-label="Designation">{row.Designation}</td><td data-label="Gross salary">{row.Total}</td></tr>)}</tbody></table>{rows.length > 12 && <p className="muted">Showing the first 12 records.</p>}</div>
    <div className="modal-actions"><button type="button" onClick={close} disabled={submitting}>Cancel</button><button className="primary" type="button" onClick={() => void confirm()} disabled={submitting || errors.length > 0 || !session}>{submitting ? "Importing…" : "Confirm import"}</button></div>
  </div>;
}

function masterDataImportRow(row: Record<string, string>) {
  return {
    employeeCode: row["Employee Code"], fullName: row["Full Name"], company: row.Company, wpsSponsor: row["WPS Sponsor"], designation: row.Designation,
    department: row.Department, joiningDate: row["Joining Date"], dateOfBirth: row["Date of Birth"] || undefined, gender: row.Gender, basic: row.Basic, hra: row.HRA,
    conveyance: row["Conveyance Allowance"], mobile: row["Mobile Allowance"], food: row["Food Allowance"], fuel: row["Fuel Allowance"], other: row["Other Allowance"],
    grossSalary: row.Total, lineManager: row["Line Manager Employee Code/Name"] || undefined, manager: row["Manager Employee Code/Name"] || undefined,
    companyConveyance: row["Company Conveyance"] === "Yes", companyFuel: row["Company Fuel"] === "Yes", companyOther: row["Company Other"] === "Yes"
  };
}

function EmployeeEditor({ state, employee, template, save, close, notify }: {
  state: HrState;
  employee?: EmployeeRecord;
  template?: EmployeeRecord;
  save: (employee: EmployeeRecord) => void;
  close: () => void;
  notify: (message: string) => void;
}) {
  const [draft, setDraft] = useState<EmployeeRecord>(() => structuredClone(employee ?? template ?? createEmptyEmployee(nextEmployeeCode(state.employees))));
  const setField = (field: string, value: string) => setDraft(prev => ({
    ...prev,
    fields: {
      ...prev.fields,
      [field]: value,
      ...(field === "Full Name"
        ? { "First Name": splitEmployeeName(value).firstName, "Last Name": splitEmployeeName(value).lastName }
        : {})
    }
  }));

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
    const email = draft.fields["E-Mail ID (Work)"].trim();
    if (!draft.fields["Employee Code"].trim() || !draft.fields["Full Name"].trim() || !/^\S+@\S+\.\S+$/.test(email)) {
      notify("Employee code, full name, and a valid work email are required.");
      return;
    }
    save({ ...draft, fields: { ...draft.fields, "E-Mail ID (Work)": email } });
    notify(employee ? "Employee updated." : "Employee added.");
    close();
  }

  return (
    <div className="employee-editor">
      <div className="employee-modal-body">
        <h2>{employee ? "Edit employee" : "Add employee"}</h2>
        <p className="muted">Complete the employee details below.</p>
        <div className="employee-photo-editor">
          <EmployeeAvatar employee={draft} />
          <div>
            <strong>Employee photo</strong>
            <p>Saved with this employee record.</p>
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
                {section.fields.map(field => {
                  const options = field === "Department" ? state.settings.departments : employeeFieldOptions[field];
                  const values = options && Array.from(new Set([...options, draft.fields[field] || ""])).filter(Boolean);
                  return <label key={field}>{field}
                    {values
                      ? <select aria-label={field} value={draft.fields[field] || ""} onChange={event => setField(field, event.target.value)}><option value="" />{values.map(item => <option key={item}>{item}</option>)}</select>
                      : <input aria-label={field} type={fieldType(field)} value={draft.fields[field] || ""} onChange={event => setField(field, event.target.value)} />}
                  </label>;
                })}
              </div>
            </details>
          ))}
        </div>
      </div>
      <div className="modal-actions employee-modal-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={submit}>Save employee</button></div>
    </div>
  );
}

function EmployeeProfile({ employee, state, edit, close, savePdf, canExport, canViewSalary }: { employee: EmployeeRecord; state: HrState; edit?: () => void; close: () => void; savePdf: (file: GeneratedPdf | undefined, template: PdfTemplate, employeeId?: string) => void; canExport: boolean; canViewSalary: boolean }) {
  const salary = employeeSalary(employee);
  return (
    <div className="employee-profile">
      <div className="employee-modal-body">
        <div className="profile-head">
          <EmployeeAvatar employee={employee} />
          <div><h2>{employeeName(employee)}</h2><p>{employee.fields.Designation} - {employee.fields.Department}</p></div>
          <Badge value={employee.status} />
        </div>
        <section className="profile-grid">
          {["Employee Code", "Joining Date", "Line Manager Employee Code/Name", "Manager Employee Code/Name", "E-Mail ID (Work)", "Personal Mobile No.", "Nationality", "QID Expiry Date", "Bank Code", "IBAN No."].map(field => (
            <div key={field}><span>{field}</span><strong>{field.includes("Date") || field.includes("Expiry") ? formatDate(employee.fields[field]) : employee.fields[field] || "-"}</strong></div>
          ))}
          {canViewSalary && <div><span>Monthly Total</span><strong>{formatMoney(salary.total, state.settings.company.currency)}</strong></div>}
        </section>
        <div className="profile-sections">
          {employeeProfileSections.filter(section => canViewSalary || section.title !== "Bank & Salary").map(section => (
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
      </div>
      <div className="modal-actions employee-modal-actions">
        {canExport && <button onClick={() => void withPdf(pdf => savePdf(pdf.saveEmployeeProfilePdf(employee, state.settings), "employee_profile", employee.id))}>Profile PDF</button>}
        {edit && <button onClick={edit}>Edit</button>}
        <button className="primary" onClick={close}>Done</button>
      </div>
    </div>
  );
}

function Attendance({ state, setState, savePdf, notify, canManage, canExport }: { state: HrState; setState: React.Dispatch<React.SetStateAction<HrState>>; savePdf: (file: GeneratedPdf | undefined, template: PdfTemplate, employeeId?: string) => void; notify: (message: string) => void; canManage: boolean; canExport: boolean }) {
  const authorization = useAuthorization();
  const now = new Date();
  const [date, setDate] = useState(todayISO);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const { active: searchActive } = usePageSearch();
  const canSearchEmployees = authorization.hasAnyPermission("employee.self.read", "employee.team.read", "employee.management.read", "employee.hr.read", "employee.read_all");
  const attendanceSearch = usePageSearchList<{ employeeId: string }>("attendance-records", `/attendance?dateFrom=${date}&dateTo=${date}`, true, false);
  const employeeSearch = usePageSearchList<{ id: string }>("attendance-employees", "/employees", canSearchEmployees, false);
  const searchReady = attendanceSearch.data !== undefined && (!canSearchEmployees || employeeSearch.data !== undefined);
  const rankedEmployeeIds = useMemo(() => [...new Set([
    ...(attendanceSearch.data ?? []).map(record => record.employeeId),
    ...(employeeSearch.data ?? []).map(employee => employee.id),
  ])], [attendanceSearch.data, employeeSearch.data]);
  usePageSearchStatus("attendance", {
    count: searchReady ? rankedEmployeeIds.length : undefined,
    loading: attendanceSearch.isFetching || employeeSearch.isFetching,
    error: attendanceSearch.error?.message || employeeSearch.error?.message,
  });
  const active = activeEmployees(state.employees).sort((a, b) => a.fields["Employee Code"].localeCompare(b.fields["Employee Code"]));
  const day = state.attendance[date] || {};
  const stats = attendanceStats(state.employees, state.attendance, year, month);
  const statusLabels: Record<AttendanceCode, string> = { P: "Present", H: "Half-day", L: "Leave", A: "Absent" };
  const daySummary = attendanceDaySummary(state.employees, day);
  const departments = Array.from(new Set(active.map(employee => employee.fields.Department || "Unassigned"))).sort();
  const visibleEmployees = rankedPageSearchItems(active.filter(employee => {
    const code = day[employee.id];
    const label = code ? statusLabels[code] : "Unmarked";
    return (!department || (employee.fields.Department || "Unassigned") === department) &&
      (!status || label === status);
  }), searchReady ? rankedEmployeeIds : undefined, searchActive, employee => employee.id, id => id);
  const payrollImpact = active.reduce((sum, employee) => {
    const code = day[employee.id];
    return sum + (employeeSalary(employee).total / 30) * (code === "A" ? 1 : code === "H" ? 0.5 : 0);
  }, 0);
  const grouped = departments
    .map(name => {
      const departmentEmployees = active.filter(employee => (employee.fields.Department || "Unassigned") === name);
      return {
        name,
        employees: visibleEmployees.filter(employee => (employee.fields.Department || "Unassigned") === name),
        summary: attendanceDaySummary(departmentEmployees, day)
      };
    })
    .filter(group => group.employees.length);

  async function downloadAttendanceTemplate() {
    const { attendanceTemplateHtml } = await importWithReleaseRetry("attendance-sheet", () => import("./attendanceSheet"));
    downloadBlob(new Blob([attendanceTemplateHtml()], { type: "application/vnd.ms-excel;charset=utf-8" }), `MedTech-Attendance-Import-Template-${todayISO()}.xls`);
  }

  async function importAttendance(file?: File) {
    if (!file) return;
    try {
      const { applyAttendanceRows, parseAttendanceSheet, parseAttendanceWorkbook } = await importWithReleaseRetry("attendance-sheet", () => import("./attendanceSheet"));
      if (file.size > 10_000_000) throw new Error("Attendance imports are limited to 10 MB.");
      const rows = /\.xls$/i.test(file.name) ? await parseAttendanceWorkbook(file) : parseAttendanceSheet(await file.text());
      if (rows.length > 50_000) throw new Error("Attendance imports are limited to 50,000 rows at a time.");
      const result = applyAttendanceRows(state, rows);
      if (!result.imported) {
        notify(`No attendance rows imported${result.skipped ? `; ${result.skipped} invalid row(s) were skipped` : ""}.`);
        return;
      }
      setState(result.state);
      if (result.latestDate) setDate(result.latestDate);
      notify(`Attendance import complete: ${result.imported} row(s) across ${result.dates} date(s)${result.skipped ? `; ${result.skipped} skipped` : ""}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Attendance import failed. Use the downloaded template or a CSV exported from Excel.");
    }
  }

  return (
    <section className="stack attendance-workspace">
      <div className="panel attendance-control">
        <div className="attendance-hero">
          <div>
            <h3>Daily Attendance</h3>
            <p>Mark each employee or import a completed attendance sheet.</p>
          </div>
          {canManage && <div className="inline-controls">
            <button onClick={() => void downloadAttendanceTemplate().catch(error => notify(errorMessage(error)))}><Download size={16} /> Template</button>
            <label className="button-like"><Upload size={16} /> Import attendance<input type="file" accept=".xls,.html,.csv,.tsv,application/vnd.ms-excel,text/html,text/csv" onChange={event => { void importAttendance(event.target.files?.[0]); event.target.value = ""; }} /></label>
            <button onClick={() => setState(prev => markAllAttendance(prev, date, "P"))}>Mark all present</button>
            <button onClick={() => setState(prev => clearAttendanceDay(prev, date))}>Clear day</button>
          </div>}
        </div>

        <div className="attendance-metrics">
          <AttendanceMetric label="Present" value={daySummary.P} tone="present" />
          <AttendanceMetric label="Half-day" value={daySummary.H} tone="half" />
          <AttendanceMetric label="Leave" value={daySummary.L} tone="leave" />
          <AttendanceMetric label="Absent" value={daySummary.A} tone="absent" />
          {canManage && <AttendanceMetric label="Day LOP estimate" value={formatMoney(payrollImpact, state.settings.company.currency)} tone="payroll" />}
        </div>

        <div className="attendance-toolbar department-style">
          <input id="attendance-date" name="attendance-date" aria-label="Attendance date" type="date" value={date} onChange={event => setDate(event.target.value)} />
          <select value={department} onChange={event => setDepartment(event.target.value)} aria-label="Department filter"><option value="">All departments</option>{departments.map(item => <option key={item}>{item}</option>)}</select>
          <select value={status} onChange={event => setStatus(event.target.value)} aria-label="Status filter"><option value="">All statuses</option>{["Present", "Half-day", "Leave", "Absent", "Unmarked"].map(item => <option key={item}>{item}</option>)}</select>
        </div>

        <div className="attendance-board">
          {grouped.map(group => {
            return (
              <section className="attendance-dept-group" key={group.name}>
                <div className="attendance-dept-head">
                  <div><UsersRound size={16} /><h3>{group.name}</h3></div>
                  <span>{group.summary.P} present · {group.summary.A} absent · {group.summary.unmarked} unmarked</span>
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
                        <span data-label="Date">{formatDate(date)}</span>
                        <strong data-label="Punch in">{punch.in}</strong>
                        <strong data-label="Punch out">{punch.out}</strong>
                        <strong data-label="Hours">{punch.hours}</strong>
                        <span className="attendance-status-cell" data-label="Status"><Badge value={punch.status} /></span>
                        <span className="attendance-status-cell" data-label="Approval"><Badge value={approval || (needsReview ? "Pending" : code ? "Approved" : "Not marked")} /></span>
                        {canManage ? <div className="att-btns" data-label="Action">{(["P", "H", "L", "A"] as AttendanceCode[]).map(item => <button key={item} aria-label={`${statusLabels[item]} - ${employeeName(employee)}`} className={`att-btn ${code === item ? `on-${item}` : ""}`} onClick={() => setState(prev => setAttendance(prev, date, employee.id, item))}>{item}</button>)}</div> : <span data-label="Action">-</span>}
                      </div>
                      {canManage && needsReview && (
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
        <p className="attendance-foot">Marked: <strong>{daySummary.marked}</strong>/{daySummary.total} · Present {daySummary.P} · Half-day {daySummary.H} · Leave {daySummary.L} · Absent {daySummary.A} · Unmarked {daySummary.unmarked}{canManage ? ` · Day LOP estimate ${formatMoney(payrollImpact, state.settings.company.currency)}` : ""}</p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div><h3>Monthly Summary</h3><span>Counts for {months[month - 1]} {year}</span></div>
          <div className="inline-controls">
          <select id="attendance-month" name="attendance-month" aria-label="Attendance report month" value={month} onChange={event => setMonth(Number(event.target.value))}>{months.map((item, index) => <option value={index + 1} key={item}>{item}</option>)}</select>
          <input id="attendance-year" name="attendance-year" aria-label="Attendance report year" type="number" value={year} onChange={event => setYear(Number(event.target.value))} />
            {canExport && <button onClick={() => void withPdf(pdf => savePdf(pdf.saveReportPdf("attendance_report", state, year, month), "attendance_report"))}>PDF</button>}
          </div>
        </div>
        <DataTable label="Monthly attendance report" columns={["Code", "Employee", "Present", "Half-day", "Leave", "Absent", "%"]} rows={stats.map(row => [row.employee.fields["Employee Code"], employeeName(row.employee), row.P, row.H, row.L, row.A, `${row.pct}%`])} />
      </div>
    </section>
  );
}

function attendancePunch(employee: EmployeeRecord, code: AttendanceCode | undefined, workdayHours: number, halfDayHours: number) {
  void employee;
  if (!code) return { in: "-", out: "-", hours: "-", status: "Unmarked", note: "Not recorded." };
  if (code === "L") return { in: "Leave", out: "-", hours: "0.00", status: "Leave", note: "Approved leave day." };
  if (code === "A") return { in: "-", out: "-", hours: "0.00", status: "Absent", note: "Recorded as absent." };
  if (code === "H") return { in: "-", out: "-", hours: halfDayHours.toFixed(2), status: "Half-day", note: "Recorded as half-day." };
  return { in: "-", out: "-", hours: workdayHours.toFixed(2), status: "Present", note: "Recorded as present." };
}

function AttendanceMetric({ label, value, tone }: { label: string; value: React.ReactNode; tone: "present" | "half" | "leave" | "absent" | "payroll" }) {
  return <div className={`attendance-metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function BusinessTrips({ state, setState, notify }: { state: HrState; setState: React.Dispatch<React.SetStateAction<HrState>>; notify: (message: string) => void }) {
  const authorization = useAuthorization();
  const canCreate = authorization.hasAnyPermission("trip.self.create", "trip.hr.manage");
  const canReview = authorization.hasAnyPermission("trip.team.approve_manager", "trip.department.approve_manager", "trip.hr.manage");
  const canClose = authorization.hasPermission("trip.hr.manage");
  const employees = activeEmployees(state.employees);
  const eligibleEmployees = authorization.hasPermission("trip.hr.manage")
    ? employees
    : employees.filter(employee => employee.id === authorization.scopes.employeeId);
  const [employeeId, setEmployeeId] = useState(eligibleEmployees[0]?.id || "");
  const [destination, setDestination] = useState("");
  const [purpose, setPurpose] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [perDiem, setPerDiem] = useState("250");
  const [travelCost, setTravelCost] = useState("0");
  const [advanceAmount, setAdvanceAmount] = useState("0");
  const days = from && to && to >= from ? inclusiveDays(from, to) : 0;

  useEffect(() => {
    if (!eligibleEmployees.some(employee => employee.id === employeeId)) setEmployeeId(eligibleEmployees[0]?.id || "");
  }, [eligibleEmployees, employeeId]);

  function updateTrip(id: string, patch: Partial<BusinessTrip>) {
    setState(prev => ({ ...prev, businessTrips: prev.businessTrips.map(item => item.id === id ? { ...item, ...patch } : item) }));
  }

  function submit() {
    if (!employeeId || !destination.trim() || !purpose.trim() || !days) return notify("Employee, destination, purpose and valid dates are required.");
    setState(prev => ({
      ...prev,
      businessTrips: [...prev.businessTrips, {
        id: newId(),
        version: 1,
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
    {canCreate && <div className="panel">
      <div className="panel-head"><div><h3>Business Trips</h3><span>Requests, costs and advances.</span></div></div>
      <div className="form-grid compact">
        <label>Employee<EmployeePicker id="trip-employee" name="trip-employee" value={employeeId} onChange={setEmployeeId} options={employeePickerOptions(eligibleEmployees)} /></label>
        <label>Destination<input id="trip-destination" name="trip-destination" value={destination} onChange={event => setDestination(event.target.value)} placeholder="Doha, Riyadh, Dubai..." /></label>
        <label>From<input id="trip-from" name="trip-from" type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
        <label>To<input id="trip-to" name="trip-to" type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
        <label>Per diem<input id="trip-per-diem" name="trip-per-diem" type="number" min="0" value={perDiem} onChange={event => setPerDiem(event.target.value)} /></label>
        <label>Travel cost<input id="trip-travel-cost" name="trip-travel-cost" type="number" min="0" value={travelCost} onChange={event => setTravelCost(event.target.value)} /></label>
        <label>Advance paid<input id="trip-advance" name="trip-advance" type="number" min="0" value={advanceAmount} onChange={event => setAdvanceAmount(event.target.value)} /></label>
        <label className="wide" htmlFor="trip-purpose">Purpose<textarea id="trip-purpose" name="trip-purpose" value={purpose} onChange={event => setPurpose(event.target.value)} /></label>
      </div>
      <p className="muted">Duration: {days || "-"} day(s). Estimated trip cost: {formatMoney(tripTotal({ days, perDiem: Number(perDiem) || 0, travelCost: Number(travelCost) || 0 }), state.settings.company.currency)}.</p>
      <div className="form-actions"><button className="primary" onClick={submit}>Add trip request</button></div>
    </div>}
    <div className="panel">
      <div className="panel-head"><h3>Trip Register</h3><span>{state.businessTrips.length} records</span></div>
      <DataTable label="Business trips" empty="No business trips yet." columns={["Employee", "Destination", "Dates", "Days", "Cost", "Advance", "Status", "Actions"]} rows={state.businessTrips.map(trip => {
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
            {canReview && trip.status === "Pending" && <><button onClick={() => updateTrip(trip.id, { status: "Approved" })}>Approve</button><button onClick={() => updateTrip(trip.id, { status: "Rejected" })}>Reject</button></>}
            {canClose && trip.status === "Approved" && <button onClick={() => updateTrip(trip.id, { status: "Closed" })}>Close</button>}
            {(authorization.hasPermission("trip.hr.manage") || (authorization.hasPermission("trip.self.create") && trip.employeeId === authorization.scopes.employeeId)) && trip.status === "Pending" && <button onClick={() => confirmDelete(`trip to ${trip.destination}`) && setState(prev => ({ ...prev, businessTrips: prev.businessTrips.filter(item => item.id !== trip.id) }))}>Delete</button>}
          </div>
        ];
      })} />
    </div>
  </section>;
}

function Expenses({ state, setState, notify }: { state: HrState; setState: React.Dispatch<React.SetStateAction<HrState>>; notify: (message: string) => void }) {
  const authorization = useAuthorization();
  const canCreate = authorization.hasPermission("expense.self.create");
  const canReview = authorization.hasAnyPermission("expense.team.approve_manager", "expense.department.approve_manager", "expense.hr.approve");
  const canPay = authorization.hasPermission("expense.hr.approve");
  const employees = activeEmployees(state.employees);
  const eligibleEmployees = employees.filter(employee => employee.id === authorization.scopes.employeeId);
  const [employeeId, setEmployeeId] = useState(eligibleEmployees[0]?.id || "");
  const [tripId, setTripId] = useState("");
  const [category, setCategory] = useState("Travel");
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const totals = expenseTotals(state.expenses);
  const employeeTrips = state.businessTrips.filter(item => item.employeeId === employeeId);

  useEffect(() => {
    if (!eligibleEmployees.some(employee => employee.id === employeeId)) setEmployeeId(eligibleEmployees[0]?.id || "");
  }, [eligibleEmployees, employeeId]);

  function updateExpense(id: string, patch: Partial<EmployeeExpense>) {
    setState(prev => ({ ...prev, expenses: prev.expenses.map(item => item.id === id ? { ...item, ...patch } : item) }));
  }

  function submit() {
    const value = Number(amount);
    if (!employeeId || !category.trim() || !date || !Number.isFinite(value) || value <= 0) return notify("Employee, category, date and positive amount are required.");
    setState(prev => ({
      ...prev,
      expenses: [...prev.expenses, { id: newId(), version: 1, employeeId, tripId: tripId || undefined, category, date, amount: value, description, status: "Submitted", createdOn: todayISO() }]
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
    {canCreate && <div className="panel">
      <div className="panel-head"><div><h3>Employee Expenses</h3><span>Submit and process employee expenses.</span></div></div>
      <div className="form-grid compact">
        <label>Employee<EmployeePicker id="expense-employee" name="expense-employee" value={employeeId} onChange={nextEmployeeId => { setEmployeeId(nextEmployeeId); setTripId(""); }} options={employeePickerOptions(eligibleEmployees)} /></label>
        <label>Trip<select id="expense-trip" name="expense-trip" value={tripId} onChange={event => setTripId(event.target.value)}><option value="">No trip link</option>{employeeTrips.map(trip => <option key={trip.id} value={trip.id}>{trip.destination} - {formatDate(trip.from)}</option>)}</select></label>
        <label>Category<select id="expense-category" name="expense-category" value={category} onChange={event => setCategory(event.target.value)}><option>Travel</option><option>Hotel</option><option>Meal</option><option>Medical</option><option>Fuel</option><option>Other</option></select></label>
        <label>Date<input id="expense-date" name="expense-date" type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
        <label htmlFor="expense-amount">Amount<input id="expense-amount" name="expense-amount" type="number" min="0" value={amount} onChange={event => setAmount(event.target.value)} /></label>
        <label className="wide" htmlFor="expense-description">Description<textarea id="expense-description" name="expense-description" value={description} onChange={event => setDescription(event.target.value)} /></label>
      </div>
      <div className="form-actions"><button className="primary" onClick={submit}>Submit expense</button></div>
    </div>}
    <div className="panel">
      <div className="panel-head"><h3>Expense Register</h3><span>{state.expenses.length} records</span></div>
      <DataTable label="Employee expenses" empty="No expenses yet." columns={["Employee", "Category", "Date", "Amount", "Trip", "Status", "Actions"]} rows={state.expenses.map(expense => {
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
            {canReview && expense.status === "Submitted" && <><button onClick={() => updateExpense(expense.id, { status: "Approved" })}>Approve</button><button onClick={() => updateExpense(expense.id, { status: "Rejected" })}>Reject</button></>}
            {canPay && expense.status === "Approved" && <button onClick={() => updateExpense(expense.id, { status: "Paid" })}>Mark paid</button>}
            {(authorization.hasPermission("expense.hr.approve") || (authorization.hasPermission("expense.self.create") && expense.employeeId === authorization.scopes.employeeId)) && expense.status === "Submitted" && <button onClick={() => confirmDelete(`${expense.category} expense`) && setState(prev => ({ ...prev, expenses: prev.expenses.filter(item => item.id !== expense.id) }))}>Delete</button>}
          </div>
        ];
      })} />
    </div>
  </section>;
}

function Loans({ state, setState, setModal, notify, close, canOverrideLimit }: {
  state: HrState;
  setState: React.Dispatch<React.SetStateAction<HrState>>;
  setModal: (content: React.ReactNode) => void;
  notify: (message: string) => void;
  close: () => void;
  canOverrideLimit: boolean;
}) {
  const { active: searchActive } = usePageSearch();
  const searchResults = usePageSearchList<{ id: string }>("loans", "/loans");
  const [status, setStatus] = useState("");
  const [department, setDepartment] = useState("");
  const loans = state.loans ?? [];
  const active = loans.filter(loan => loan.status === "Active");
  const outstanding = loans.filter(loan => loan.status === "Active" || loan.status === "Paused").reduce((sum, loan) => sum + loanBalance(state, loan.id), 0);
  const now = new Date();
  const scheduled = activeEmployees(state.employees).reduce((sum, employee) => sum + payrollLoanDeductions(state, employee, now.getFullYear(), now.getMonth() + 1, employeeSalary(employee).total).reduce((total, item) => total + item.amount, 0), 0);
  const visible = rankedPageSearchItems(loans.filter(loan => {
    const employee = state.employees.find(item => item.id === loan.employeeId);
    return (!status || loan.status === status) && (!department || employee?.fields.Department === department);
  }), searchResults.data, searchActive, loan => loan.id, match => match.id);

  function saveLoan(loan: EmployeeLoan) {
    setState(prev => ({ ...prev, loans: prev.loans.some(item => item.id === loan.id) ? prev.loans.map(item => item.id === loan.id ? loan : item) : [...prev.loans, loan] }));
    notify(loan.status === "Draft" ? "Loan draft saved." : "Loan activated.");
  }

  function updateStatus(loan: EmployeeLoan, nextStatus: EmployeeLoan["status"]) {
    setState(prev => ({ ...prev, loans: prev.loans.map(item => item.id === loan.id ? { ...item, status: nextStatus } : item) }));
    notify(`Loan ${nextStatus.toLowerCase()}.`);
  }

  function openLoanForm(loan?: EmployeeLoan) {
    setModal(<LoanForm state={state} loan={loan} save={saveLoan} close={close} notify={notify} />);
  }

  return <section className="stack">
    <div className="payroll-grid">
      <div className="payroll-tile"><span>Active loans</span><strong>{active.length}</strong><p>{loans.filter(loan => loan.status === "Paused").length} paused</p></div>
      <div className="payroll-tile"><span>Total outstanding</span><strong>{formatMoney(outstanding, state.settings.company.currency)}</strong><p>Active and paused loans</p></div>
      <div className="payroll-tile"><span>This month</span><strong>{formatMoney(scheduled, state.settings.company.currency)}</strong><p>Scheduled payroll deduction</p></div>
      <div className="payroll-tile"><span>Settled loans</span><strong>{loans.filter(loan => loan.status === "Settled").length}</strong><p>{state.loanRepayments.length} posted repayment(s)</p></div>
    </div>
    <div className="panel">
      <div className="panel-head"><div><h3>Employee Loans</h3><span>Automatic plans, manual deductions and repayment history.</span></div>{canOverrideLimit && <button className="primary" onClick={() => openLoanForm()}><HandCoins size={16} /> Add loan</button>}</div>
      <div className="inline-controls">
        <select aria-label="Loan status filter" value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option>{["Draft", "Active", "Paused", "Settled", "Cancelled"].map(item => <option key={item}>{item}</option>)}</select>
        <select aria-label="Loan department filter" value={department} onChange={event => setDepartment(event.target.value)}><option value="">All departments</option>{state.settings.departments.map(item => <option key={item}>{item}</option>)}</select>
      </div>
    </div>
    <div className="panel">
      <DataTable label="Employee loans" empty="No loans match the filters." columns={["Employee", "Loan", "Principal", "Monthly plan", "Paid", "Balance", "Plan", "Status", "Actions"]} rows={visible.map(loan => {
        const employee = state.employees.find(item => item.id === loan.employeeId);
        const balance = loanBalance(state, loan.id);
        const scheduledAmount = loanScheduledAmount(loan);
        const effectiveScheduledAmount = employee ? Math.min(scheduledAmount, companyLoanDeductionCap(state.settings, employeeSalary(employee).total)) : scheduledAmount;
        const projectedMonths = loanEstimatedMonths(state, loan);
        return [
          <span key="employee"><strong>{employeeName(employee)}</strong><br /><small>{employee?.fields["Employee Code"] || "-"}</small></span>,
          <span key="loan"><strong>{loan.type}</strong><br /><small>{loan.repaymentMode}</small></span>,
          formatMoney(loan.principal, state.settings.company.currency),
          loan.repaymentMode === "Manual" ? "Manual" : formatMoney(effectiveScheduledAmount, state.settings.company.currency),
          formatMoney(loan.principal - balance, state.settings.company.currency),
          formatMoney(balance, state.settings.company.currency),
          <span key="plan">{loan.repaymentMode === "Manual" ? "Manual schedule" : `${projectedMonths} projected month(s)`}<br /><small>{loan.startPeriod} → {loanEstimatedEndPeriod(state, loan)}</small></span>,
          <Badge key="status" value={loan.status} />,
          <div className="row-actions" key="actions">
            <button onClick={() => setModal(<LoanDetails state={state} loan={loan} close={close} />)}>View</button>
            {canOverrideLimit && loan.status === "Draft" && <><button onClick={() => openLoanForm(loan)}>Edit</button><button className="primary" onClick={() => updateStatus(loan, "Active")}>Activate</button></>}
            {canOverrideLimit && loan.status === "Active" && <button onClick={() => updateStatus(loan, "Paused")}>Pause</button>}
            {canOverrideLimit && loan.status === "Paused" && <button onClick={() => updateStatus(loan, "Active")}>Resume</button>}
            {canOverrideLimit && (loan.status === "Active" || loan.status === "Paused") && <><button onClick={() => setModal(<LoanDeductionForm state={state} loan={loan} setState={setState} notify={notify} close={close} canOverrideLimit={canOverrideLimit} />)}>Set deduction</button><button onClick={() => setModal(<LoanPaymentForm state={state} loan={loan} setState={setState} notify={notify} close={close} />)}>Record payment</button><button className="danger-outline" onClick={() => window.confirm("Cancel this loan? Future payroll deductions will stop.") && updateStatus(loan, "Cancelled")}>Cancel</button></>}
          </div>
        ];
      })} />
    </div>
  </section>;
}

function LoanForm({ state, loan, save, close, notify }: { state: HrState; loan?: EmployeeLoan; save: (loan: EmployeeLoan) => void; close: () => void; notify: (message: string) => void }) {
  const employees = activeEmployees(state.employees);
  const [draft, setDraft] = useState<EmployeeLoan>(() => loan ? { ...loan, deductionOverrides: { ...loan.deductionOverrides } } : {
    id: newId(), employeeId: employees[0]?.id || "", type: "Salary advance", principal: 0, disbursementDate: todayISO(), startPeriod: todayISO().slice(0, 7),
    repaymentMode: "Duration", termMonths: 12, monthlyLimit: 0, status: "Draft", reference: "", notes: "", createdOn: todayISO(), deductionOverrides: {}
  });
  const installment = loanScheduledAmount(draft);
  const selectedEmployee = employees.find(employee => employee.id === draft.employeeId);
  const effectiveInstallment = Math.min(installment, selectedEmployee ? companyLoanDeductionCap(state.settings, employeeSalary(selectedEmployee).total) : Number.POSITIVE_INFINITY);
  const projectedMonths = effectiveInstallment > 0 ? Math.ceil(draft.principal / effectiveInstallment) : 0;

  function submit() {
    if (!draft.employeeId || draft.principal <= 0 || !/^\d{4}-\d{2}$/.test(draft.startPeriod) || !draft.disbursementDate) return notify("Employee, principal, disbursement date and first payroll month are required.");
    if (draft.repaymentMode === "Duration" && (draft.termMonths < 1 || draft.termMonths > 60)) return notify("Duration must be between 1 and 60 months.");
    if (draft.repaymentMode === "Monthly limit" && draft.monthlyLimit <= 0) return notify("Enter a positive monthly deduction limit.");
    save({ ...draft, principal: Math.round(draft.principal * 100) / 100, termMonths: draft.repaymentMode === "Duration" ? Math.round(draft.termMonths) : 0, monthlyLimit: Math.max(0, Math.round(draft.monthlyLimit * 100) / 100) });
    close();
  }

  return <div><h2>{loan ? "Edit loan" : "Add loan"}</h2><div className="form-grid compact">
    <label>Employee<EmployeePicker value={draft.employeeId} disabled={!!loan} onChange={employeeId => setDraft(prev => ({ ...prev, employeeId }))} options={employeePickerOptions(employees)} /></label>
    <label>Loan type<select value={draft.type} onChange={event => setDraft(prev => ({ ...prev, type: event.target.value }))}><option>Salary advance</option><option>Personal loan</option><option>Emergency loan</option><option>Other</option></select></label>
    <label>Principal amount<input type="number" min="0.01" step="0.01" disabled={!!loan && loan.status !== "Draft"} value={draft.principal || ""} onChange={event => setDraft(prev => ({ ...prev, principal: Number(event.target.value) || 0 }))} /></label>
    <label>Disbursement date<input type="date" value={draft.disbursementDate} onChange={event => setDraft(prev => ({ ...prev, disbursementDate: event.target.value }))} /></label>
    <label>First payroll month<input type="month" value={draft.startPeriod} onChange={event => setDraft(prev => ({ ...prev, startPeriod: event.target.value }))} /></label>
    <label>Repayment mode<select value={draft.repaymentMode} onChange={event => setDraft(prev => ({ ...prev, repaymentMode: event.target.value as EmployeeLoan["repaymentMode"] }))}><option>Duration</option><option>Monthly limit</option><option>Manual</option></select></label>
    {draft.repaymentMode === "Duration" && <label>Duration in months<input type="number" min="1" max="60" value={draft.termMonths} onChange={event => setDraft(prev => ({ ...prev, termMonths: Number(event.target.value) || 0 }))} /></label>}
    {draft.repaymentMode !== "Manual" && <label>{draft.repaymentMode === "Monthly limit" ? "Monthly deduction" : "Loan monthly limit (optional)"}<input type="number" min="0" step="0.01" value={draft.monthlyLimit || ""} onChange={event => setDraft(prev => ({ ...prev, monthlyLimit: Number(event.target.value) || 0 }))} /></label>}
    <label>Reference<input value={draft.reference} onChange={event => setDraft(prev => ({ ...prev, reference: event.target.value }))} /></label>
    <label>Status<select value={draft.status} onChange={event => setDraft(prev => ({ ...prev, status: event.target.value as EmployeeLoan["status"] }))}><option>Draft</option><option>Active</option></select></label>
    <label className="wide">Notes<textarea value={draft.notes} onChange={event => setDraft(prev => ({ ...prev, notes: event.target.value }))} /></label>
  </div><p className="muted">{draft.repaymentMode === "Manual" ? "HR will enter the deduction for each payroll month." : `Planned deduction after current limits: ${formatMoney(effectiveInstallment, state.settings.company.currency)} for about ${projectedMonths || "-"} month(s). The last installment adjusts to the remaining balance.`}</p><div className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={submit}>Save loan</button></div></div>;
}

function LoanDeductionForm({ state, loan, setState, notify, close, canOverrideLimit }: { state: HrState; loan: EmployeeLoan; setState: React.Dispatch<React.SetStateAction<HrState>>; notify: (message: string) => void; close: () => void; canOverrideLimit: boolean }) {
  const defaultPeriod = todayISO().slice(0, 7);
  const [period, setPeriod] = useState(defaultPeriod);
  const [amount, setAmount] = useState(String(loan.deductionOverrides?.[defaultPeriod]?.amount ?? loanScheduledAmount(loan)));
  const [reason, setReason] = useState(loan.deductionOverrides?.[defaultPeriod]?.reason ?? "");
  const employee = state.employees.find(item => item.id === loan.employeeId)!;
  const companyCap = companyLoanDeductionCap(state.settings, employeeSalary(employee).total);
  const normalLimit = Math.min(loan.monthlyLimit > 0 ? loan.monthlyLimit : Number.POSITIVE_INFINITY, companyCap);
  const balance = loanBalance(state, loan.id);

  function saveOverride() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0 || value > balance) return notify("Deduction must be between zero and the remaining balance.");
    if (!reason.trim()) return notify("Enter a reason for the manual deduction.");
    const aboveLimit = value > normalLimit;
    if (aboveLimit && !canOverrideLimit) return notify("You do not have permission to approve a deduction above the configured limit.");
    setState(prev => setLoanDeductionOverride(prev, loan.id, period, value, reason, aboveLimit));
    notify(value === 0 ? "Loan deduction skipped for this month." : "Loan deduction saved.");
    close();
  }

  return <div><h2>Set loan deduction</h2><p className="muted">{employeeName(employee)} · Balance {formatMoney(balance, state.settings.company.currency)}</p><div className="form-grid compact">
    <label>Payroll month<input type="month" value={period} onChange={event => { const next = event.target.value; setPeriod(next); setAmount(String(loan.deductionOverrides?.[next]?.amount ?? loanScheduledAmount(loan))); setReason(loan.deductionOverrides?.[next]?.reason ?? ""); }} /></label>
    <label>Deduction amount<input type="number" min="0" max={balance} step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label>
    <label className="wide">Reason<input value={reason} onChange={event => setReason(event.target.value)} placeholder="Required for the audit history" /></label>
  </div><p className="muted">Normal limit: {Number.isFinite(normalLimit) ? formatMoney(normalLimit, state.settings.company.currency) : "No configured limit"}. Enter 0 to skip the month.{canOverrideLimit ? " Authorized amounts above the limit are recorded as overrides." : ""}</p><div className="modal-actions"><button onClick={() => { setState(prev => setLoanDeductionOverride(prev, loan.id, period, undefined)); notify("Automatic schedule restored."); close(); }}>Use schedule</button><button onClick={close}>Cancel</button><button className="primary" onClick={saveOverride}>Save deduction</button></div></div>;
}

function LoanPaymentForm({ state, loan, setState, notify, close }: { state: HrState; loan: EmployeeLoan; setState: React.Dispatch<React.SetStateAction<HrState>>; notify: (message: string) => void; close: () => void }) {
  const balance = loanBalance(state, loan.id);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  function submit() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > balance) return notify("Payment must be positive and cannot exceed the remaining balance.");
    if (!note.trim()) return notify("Enter a payment reference or note.");
    setState(prev => recordManualLoanRepayment(prev, loan.id, value, note, date));
    notify("Manual loan payment posted.");
    close();
  }
  return <div><h2>Record loan payment</h2><p className="muted">Remaining balance: {formatMoney(balance, state.settings.company.currency)}</p><div className="form-grid compact"><label>Amount<input type="number" min="0.01" max={balance} step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label><label>Payment date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><label className="wide">Reference or note<input value={note} onChange={event => setNote(event.target.value)} /></label></div><div className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={submit}>Post payment</button></div></div>;
}

function LoanDetails({ state, loan, close }: { state: HrState; loan: EmployeeLoan; close: () => void }) {
  const employee = state.employees.find(item => item.id === loan.employeeId);
  const repayments = state.loanRepayments.filter(item => item.loanId === loan.id).slice().sort((a, b) => b.postedOn.localeCompare(a.postedOn));
  const overrides = Object.entries(loan.deductionOverrides ?? {}).sort(([a], [b]) => b.localeCompare(a));
  return <div><h2>{loan.type}</h2><p className="muted">{employeeName(employee)} · {loan.reference || "No reference"}</p><div className="settlement-preview"><div><span>Principal</span><strong>{formatMoney(loan.principal, state.settings.company.currency)}</strong></div><div><span>Balance</span><strong>{formatMoney(loanBalance(state, loan.id), state.settings.company.currency)}</strong></div><div><span>Projected end</span><strong>{loanEstimatedEndPeriod(state, loan)}</strong></div></div><h3>Repayment history</h3><DataTable empty="No repayments posted." columns={["Period", "Source", "Amount", "Status", "Note"]} rows={repayments.map(item => [monthKeyLabel(item.year, item.month), item.source, formatMoney(item.amount, state.settings.company.currency), <Badge key="status" value={item.status} />, item.note || "-"])} /><h3>Manual payroll entries</h3><DataTable empty="No manual payroll entries." columns={["Period", "Amount", "Reason", "Approval"]} rows={overrides.map(([period, item]) => [period, formatMoney(item.amount, state.settings.company.currency), item.reason, item.approvedAboveLimit ? "Authorized override" : "Within limit"])} /><div className="modal-actions"><button onClick={close}>Close</button></div></div>;
}

function monthKeyLabel(year: number, month: number) {
  return `${months[month - 1]} ${year}`;
}

function Recruitment({ state, setState, notify, setNav }: { state: HrState; setState: React.Dispatch<React.SetStateAction<HrState>>; notify: (message: string) => void; setNav: (nav: NavItem) => void }) {
  const authorization = useAuthorization();
  const canManage = authorization.hasPermission("recruitment.manage");
  const canHire = authorization.hasAllPermissions("recruitment.manage", "employee.hr.create");
  const { active: searchActive } = usePageSearch();
  const jobSearch = usePageSearchList<{ id: string }>("recruitment-jobs", "/recruitment/jobs");
  const candidateSearch = usePageSearchList<{ id: string }>("recruitment-candidates", "/recruitment/candidates");
  const visibleJobs = rankedPageSearchItems(state.jobs, jobSearch.data, searchActive, job => job.id, match => match.id);
  const visibleCandidates = rankedPageSearchItems(state.candidates, candidateSearch.data, searchActive, candidate => candidate.id, match => match.id);
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
  const [assessmentCandidateId, setAssessmentCandidateId] = useState("");
  const [assessmentDraft, setAssessmentDraft] = useState<InterviewAssessment>({});
  const [offerCandidateId, setOfferCandidateId] = useState("");
  const [offerDraft, setOfferDraft] = useState<OfferDetails>({});
  const [savingStageDocument, setSavingStageDocument] = useState(false);
  const pipeline = candidatePipeline(state.candidates);
  const vacancies = new Map(state.jobs.map(job => [job.id, recruitmentJobVacancies(job, state.candidates)]));
  const openJobs = state.jobs.filter(job => job.status === "Open" && !vacancies.get(job.id)?.isFilled);
  const openPositions = openJobs.reduce((sum, job) => sum + (vacancies.get(job.id)?.remaining ?? 0), 0);
  const editingCandidateJobId = state.candidates.find(candidate => candidate.id === editingCandidateId)?.jobId;
  const candidateJobs = state.jobs.filter(job => openJobs.some(openJob => openJob.id === job.id) || job.id === editingCandidateJobId);
  const activeCandidates = state.candidates.filter(candidate => candidate.stage !== "Hired" && candidate.stage !== "Rejected");

  useEffect(() => {
    if (!candidateJobId && candidateJobs[0]) setCandidateJobId(candidateJobs[0].id);
    if (candidateJobId && !candidateJobs.some(job => job.id === candidateJobId)) setCandidateJobId(candidateJobs[0]?.id || "");
  }, [candidateJobId, editingCandidateId, state.jobs, state.candidates]);

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
      version: editingJobId ? state.jobs.find(job => job.id === editingJobId)?.version ?? 1 : 1,
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
    if (!confirmDelete(`${job?.title || "job opening"}. Candidate history will be retained.`)) return;
    setState(prev => ({
      ...prev,
      jobs: prev.jobs.filter(job => job.id !== id)
    }));
    if (editingJobId === id) resetJobForm();
    notify("Opening archived. Candidate history was retained.");
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
    if (!editingCandidateId && !openJobs.length) return notify("Add or reopen a job with an available position first.");
    if (!candidateName.trim()) return notify("Candidate name is required.");
    const selectedJobId = candidateJobs.some(job => job.id === candidateJobId) ? candidateJobId : candidateJobs[0]?.id;
    if (!selectedJobId) return notify("Select an available job opening.");
    const existingCandidate = state.candidates.find(candidate => candidate.id === editingCandidateId);
    const record: RecruitmentCandidate = {
      id: editingCandidateId || newId(),
      version: editingCandidateId ? state.candidates.find(candidate => candidate.id === editingCandidateId)?.version ?? 1 : 1,
      jobId: selectedJobId,
      name: candidateName.trim(),
      email: candidateEmail.trim(),
      phone: candidatePhone.trim(),
      stage: candidateStage,
      rating: Math.min(5, Math.max(0, Number(candidateRating) || 0)),
      notes: candidateNotes.trim(),
      appliedOn: editingCandidateId ? existingCandidate?.appliedOn || todayISO() : todayISO(),
      employeeId: existingCandidate?.employeeId,
      interviewAssessment: existingCandidate?.interviewAssessment,
      offerDetails: existingCandidate?.offerDetails
    };

    setState(prev => ({
      ...prev,
      candidates: editingCandidateId ? prev.candidates.map(candidate => candidate.id === editingCandidateId ? record : candidate) : [...prev.candidates, record]
    }));
    notify(editingCandidateId ? "Candidate updated." : "Candidate added.");
    resetCandidateForm();
  }

  function moveCandidate(id: string, stage: RecruitmentCandidate["stage"]) {
    const candidate = state.candidates.find(item => item.id === id);
    if (candidate?.stage === "Hired" && stage !== "Hired") return notify("A hired candidate must be managed through the employee offboarding process.");
    const job = candidate && state.jobs.find(item => item.id === candidate.jobId);
    if (candidate && job && candidate.stage !== "Hired" && stage === "Hired" && (job.status !== "Open" || vacancies.get(job.id)?.isFilled)) {
      return notify("All openings for this job are filled or closed.");
    }
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

  function openAssessment(candidate: RecruitmentCandidate) {
    const job = state.jobs.find(item => item.id === candidate.jobId);
    setAssessmentCandidateId(candidate.id);
    setAssessmentDraft(candidate.interviewAssessment ?? { date: todayISO(), hiringDepartment: job?.dept || "" });
  }

  function openOffer(candidate: RecruitmentCandidate) {
    const job = state.jobs.find(item => item.id === candidate.jobId);
    setOfferCandidateId(candidate.id);
    setOfferDraft(candidate.offerDetails ?? { issueDate: todayISO(), basic: 0, hra: 0, conveyance: 0, otherAllowance: 0, lineOfBusiness: job?.dept || "" });
  }

  async function saveAssessment() {
    if (!assessmentCandidateId) return;
    setSavingStageDocument(true);
    try {
      await apiRequest(`/recruitment/candidates/${assessmentCandidateId}`, { method: "PATCH", csrfToken: authorization.session.csrfToken, body: JSON.stringify({ interviewAssessment: assessmentDraft }) });
      setState(previous => ({ ...previous, candidates: previous.candidates.map(candidate => candidate.id === assessmentCandidateId ? { ...candidate, rating: assessmentDraft.overallRating ?? candidate.rating, interviewAssessment: assessmentDraft } : candidate) }));
      notify("Interview assessment saved.");
    } catch (error) { notify(errorMessage(error)); }
    finally { setSavingStageDocument(false); }
  }

  async function saveOffer() {
    if (!offerCandidateId) return;
    setSavingStageDocument(true);
    try {
      await apiRequest(`/recruitment/candidates/${offerCandidateId}`, { method: "PATCH", csrfToken: authorization.session.csrfToken, body: JSON.stringify({ offerDetails: offerDraft }) });
      setState(previous => ({ ...previous, candidates: previous.candidates.map(candidate => candidate.id === offerCandidateId ? { ...candidate, offerDetails: offerDraft } : candidate) }));
      notify("Offer details saved.");
    } catch (error) { notify(errorMessage(error)); }
    finally { setSavingStageDocument(false); }
  }

  async function downloadRecruitment(candidate: RecruitmentCandidate, document: "interview-assessment" | "offer-letter" | "nda") {
    try {
      const file = await apiDownload(`/recruitment/candidates/${candidate.id}/${document}.pdf`);
      downloadBlob(file.blob, file.fileName);
      notify(`${file.fileName} downloaded.`);
    } catch (error) { notify(errorMessage(error)); }
  }

  return <section className="stack recruitment-workspace">
    <div className="settlement-preview">
      <div><span>Remaining</span><strong>{openPositions}</strong></div>
      <div><span>Open jobs</span><strong>{openJobs.length}</strong></div>
      <div><span>Pipeline</span><strong>{activeCandidates.length}</strong></div>
      <div><span>Offer stage</span><strong>{pipeline.Offer}</strong></div>
      <div><span>Filled</span><strong>{pipeline.Hired}</strong></div>
    </div>

    <div className="panel">
      <div className="panel-head">
        <div><h3>Job Openings</h3><span>{openJobs.length} open</span></div>
        {canManage && editingJobId && <button onClick={resetJobForm}>Cancel edit</button>}
      </div>
      {canManage && <><div className="form-grid compact">
        <label htmlFor="recruitment-job-title">Job title *<input id="recruitment-job-title" name="recruitment-job-title" value={jobTitle} onChange={event => setJobTitle(event.target.value)} /></label>
        <label>Department<select id="recruitment-job-dept" name="recruitment-job-dept" value={jobDept} onChange={event => setJobDept(event.target.value)}>{state.settings.departments.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>No. of openings<input id="recruitment-job-openings" name="recruitment-job-openings" type="number" min="1" value={jobOpenings} onChange={event => setJobOpenings(event.target.value)} /></label>
        <label>Status<select id="recruitment-job-status" name="recruitment-job-status" value={jobStatus} onChange={event => setJobStatus(event.target.value as RecruitmentJob["status"])}><option>Open</option><option>On Hold</option><option>Closed</option></select></label>
        <label>Posted on<input id="recruitment-job-posted" name="recruitment-job-posted" type="date" value={jobPostedOn} onChange={event => setJobPostedOn(event.target.value)} /></label>
        <label className="wide" htmlFor="recruitment-job-description">Description<textarea id="recruitment-job-description" name="recruitment-job-description" value={jobDescription} onChange={event => setJobDescription(event.target.value)} /></label>
      </div>
      <div className="form-actions"><button className="primary" onClick={saveJob}>{editingJobId ? "Update opening" : "Add opening"}</button></div></>}
      <DataTable
        label="Job openings"
        empty="No job openings yet."
        columns={["Title", "Department", "Openings", "Filled", "Remaining", "Candidates", "Posted", "Status", "Actions"]}
        rows={visibleJobs.map(job => {
          const count = state.candidates.filter(candidate => candidate.jobId === job.id).length;
          const vacancy = vacancies.get(job.id)!;
          return [
            <strong key="title">{job.title}</strong>,
            job.dept || "-",
            job.openings,
            vacancy.filled,
            vacancy.remaining,
            count,
            formatDate(job.postedOn),
            <Badge key="status" value={vacancy.isFilled ? "Filled" : job.status} />,
            canManage ? <div className="row-actions" key="actions"><button onClick={() => editJob(job)}>Edit</button><button onClick={() => deleteJob(job.id)}>Delete</button></div> : "-"
          ];
        })}
      />
    </div>

    <div className="panel">
      <div className="panel-head">
        <div><h3>Candidate Pipeline</h3><span>Move candidates between stages with the dropdown on each card.</span></div>
        {canManage && editingCandidateId && <button onClick={resetCandidateForm}>Cancel edit</button>}
      </div>
      {canManage && <><div className="form-grid compact">
        <label htmlFor="candidate-name">Full name *<input id="candidate-name" name="candidate-name" value={candidateName} onChange={event => setCandidateName(event.target.value)} /></label>
        <label>Applying for<select id="candidate-job" name="candidate-job" value={candidateJobId} disabled={!candidateJobs.length} onChange={event => setCandidateJobId(event.target.value)}>{candidateJobs.map(job => <option key={job.id} value={job.id}>{job.title}</option>)}</select></label>
        <label htmlFor="candidate-email">Email<input id="candidate-email" name="candidate-email" type="email" value={candidateEmail} onChange={event => setCandidateEmail(event.target.value)} /></label>
        <label htmlFor="candidate-phone">Phone<input id="candidate-phone" name="candidate-phone" value={candidatePhone} onChange={event => setCandidatePhone(event.target.value)} /></label>
        <label>Stage<select id="candidate-stage" name="candidate-stage" value={candidateStage} disabled={!editingCandidateId} onChange={event => setCandidateStage(event.target.value as RecruitmentCandidate["stage"])}>{candidateStages.map(stage => <option key={stage}>{stage}</option>)}</select></label>
        <label>Rating (0-5)<input id="candidate-rating" name="candidate-rating" type="number" min="0" max="5" value={candidateRating} onChange={event => setCandidateRating(event.target.value)} /></label>
        <label className="wide" htmlFor="candidate-notes">Notes<textarea id="candidate-notes" name="candidate-notes" value={candidateNotes} onChange={event => setCandidateNotes(event.target.value)} /></label>
      </div>
      <div className="form-actions"><button className="primary" onClick={saveCandidate}>{editingCandidateId ? "Update candidate" : "Add candidate"}</button></div></>}

      <div className="recruitment-pipeline">
        {candidateStages.map(stage => {
          const cards = visibleCandidates.filter(candidate => candidate.stage === stage);
          return <div className="pipeline-column" key={stage}>
            <div className="pipeline-head"><strong>{stage}</strong><span>{cards.length}</span></div>
            {cards.length ? cards.map(candidate => {
              const job = state.jobs.find(item => item.id === candidate.jobId);
              return <article className="candidate-card" key={candidate.id}>
                <div><strong>{candidate.name}</strong><span>{job?.title || "(no job)"}</span></div>
                <p>{candidate.email || candidate.phone || "No contact added"}</p>
                {candidate.rating > 0 && <em>Rating: {candidate.rating}/5</em>}
                {canManage ? <select aria-label={`Move ${candidate.name}`} value={candidate.stage} onChange={event => moveCandidate(candidate.id, event.target.value as RecruitmentCandidate["stage"])}>{candidateStages.map(option => <option key={option}>{option}</option>)}</select> : <Badge value={candidate.stage} />}
                {candidate.notes && <small>{candidate.notes}</small>}
                <div className="row-actions">
                  {candidate.stage === "Interview" && candidate.interviewAssessment && (canManage ? <button className="primary" onClick={() => openAssessment(candidate)}>Assessment</button> : <button onClick={() => void downloadRecruitment(candidate, "interview-assessment")}>Assessment PDF</button>)}
                  {candidate.stage === "Interview" && !candidate.interviewAssessment && <small>Preparing assessment…</small>}
                  {candidate.stage === "Offer" && candidate.offerDetails && (canManage ? <button className="primary" onClick={() => openOffer(candidate)}>Offer documents</button> : <><button onClick={() => void downloadRecruitment(candidate, "interview-assessment")}>Assessment PDF</button><button onClick={() => void downloadRecruitment(candidate, "offer-letter")}>Offer PDF</button><button onClick={() => void downloadRecruitment(candidate, "nda")}>NDA PDF</button></>)}
                  {candidate.stage === "Offer" && !candidate.offerDetails && <small>Preparing offer…</small>}
                  {canManage && <>{candidate.stage === "Hired" && (candidate.employeeId ? <Badge value="Employee added" /> : canHire ? <button className="primary" onClick={() => addAsEmployee(candidate)}>Add as employee</button> : null)}<button onClick={() => editCandidate(candidate)}>Edit</button><button onClick={() => confirmDelete(candidate.name) && setState(prev => ({ ...prev, candidates: prev.candidates.filter(item => item.id !== candidate.id) }))}>Delete</button></>}
                </div>
              </article>;
            }) : <div className="empty compact">No {stage.toLowerCase()} candidates.</div>}
          </div>;
        })}
      </div>
    </div>
    {assessmentCandidateId && (() => { const candidate = state.candidates.find(item => item.id === assessmentCandidateId); const job = candidate && state.jobs.find(item => item.id === candidate.jobId); return candidate ? <InterviewAssessmentDialog candidate={candidate} job={job} value={assessmentDraft} saving={savingStageDocument} onChange={setAssessmentDraft} onSave={() => void saveAssessment()} onDownload={() => void downloadRecruitment(candidate, "interview-assessment")} onClose={() => setAssessmentCandidateId("")} /> : null; })()}
    {offerCandidateId && (() => { const candidate = state.candidates.find(item => item.id === offerCandidateId); const job = candidate && state.jobs.find(item => item.id === candidate.jobId); return candidate ? <OfferDocumentsDialog candidate={candidate} job={job} value={offerDraft} saving={savingStageDocument} onChange={setOfferDraft} onSave={() => void saveOffer()} onDownload={document => void downloadRecruitment(candidate, document)} onClose={() => setOfferCandidateId("")} /> : null; })()}
  </section>;
}

function InterviewAssessmentDialog({ candidate, job, value, saving, onChange, onSave, onDownload, onClose }: { candidate: RecruitmentCandidate; job?: RecruitmentJob; value: InterviewAssessment; saving: boolean; onChange: React.Dispatch<React.SetStateAction<InterviewAssessment>>; onSave: () => void; onDownload: () => void; onClose: () => void }) {
  const ratings: Array<[keyof InterviewAssessment, keyof InterviewAssessment, string]> = [
    ["greetingRating", "greetingRemarks", "Greeting, presentation and communication"], ["backgroundRating", "backgroundRemarks", "Background and experience"],
    ["technicalRating", "technicalRemarks", "Technical knowledge"], ["leadershipRating", "leadershipRemarks", "Leadership and competencies"]
  ];
  const set = (key: keyof InterviewAssessment, next: string | number | undefined) => onChange(previous => ({ ...previous, [key]: next }));
  return <Dialog wide title="Interview assessment" onClose={onClose}>
    <div className="form-grid compact">
      <label>Candidate name<input value={value.candidateName || candidate.name} readOnly /></label><label>Vacancy title<input value={value.position || job?.title || "-"} readOnly /></label><label>Department<input value={value.department || job?.dept || "-"} readOnly /></label><label>Interview date<input type="date" value={(value.date || todayISO()).slice(0, 10)} readOnly /></label>
      <label>Interview time<input value={value.time || ""} onChange={event => set("time", event.target.value || undefined)} /></label><label>Venue<input value={value.venue || ""} onChange={event => set("venue", event.target.value || undefined)} /></label>
      <label>Hiring name<input value={value.hiringName || ""} onChange={event => set("hiringName", event.target.value || undefined)} /></label><label>Hiring department<input value={value.hiringDepartment || job?.dept || ""} onChange={event => set("hiringDepartment", event.target.value || undefined)} /></label><label>Hiring position<input value={value.hiringPosition || ""} onChange={event => set("hiringPosition", event.target.value || undefined)} /></label>
      {ratings.map(([ratingKey, remarksKey, label]) => <React.Fragment key={String(ratingKey)}><label>{label} rating<select value={String(value[ratingKey] || "")} onChange={event => set(ratingKey, event.target.value ? Number(event.target.value) : undefined)}><option value="">Select 1–5</option>{[1, 2, 3, 4, 5].map(score => <option key={score}>{score}</option>)}</select></label><label className="wide">{label} remarks<textarea maxLength={2000} value={String(value[remarksKey] || "")} onChange={event => set(remarksKey, event.target.value || undefined)} /></label></React.Fragment>)}
      <label>Overall rating<select value={String(value.overallRating || "")} onChange={event => set("overallRating", event.target.value ? Number(event.target.value) : undefined)}><option value="">Select 1–5</option>{[1, 2, 3, 4, 5].map(score => <option key={score}>{score}</option>)}</select></label>
      <label>Visa status<input maxLength={500} value={value.visaStatus || ""} onChange={event => set("visaStatus", event.target.value || undefined)} /></label><label>Driving licence<input maxLength={500} value={value.drivingLicense || ""} onChange={event => set("drivingLicense", event.target.value || undefined)} /></label>
      <label>Current salary<input type="number" min="0" step="0.01" value={value.currentSalary ?? ""} onChange={event => set("currentSalary", event.target.value === "" ? undefined : Number(event.target.value))} /></label><label>Expected salary<input type="number" min="0" step="0.01" value={value.expectedSalary ?? ""} onChange={event => set("expectedSalary", event.target.value === "" ? undefined : Number(event.target.value))} /></label><label>Expected joining date<input type="date" value={(value.expectedJoiningDate || "").slice(0, 10)} onChange={event => set("expectedJoiningDate", event.target.value || undefined)} /></label>
      <label className="wide">Interviewer comments<textarea maxLength={2000} value={value.interviewerComments || ""} onChange={event => set("interviewerComments", event.target.value || undefined)} /></label><label className="wide">Manager comments<textarea maxLength={2000} value={value.managerComments || ""} onChange={event => set("managerComments", event.target.value || undefined)} /></label>
    </div>
    <div className="modal-actions"><button onClick={onClose}>Close</button><button onClick={onDownload}>Download PDF</button><button className="primary" disabled={saving} onClick={onSave}>{saving ? "Saving…" : "Save assessment"}</button></div>
  </Dialog>;
}

function OfferDocumentsDialog({ candidate, job, value, saving, onChange, onSave, onDownload, onClose }: { candidate: RecruitmentCandidate; job?: RecruitmentJob; value: OfferDetails; saving: boolean; onChange: React.Dispatch<React.SetStateAction<OfferDetails>>; onSave: () => void; onDownload: (document: "interview-assessment" | "offer-letter" | "nda") => void; onClose: () => void }) {
  const set = (key: keyof OfferDetails, next: string | number | undefined) => onChange(previous => ({ ...previous, [key]: next }));
  const total = Number(value.basic || 0) + Number(value.hra || 0) + Number(value.conveyance || 0) + Number(value.otherAllowance || 0);
  return <Dialog wide title="Offer stage documents" onClose={onClose}>
    <div className="form-grid compact">
      <label>Candidate name<input value={value.candidateName || candidate.name} readOnly /></label><label>Designation<input value={value.designation || job?.title || "-"} readOnly /></label><label>Line of Business<input value={value.lineOfBusiness || job?.dept || "-"} readOnly /></label><label>Issue date<input type="date" value={(value.issueDate || todayISO()).slice(0, 10)} onChange={event => set("issueDate", event.target.value || undefined)} /></label>
      <label>Basic<input type="number" min="0" step="0.01" value={value.basic ?? 0} onChange={event => set("basic", Math.max(0, Number(event.target.value) || 0))} /></label><label>HRA<input type="number" min="0" step="0.01" value={value.hra ?? 0} onChange={event => set("hra", Math.max(0, Number(event.target.value) || 0))} /></label><label>Conveyance<input type="number" min="0" step="0.01" value={value.conveyance ?? 0} onChange={event => set("conveyance", Math.max(0, Number(event.target.value) || 0))} /></label><label>Other allowance<input type="number" min="0" step="0.01" value={value.otherAllowance ?? 0} onChange={event => set("otherAllowance", Math.max(0, Number(event.target.value) || 0))} /></label><label>Contractual monthly pay<input value={formatMoney(total, "QAR")} readOnly /></label>
    </div>
    <div className="modal-actions"><button onClick={onClose}>Close</button>{candidate.interviewAssessment && <button onClick={() => onDownload("interview-assessment")}>Assessment PDF</button>}<button onClick={() => onDownload("offer-letter")}>Offer Letter PDF</button><button onClick={() => onDownload("nda")}>NDA PDF</button><button className="primary" disabled={saving} onClick={onSave}>{saving ? "Saving…" : "Save offer details"}</button></div>
  </Dialog>;
}

function EOS({ state, setState, notify, savePdf }: { state: HrState; setState: React.Dispatch<React.SetStateAction<HrState>>; notify: (message: string) => void; savePdf: (file: GeneratedPdf | undefined, template: PdfTemplate, employeeId?: string) => void }) {
  const authorization = useAuthorization();
  const canManage = authorization.hasPermission("eos.manage");
  const canExport = authorization.hasAnyPermission("document.hr.manage", "report.export");
  const { active: searchActive } = usePageSearch();
  const eosSearch = usePageSearchList<{ id: string }>("eos", "/eos");
  const visibleEosRecords = rankedPageSearchItems(state.eosRecords, eosSearch.data, searchActive, record => record.id, match => match.id);
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
      <div className="panel-head"><div><h3>EOS, Gratuity & Settlement</h3><span>Gratuity, leave balance, expenses and outstanding advances.</span></div></div>
      {employee && summary && <div className="eos-mode-grid">
        <article><span>EOS</span><strong>{formatMoney(summary.netSettlement, state.settings.company.currency)}</strong><p>Final payable after reimbursements and advances.</p></article>
        <article><span>Gratuity</span><strong>{formatMoney(summary.gratuity, state.settings.company.currency)}</strong><p>Basic salary based service benefit estimate.</p></article>
        <article><span>Settlement</span><strong>{formatMoney(summary.leaveEncashment - summary.lopDeduction, state.settings.company.currency)}</strong><p>Leave encashment minus LOP deductions.</p></article>
      </div>}
      {canManage && <div className="document-grid">
        <label>Employee<EmployeePicker id="eos-employee" name="eos-employee" value={employeeId} onChange={setEmployeeId} options={employeePickerOptions(employees)} /></label>
        <label>Settlement date<input id="eos-date" name="eos-date" type="date" value={asOf} onChange={event => setAsOf(event.target.value)} /></label>
        <label className="wide">Reason<textarea id="eos-reason" name="eos-reason" value={reason} onChange={event => setReason(event.target.value)} /></label>
        <button className="primary" disabled={!employee} onClick={createRecord}>Create settlement draft</button>
      </div>}
      {employee && summary && <div className="settlement-preview">
        <div><span>Service</span><strong>{summary.years.toFixed(2)} years</strong></div>
        <div><span>Gratuity</span><strong>{formatMoney(summary.gratuity, state.settings.company.currency)}</strong></div>
        <div><span>Leave encashment</span><strong>{formatMoney(summary.leaveEncashment, state.settings.company.currency)}</strong></div>
        <div><span>LOP deduction</span><strong>{formatMoney(summary.lopDeduction, state.settings.company.currency)}</strong></div>
        <div><span>Approved expenses</span><strong>{formatMoney(summary.expenseReimbursement, state.settings.company.currency)}</strong></div>
        <div><span>Open advances</span><strong>{formatMoney(summary.tripAdvanceDeduction, state.settings.company.currency)}</strong></div>
        <div><span>EOS payable</span><strong>{formatMoney(summary.netSettlement, state.settings.company.currency)}</strong></div>
      </div>}
      {employee && canExport && <div className="form-actions">
        <button onClick={() => void withPdf(pdf => savePdf(pdf.saveEmployeeDocumentPdf("gratuity_statement", employee, state, reason), "gratuity_statement", employee.id))}>Gratuity PDF</button>
        <button onClick={() => void withPdf(pdf => savePdf(pdf.saveEmployeeDocumentPdf("final_settlement", employee, state, reason), "final_settlement", employee.id))}>Settlement PDF</button>
      </div>}
    </div>
    <div className="panel">
      <div className="panel-head"><h3>EOS Register</h3><span>{visibleEosRecords.length} records</span></div>
      <DataTable label="End-of-service settlements" empty="No EOS records match this search." columns={["Employee", "Date", "Gratuity", "Expenses", "Advances", "Net", "Status", "Actions"]} rows={visibleEosRecords.map(record => {
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
            {canManage && record.status === "Draft" && <button onClick={() => updateRecord(record.id, { status: "Approved" })}>Approve</button>}
            {canManage && record.status === "Approved" && <button onClick={() => updateRecord(record.id, { status: "Paid" })}>Mark paid</button>}
            {canManage && record.status === "Paid" && <button onClick={() => closeEmployee(record)}>Close employee</button>}
            {canExport && rowEmployee && <button onClick={() => void withPdf(pdf => savePdf(pdf.saveEosPdf(record, rowEmployee, state.settings), "final_settlement", rowEmployee.id))}>PDF</button>}
            {canManage && <button onClick={() => confirmDelete(`EOS record dated ${formatDate(record.asOf)}`) && setState(prev => ({ ...prev, eosRecords: prev.eosRecords.filter(item => item.id !== record.id) }))}>Delete</button>}
          </div>
        ];
      })} />
    </div>
  </section>;
}

function Documents({ state, session, notify, savePdf }: { state: HrState; session: BackendSession; notify: (message: string) => void; savePdf: (file: GeneratedPdf | undefined, template: PdfTemplate, employeeId?: string) => void }) {
  const authorization = useAuthorization();
  const canGenerate = authorization.hasPermission("document.hr.manage");
  const active = activeEmployees(state.employees);
  const [employeeId, setEmployeeId] = useState(active[0]?.id || "");
  const [template, setTemplate] = useState<PdfTemplate>("offer_letter");
  const [payslipPeriod, setPayslipPeriod] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  });
  const [notes, setNotes] = useState("");
  const employee = state.employees.find(item => item.id === employeeId);

  function generate() {
    if (!employee) return notify("Select an employee first.");
    const [year, month] = payslipPeriod.split("-").map(Number);
    if (template === "payslip" && (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12)) return notify("Select a valid payslip month.");
    void withPdf(pdf => savePdf(pdf.saveEmployeeDocumentPdf(template, employee, state, notes, template === "payslip" ? { year, month } : undefined), template, employee.id));
  }

  return (
    <section className="stack">
      {canGenerate && <div className="panel">
        <div className="panel-head"><div><h3>HR Documents & Letters</h3><span>Create HR letters and PDFs.</span></div></div>
        <div className="document-grid">
          <label>Employee<EmployeePicker value={employeeId} onChange={setEmployeeId} options={employeePickerOptions(active)} /></label>
          <label>Template<select value={template} onChange={event => setTemplate(event.target.value as PdfTemplate)}>{pdfTemplates.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          {template === "payslip"
            ? <label className="wide">Payslip month<input type="month" min="2000-01" max="2100-12" required value={payslipPeriod} onChange={event => setPayslipPeriod(event.target.value)} /></label>
            : <label className="wide">Notes / purpose<textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Bank request, visa processing, warning details, settlement notes..." /></label>}
          <button className="primary" onClick={generate}>{template === "payslip" ? "Generate payslip" : "Generate PDF"}</button>
        </div>
        {employee && ["final_settlement", "gratuity_statement", "clearance_certificate"].includes(template) && <SettlementPreview employee={employee} state={state} />}
      </div>}
      <DocumentsLibraryPanel session={session} notify={notify} employeeOptions={employeePickerOptions(state.employees)} />
      <ServiceRequestsPanel session={session} notify={notify} />
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
  const { hasPermission: can } = useAuthorization();
  const sections = useSectionSearch("reports");
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const visibleReports = reportTemplates.filter(report => sections.visible(report.id));
  return <section className="report-grid">{visibleReports.map(report => (
    <div className="report-card" key={report.id}>
      <BarChart3 size={20} />
      <h3>{report.label}</h3>
      <p>{report.description}</p>
      {["attendance_report", "payroll_register"].includes(report.id) && <div className="inline-controls report-controls"><select aria-label={`${report.label} month`} value={month} onChange={event => setMonth(Number(event.target.value))}>{months.map((item, index) => <option value={index + 1} key={item}>{item}</option>)}</select><input aria-label={`${report.label} year`} type="number" value={year} onChange={event => setYear(Number(event.target.value))} /></div>}
      {report.id === "leave_report" && <div className="inline-controls report-controls"><input aria-label="Leave report year" type="number" value={year} onChange={event => setYear(Number(event.target.value))} /></div>}
      {can("report.export") ? <button className="primary" onClick={() => void withPdf(pdf => savePdf(pdf.saveReportPdf(report.id, state, year, month), report.id))}><Download size={16} /> Download PDF</button> : <span className="muted">View only</span>}
    </div>
  ))}{sections.active && !sections.query.isPending && !visibleReports.length && <div className="empty">No report cards match this search.</div>}</section>;
}

function SettingsPage({
  state,
  setState,
  notify,
  backendSession
}: {
  state: HrState;
  setState: React.Dispatch<React.SetStateAction<HrState>>;
  notify: (message: string) => void;
  backendSession: BackendSession | null;
}) {
  const sections = useSectionSearch("settings");
  const canConfigureSystem = Boolean(backendSession && hasPermission(backendSession, "system.configure"));
  const canManageDepartments = Boolean(backendSession && hasPermission(backendSession, "department.manage"));
  const canConfigureLeave = Boolean(backendSession && hasPermission(backendSession, "leave.configure"));
  const [company, setCompany] = useState(state.settings.company);
  const [departments, setDepartments] = useState(state.settings.departments.join("\n"));
  const [leaveTypes, setLeaveTypes] = useState(state.settings.leaveTypes.map(item => `${item.name}:${item.days}`).join("\n"));
  const [workdayHours, setWorkdayHours] = useState(state.settings.workdayHours);
  const [halfDayHours, setHalfDayHours] = useState(state.settings.halfDayHours);
  const [loanCapType, setLoanCapType] = useState(state.settings.loanDeductionCap.type);
  const [loanCapValue, setLoanCapValue] = useState(state.settings.loanDeductionCap.value);
  const [payrollProrationBasis, setPayrollProrationBasis] = useState(state.settings.payrollProrationBasis);
  const [payrollRequireBankDetails, setPayrollRequireBankDetails] = useState(state.settings.payrollRequireBankDetails);
  const [payrollRequireAttendance, setPayrollRequireAttendance] = useState(state.settings.payrollRequireAttendance);
  const [payrollVarianceThreshold, setPayrollVarianceThreshold] = useState(state.settings.payrollVarianceThreshold);
  const canSaveOrganizationSettings = canConfigureSystem || canManageDepartments || canConfigureLeave;

  function saveSettings() {
    const nextDepartments = departments.split("\n").map(item => item.trim()).filter(Boolean);
    const nextLeaveTypes = leaveTypes.split("\n").map((line, index) => {
      const [name, days] = line.split(":");
      const normalizedName = name.trim();
      const existing = state.settings.leaveTypes.find(item => item.name.toLowerCase() === normalizedName.toLowerCase()) ?? state.settings.leaveTypes[index];
      return { id: existing?.id || newId(), name: normalizedName, code: existing?.code || "", days: Number(days) || 0, isPaid: existing?.isPaid ?? true, requiresAttachment: existing?.requiresAttachment ?? false };
    }).filter(item => item.name);
    setState(prev => ({ ...prev, settings: {
      ...prev.settings,
      ...(canConfigureSystem ? { company, workdayHours: Math.max(0.25, workdayHours), halfDayHours: Math.max(0.25, Math.min(halfDayHours, workdayHours)), loanDeductionCap: { type: loanCapType, value: Math.max(0, loanCapType === "Percent" ? Math.min(100, loanCapValue) : loanCapValue) }, payrollProrationBasis, payrollRequireBankDetails, payrollRequireAttendance, payrollVarianceThreshold: Math.max(0, payrollVarianceThreshold) } : {}),
      ...(canManageDepartments ? { departments: nextDepartments } : {}),
      ...(canConfigureLeave ? { leaveTypes: nextLeaveTypes } : {})
    } }));
    notify("Settings saved.");
  }

  return <section className="settings-grid">
    {backendSession && sections.visible("sessions") && <SignedInDevicesPanel session={backendSession} notify={notify} />}
    {canConfigureSystem && sections.visible("company") && <div className="panel">
      <div className="panel-head"><h3>Data Protection</h3><span>Managed on Google Cloud</span></div>
      <p className="muted">The database and private document bucket are backed up by the server schedule. Restore operations are restricted to administrators with server access.</p>
    </div>}
    {canConfigureSystem && sections.visible("company") && <div className="panel"><div className="panel-head"><h3>Company Profile</h3></div><div className="form-grid compact">
      {(["name", "legalName", "tagline", "address", "phone", "email", "website", "currency", "wpsEmployerEid", "wpsPayerEid", "wpsPayerQid", "wpsPayerBank", "wpsPayerIban"] as const).map(key => {
        const fieldId = `company-${key}`;
        return <label htmlFor={fieldId} key={key}>{labelize(key)}<input id={fieldId} name={fieldId} value={company[key]} onChange={event => setCompany(prev => ({ ...prev, [key]: event.target.value }))} /></label>;
      })}
    </div></div>}
    {canManageDepartments && sections.visible("departments") && <div className="panel"><div className="panel-head"><h3>Departments</h3></div><textarea id="settings-departments" name="settings-departments" aria-label="Departments" value={departments} onChange={event => setDepartments(event.target.value)} /></div>}
    {canConfigureLeave && sections.visible("leave-types") && <div className="panel"><div className="panel-head"><h3>Leave Types</h3><span>Format: Name:days</span></div><textarea id="settings-leave-types" name="settings-leave-types" aria-label="Leave types" value={leaveTypes} onChange={event => setLeaveTypes(event.target.value)} /></div>}
    {canConfigureSystem && sections.visible("payroll-policy") && <div className="panel"><div className="panel-head"><h3>Attendance Defaults</h3><span>Used for manual attendance</span></div><div className="form-grid compact"><label>Full day hours<input type="number" min="0.25" step="0.25" value={workdayHours} onChange={event => setWorkdayHours(Number(event.target.value))} /></label><label>Half-day hours<input type="number" min="0.25" step="0.25" max={workdayHours} value={halfDayHours} onChange={event => setHalfDayHours(Number(event.target.value))} /></label></div></div>}
    {canConfigureSystem && sections.visible("loan-policy") && <div className="panel"><div className="panel-head"><h3>Loan Deduction Limit</h3><span>Per employee, per payroll month</span></div><div className="form-grid compact"><label>Limit type<select value={loanCapType} onChange={event => setLoanCapType(event.target.value as "Amount" | "Percent")}><option>Amount</option><option>Percent</option></select></label><label>{loanCapType === "Percent" ? "Maximum % of gross salary" : `Maximum ${state.settings.company.currency} per month`}<input type="number" min="0" max={loanCapType === "Percent" ? 100 : undefined} step="0.01" value={loanCapValue} onChange={event => setLoanCapValue(Number(event.target.value) || 0)} /></label></div><p className="muted">Enter 0 for no company-wide cap. Individual loans can have a lower limit.</p></div>}
    {canConfigureSystem && sections.visible("payroll-policy") && <div className="panel"><div className="panel-head"><h3>Payroll Controls</h3><span>These values are snapshotted on every run.</span></div><div className="form-grid compact"><label>Proration basis<select value={payrollProrationBasis} onChange={event => setPayrollProrationBasis(event.target.value as "Fixed 30" | "Calendar Days")}><option>Fixed 30</option><option>Calendar Days</option></select></label><label>Net pay variance warning (%)<input type="number" min="0" max="1000" step="0.01" value={payrollVarianceThreshold} onChange={event => setPayrollVarianceThreshold(Number(event.target.value) || 0)} /></label><label className="checkbox-row"><input type="checkbox" checked={payrollRequireBankDetails} onChange={event => setPayrollRequireBankDetails(event.target.checked)} /> Require bank details before payroll</label><label className="checkbox-row"><input type="checkbox" checked={payrollRequireAttendance} onChange={event => setPayrollRequireAttendance(event.target.checked)} /> Block payroll when attendance is missing</label></div><p className="muted">Bank data is required by default. Attendance can remain a warning while the rollout is in progress.</p></div>}
    {canSaveOrganizationSettings && <div className="panel"><div className="panel-head"><h3>Save Changes</h3></div><p className="muted">Save company, attendance, loan, department and leave settings.</p><button className="primary" onClick={saveSettings}>Save settings</button></div>}
  </section>;
}

type AuthSessionRecord = {
  id: string; provider: string; userAgent?: string | null; createdAt: string; lastSeenAt: string;
  expiresAt: string; revokedAt?: string | null; current?: boolean;
};

function SignedInDevicesPanel({ session, notify }: { session: BackendSession; notify: (message: string) => void }) {
  const { search } = usePageSearch();
  const sessions = useQuery({
    queryKey: ["auth-sessions", session.sessionId, session.authorizationVersion, search],
    queryFn: () => apiRequest<AuthSessionRecord[]>(pageSearchPath("/auth/sessions", search)),
    enabled: hasPermission(session, "session.self.read")
  });
  usePageSearchStatus("own-sessions", { count: sessions.data?.length, loading: sessions.isFetching, error: sessions.error?.message });

  async function revoke(id: string) {
    await apiRequest(`/auth/sessions/${id}`, { method: "DELETE", csrfToken: session.csrfToken });
    if (id === session.sessionId) window.dispatchEvent(new Event(authorizationExpiredEvent));
    else await sessions.refetch();
    notify("Session revoked.");
  }

  if (!hasPermission(session, "session.self.read")) return null;
  return <section className="panel"><div className="panel-head"><div><h3>Signed-in devices</h3><span>Revoke sessions you no longer use.</span></div></div>
    {sessions.isPending ? <p className="muted">Loading sessions...</p> : sessions.isError ? <p className="muted">{errorMessage(sessions.error)}</p> : <div className="list-stack">{sessions.data?.map(item => <div className="list-row" key={item.id}><div><strong>{item.current ? "This device" : item.provider}</strong><span>{item.userAgent || "Unknown browser"}</span></div>{!item.revokedAt && hasPermission(session, "session.self.revoke") && <button type="button" onClick={() => void revoke(item.id).catch(error => notify(errorMessage(error)))}>Revoke</button>}</div>)}</div>}
  </section>;
}

function DataTable({ columns, rows, empty, label = "Data table" }: { columns: React.ReactNode[]; rows: React.ReactNode[][]; empty?: string; label?: string }) {
  if (!rows.length) return <div className="empty">{empty || "No records."}</div>;
  const wide = columns.length >= 4;
  const actions = typeof columns.at(-1) === "string" && /actions?/i.test(String(columns.at(-1)));
  return <div className={`table-wrap${wide ? " table-wide" : ""}${actions ? " table-actions" : ""}`} role="region" aria-label={label}><table><thead><tr>{columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td data-label={typeof columns[cellIndex] === "string" ? columns[cellIndex] : `Field ${cellIndex + 1}`} key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function HeadcountDonut({ items, label = "assigned", noun = "employees" }: { items: Array<{ department: string; count: number }>; label?: string; noun?: string }) {
  const ordered = [...items].sort((left, right) => right.count - left.count || left.department.localeCompare(right.department));
  const total = ordered.reduce((sum, item) => sum + item.count, 0);
  const primary = ordered.slice(0, 5);
  const other = ordered.slice(5).reduce((sum, item) => sum + item.count, 0);
  const chartItems = other > 0 ? [...primary, { department: "Other departments", count: other }] : primary;
  const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
  let offset = 0;
  const segments = chartItems.map((item, index) => {
    const share = total ? item.count / total * 100 : 0;
    const segment = { ...item, share, offset, color: colors[index] };
    offset += share;
    return segment;
  });
  const max = Math.max(1, ...ordered.map(item => item.count));
  return <div className="headcount-visual">
    <div className="headcount-chart">
      <svg viewBox="0 0 120 120" role="img" aria-label={`${total} ${label} ${noun} across ${ordered.length} groups`}>
        <circle className="headcount-chart__track" cx="60" cy="60" r="43" pathLength="100" />
        {segments.map(segment => <circle key={segment.department} className="headcount-chart__segment" cx="60" cy="60" r="43" pathLength="100" stroke={segment.color} strokeDasharray={`${segment.share} ${100 - segment.share}`} strokeDashoffset={-segment.offset}><title>{segment.department}: {segment.count} employees</title></circle>)}
        <text className="headcount-chart__value" x="60" y="57" textAnchor="middle">{total}</text>
        <text className="headcount-chart__label" x="60" y="70" textAnchor="middle">{label}</text>
      </svg>
    </div>
    <ol className="headcount-ranking">
      {segments.map(segment => <li key={segment.department}><i style={{ background: segment.color }} /><span>{segment.department}</span><strong>{segment.count}</strong><small>{total ? Math.round(segment.count / total * 100) : 0}%</small></li>)}
    </ol>
    {ordered.length > 5 && <details className="headcount-details"><summary>View all departments</summary><div className="bars">{ordered.map(item => <div className="bar-row" key={item.department}><span>{item.department}</span><div><i style={{ width: `${Math.round(item.count / max * 100)}%` }} /></div><b>{item.count}</b></div>)}</div></details>}
  </div>;
}

function Badge({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const tone = lower.includes("active") || lower.includes("approved") || lower.includes("filled") || lower.includes("final") || lower.includes("present") ? "good" : lower.includes("pending") || lower.includes("draft") || lower.includes("review") || lower.includes("late") || lower.includes("half") || lower.includes("leave") ? "warn" : lower.includes("reject") || lower.includes("terminat") || lower.includes("absent") ? "bad" : "neutral";
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
  if (field === "E-Mail ID (Work)") return "email";
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
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function downloadDataUrl(dataUrl: string, filename: string) {
  downloadBlob(dataUrlBlob(dataUrl), filename);
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
    payroll: (value.payroll ?? []).map(item => ({ ...item, loanDeduction: item.loanDeduction ?? 0, loanDeductions: item.loanDeductions ?? [] })),
    businessTrips: value.businessTrips ?? [],
    expenses: value.expenses ?? [],
    loans: (value.loans ?? []).map(item => ({ ...item, deductionOverrides: item.deductionOverrides ?? {} })),
    loanRepayments: value.loanRepayments ?? [],
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
      halfDayHours: value.settings?.halfDayHours ?? base.settings.halfDayHours,
      loanDeductionCap: value.settings?.loanDeductionCap ?? base.settings.loanDeductionCap,
      payrollProrationBasis: value.settings?.payrollProrationBasis ?? base.settings.payrollProrationBasis,
      payrollRequireBankDetails: value.settings?.payrollRequireBankDetails ?? base.settings.payrollRequireBankDetails,
      payrollRequireAttendance: value.settings?.payrollRequireAttendance ?? base.settings.payrollRequireAttendance,
      payrollVarianceThreshold: value.settings?.payrollVarianceThreshold ?? base.settings.payrollVarianceThreshold
    }
  };
}

function RootRoute() {
  return <Outlet />;
}

function NotFoundPage() {
  useEffect(() => { document.title = "Page not found | MedTech HR ERP"; }, []);
  return <main className="workspace-gate"><section className="workspace-gate-card" role="alert">
    <FileText size={28} />
    <h1>Page not found</h1>
    <p>The requested HR module does not exist.</p>
    <Link className="button-like primary" to="/">Return to dashboard</Link>
  </section></main>;
}

const rootRoute = createRootRoute({
  component: RootRoute,
  notFoundComponent: NotFoundPage
});
const shellRoute = createRoute({ getParentRoute: () => rootRoute, id: "hr-shell", component: App });
const dashboardRoute = createRoute({ getParentRoute: () => shellRoute, path: "/" });
const meRoute = createRoute({ getParentRoute: () => shellRoute, path: "me" });
const teamRoute = createRoute({ getParentRoute: () => shellRoute, path: "team" });
const employeesRoute = createRoute({ getParentRoute: () => shellRoute, path: "employees" });
const attendanceRoute = createRoute({ getParentRoute: () => shellRoute, path: "attendance" });
const leaveRoute = createRoute({ getParentRoute: () => shellRoute, path: "leave" });
const businessTripsRoute = createRoute({ getParentRoute: () => shellRoute, path: "business-trips" });
const expensesRoute = createRoute({ getParentRoute: () => shellRoute, path: "expenses" });
const loansRoute = createRoute({ getParentRoute: () => shellRoute, path: "loans" });
const payrollRoute = createRoute({ getParentRoute: () => shellRoute, path: "payroll" });
const recruitmentRoute = createRoute({ getParentRoute: () => shellRoute, path: "recruitment" });
const eosRoute = createRoute({ getParentRoute: () => shellRoute, path: "eos" });
const documentsRoute = createRoute({ getParentRoute: () => shellRoute, path: "documents" });
const reportsRoute = createRoute({ getParentRoute: () => shellRoute, path: "reports" });
const auditRoute = createRoute({ getParentRoute: () => shellRoute, path: "audit" });
const hierarchyRoute = createRoute({ getParentRoute: () => shellRoute, path: "hierarchy" });
const systemRoute = createRoute({ getParentRoute: () => shellRoute, path: "system" });
const settingsRoute = createRoute({ getParentRoute: () => shellRoute, path: "settings" });
const routeTree = rootRoute.addChildren([
  shellRoute.addChildren([
    dashboardRoute,
    meRoute,
    teamRoute,
    employeesRoute,
    attendanceRoute,
    leaveRoute,
    businessTripsRoute,
    expensesRoute,
    loansRoute,
    payrollRoute,
    recruitmentRoute,
    eosRoute,
    documentsRoute,
    reportsRoute,
    auditRoute,
    hierarchyRoute,
    systemRoute,
    settingsRoute
  ])
]);
const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={appQueryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
);
