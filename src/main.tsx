import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
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
  Award,
  Bell,
  BriefcaseBusiness,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileText,
  GitBranch,
  GripVertical,
  HandCoins,
  ImagePlus,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Mail,
  Megaphone,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldCheck,
  Settings,
  Sun,
  Target,
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
import { NotificationsPage, NotificationsPanel } from "./features/notifications-panel";
import { CertificatesPage, PerformancePage } from "./features/people-experience";
import { AnnouncementsPage } from "./features/announcements";
import { CommandPalette, CommandTrigger, QuickCreateMenu, type CommandItem, type QuickAction } from "./features/shell-actions";
import { Dialog, useDialogCloseGuard } from "./dialog";
import { EmployeePicker, type EmployeePickerOption } from "./employee-picker";
import { Pagination } from "./pagination";
import { PageSearchBar, PageSearchProvider, rankedPageSearchItems, usePageSearch, usePageSearchStatus } from "./page-search";
import { commonSearch, operationalPageSize, paginate, settingsEditorErrors, shellSearch, statusActionLabel, type AttendanceSearch, type CommonSearch, type DepartmentDraft } from "./ui-state";
import "./styles.css";

const storageKey = "medtech-hr-erp-v1";
const themeKey = "medtech-hr-theme";
const compactNavigationQuery = "(max-width: 1280px)";
const hiredCandidateVisibilityMs = 3 * 24 * 60 * 60 * 1000;
type Theme = "light" | "dark";
type NotifyAction = { label: string; onAction: () => void };
type Notify = (message: string, action?: NotifyAction) => void;
type ConfirmAction = { title: string; description: string; confirmLabel: string; danger?: boolean; onConfirm: () => void };
type AssessmentResponse = { version: number; rating: number | string; interviewAssessment?: InterviewAssessment };
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
  "Approval Inbox": CheckCircle2,
  Notifications: Bell,
  Team: UsersRound,
  Employees: UsersRound,
  Attendance: CalendarCheck,
  Leave: BriefcaseBusiness,
  "Business Trips": BriefcaseBusiness,
  Expenses: WalletCards,
  Loans: HandCoins,
  Payroll: WalletCards,
  Recruitment: UserRoundPlus,
  Performance: Target,
  Announcements: Megaphone,
  Certificates: Award,
  EOS: FileText,
  Documents: FileText,
  Reports: BarChart3,
  Audit: ShieldCheck,
  Hierarchy: GitBranch,
  System: Settings,
  Settings
};

const navLabels: Record<NavItem, string> = {
  Dashboard: "Overview", "My HR": "My HR", "Approval Inbox": "Approval Inbox", Notifications: "Notifications",
  Team: "Team", Employees: "Employees", Hierarchy: "Org Chart", Recruitment: "Recruitment",
  Leave: "Leave", Attendance: "Attendance", Payroll: "Payroll & Payslips", Loans: "Loans & Deductions", Expenses: "Expenses", "Business Trips": "Business Trips",
  Performance: "Performance", Announcements: "Announcements", Certificates: "Certificates", Documents: "Documents",
  Reports: "Reports", EOS: "End of Service", Audit: "Audit Trail", System: "System", Settings: "Settings",
};

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  { label: "Workspace", items: ["Dashboard", "My HR", "Approval Inbox", "Notifications"] },
  { label: "People", items: ["Team", "Employees", "Hierarchy", "Recruitment"] },
  { label: "Time & Pay", items: ["Leave", "Attendance", "Payroll", "Loans", "Expenses", "Business Trips"] },
  { label: "Growth", items: ["Performance"] },
  { label: "Communication", items: ["Announcements", "Certificates", "Documents"] },
  { label: "Insights & Admin", items: ["Reports", "EOS", "Audit", "System", "Settings"] },
];

function PageLoadingSkeleton() {
  return <section className="module-loading" role="status" aria-live="polite" aria-busy="true">
    <span className="sr-only">Loading page…</span>
    <div className="module-loading__heading"><span /><span /></div>
    <div className="module-loading__metrics"><span /><span /><span /></div>
    <div className="module-loading__content"><span /><span /><span /><span /></div>
  </section>;
}

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

function LoginPage({ onLogin }: { onLogin: (session: BackendSession) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      onLogin(await loginBackend(email, password));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <div className="login-stage" aria-hidden="true"><div className="login-stage-art" /></div>
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-content">
          <div className="login-brand"><img src="/logos/medtech-lockup.svg?v=4" alt="MedTech Corporation Trading W.L.L." /></div>
          <div className="login-intro">
            <span className="login-eyebrow"><ShieldCheck size={15} /> Secure HR access</span>
            <h1 id="login-title">Welcome back</h1>
            <p>Sign in with your MedTech work account.</p>
          </div>
          <button className="microsoft-login" type="button" onClick={startMicrosoftLogin}>
            <span className="microsoft-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>Sign in with Microsoft</span>
          </button>
          <div className="login-divider" aria-hidden="true"><span>or</span></div>
          <form className="login-form" onSubmit={submit} aria-busy={busy}>
            <label htmlFor="login-email"><span>Email</span><span className="login-input"><Mail size={18} aria-hidden="true" /><input id="login-email" name="email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></span></label>
            <label htmlFor="login-password"><span>Password</span><span className="login-input"><LockKeyhole size={18} aria-hidden="true" /><input id="login-password" name="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></span></label>
            {error && <p className="login-error" role="alert"><span aria-hidden="true">!</span>{error}</p>}
            <button className="primary" type="submit" disabled={busy} aria-busy={busy}>{busy ? "Signing in..." : "Sign in"}</button>
          </form>
        </div>
        <footer className="login-footer"><ShieldCheck size={14} aria-hidden="true" /> Protected sign-in · MedTech Corporation Trading W.L.L.</footer>
      </section>
    </main>
  );
}

function App() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const routeLocation = useRouterState({ select: routerState => routerState.location });
  const nav = navItemForPath(routeLocation.pathname);
  const pageQuery = commonSearch(routeLocation.search as Record<string, unknown>).q ?? "";
  const [state, setState] = useState<HrState>(() => loadState());
  const [toast, setToast] = useState<{ message: string; action?: NotifyAction } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
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

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  useEffect(() => {
    const openCommand = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", openCommand);
    return () => window.removeEventListener("keydown", openCommand);
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

  function dismissToast() {
    window.clearTimeout(toastTimer.current);
    setToast(null);
  }

  function notify(message: string, action?: NotifyAction) {
    window.clearTimeout(toastTimer.current);
    setToast({ message, action });
    toastTimer.current = window.setTimeout(() => setToast(null), action ? 5000 : 2400);
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
    downloadDataUrl(file.dataUrl, file.filename);
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

  function setPageQuery(value: string) {
    if (value === pageQuery) return;
    void navigate({
      to: routeLocation.pathname as never,
      search: ((current: CommonSearch & AttendanceSearch) => ({
        ...current,
        q: value || undefined,
        ...(nav === "Team" ? { page: 1 } : {}),
        ...(nav === "Attendance" ? { page: 1, summaryPage: 1 } : {}),
      })) as never,
      replace: true,
    });
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
        <LoginPage onLogin={session => { setBackendSession(session); notify(`Signed in as ${session.email}.`); }} />
        <Toast toast={toast} dismiss={dismissToast} />
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
  const openEmployeeCreate = () => {
    setNav("Employees");
    setModal(<EmployeeEditor state={state} close={closeModal} notify={notify} save={employee => setState(previous => upsertEmployee(previous, employee))} />);
  };
  const openWithIntent = (destination: NavItem, hash: string) => void navigate({ to: navPaths[destination], hash });
  const quickActions: QuickAction[] = [
    ...(hasPermission(backendSession, "employee.hr.create") ? [{ id: "new-employee", label: "Employee", hint: "Create a direct employee record", kind: "employee" as const, onSelect: openEmployeeCreate }] : []),
    ...(hasPermission(backendSession, "announcement.manage") ? [{ id: "new-announcement", label: "Announcement", hint: "Draft a company update", kind: "announcement" as const, onSelect: () => openWithIntent("Announcements", "new") }] : []),
    ...(canAccessRoute(backendSession, "Approval Inbox") ? [{ id: "open-approvals", label: "Approval inbox", hint: "Review assigned decisions", kind: "approval" as const, onSelect: () => setNav("Approval Inbox") }] : []),
  ];
  const commandItems: CommandItem[] = [
    ...visibleNavItems.map(item => ({ id: `nav-${item}`, label: navLabels[item], hint: pageDescription(item), keywords: `${item} ${navGroups.find(group => group.items.includes(item))?.label ?? ""}`, onSelect: () => setNav(item) })),
    ...quickActions.map(action => ({ id: `create-${action.id}`, label: `Create ${action.label}`, hint: action.hint, keywords: "new quick create", onSelect: action.onSelect })),
  ];
  const pageHint = pageDescription(nav);
  const navigationHidden = compactNavigation && !sidebarOpen;
  const pageLayout = nav === "My HR" || nav === "Settings"
    ? "focused"
    : ["Dashboard", "Approval Inbox", "Notifications", "Employees", "Attendance", "Leave", "Payroll", "Recruitment", "Performance", "Announcements", "Certificates", "Audit", "Hierarchy", "System"].includes(nav)
      ? "wide"
      : "standard";

  return (
    <AuthorizationProvider session={backendSession}><PageSearchProvider key={nav} page={nav} query={pageQuery} onQueryChange={setPageQuery}><div className={`app${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside
        id="main-navigation"
        className={`sidebar ${sidebarOpen ? "open" : ""}`}
        aria-label="Main navigation"
        aria-hidden={navigationHidden ? true : undefined}
        inert={navigationHidden ? true : undefined}
      >
        <div className="brand-block">
          <span className="logo-crop wordmark"><img src="/logos/medtech-lockup.svg?v=4" alt="MedTech Corporation Trading W.L.L." /></span>
          <button ref={sidebarCloseRef} className="sidebar-close" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        </div>
        <nav className="nav-list" aria-label="HR modules">
          {navGroups.map(group => {
            const items = group.items.filter(item => visibleNavItems.includes(item));
            if (!items.length) return null;
            return <div className="nav-group" key={group.label}><span className="nav-group__label">{group.label}</span>{items.map(item => {
              const Icon = navIcon[item];
              return <Link key={item} to={navPaths[item]} className={item === nav ? "active" : ""} aria-label={navLabels[item]} title={navLabels[item]} aria-current={item === nav ? "page" : undefined} onClick={() => setSidebarOpen(false)}><Icon size={18} /><span>{navLabels[item]}</span></Link>;
            })}</div>;
          })}
        </nav>
        <AccountMenu
          variant="sidebar"
          state={state}
          backendSession={backendSession}
          onLogout={() => void logout()}
          setNav={setNav}
          theme={theme}
          toggleTheme={toggleTheme}
        />
      </aside>

      <main id="main-content" className={`workspace page-layout-${pageLayout}`}>
        {syncError && !syncAlertDismissed && <div className="sync-alert" role="alert">
          <span><strong>Changes are not saved.</strong> {syncError}</span>
          <button type="button" onClick={() => void retrySave()}>Retry save</button>
          <button type="button" aria-label="Dismiss save error" title="Dismiss" onClick={() => setSyncAlertDismissed(true)}><X size={16} /></button>
        </div>}
        <header className="topbar">
          <div className="topbar-inner">
            <button ref={mobileMenuRef} className="mobile-menu" type="button" aria-label="Open menu" aria-controls="main-navigation" aria-expanded={sidebarOpen} onClick={() => { setSidebarCollapsed(false); setSidebarOpen(true); }}><Menu size={20} /></button>
            <div className="topbar-heading">
              <span className="topbar-brand-mark" aria-hidden="true"><img src="/logos/medtech-lockup.svg?v=4" alt="" /></span>
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
                <h1><span>MedTech People</span><b aria-hidden="true">/</b>{navLabels[nav]}</h1>
                <p className="page-hint">{pageHint}</p>
              </div>
            </div>
            {nav === "Employees"
              ? <CommandTrigger open={() => setCommandOpen(true)} />
              : <PageSearchBar page={nav} openCommand={() => setCommandOpen(true)} />}
            <div className="topbar-actions">
              <QuickCreateMenu actions={quickActions} />
              <NotificationsPanel session={backendSession} notify={notify} />
              <button className="icon-button" type="button" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"}>
                {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <AccountMenu
                variant="topbar"
                state={state}
                backendSession={backendSession}
                onLogout={() => void logout()}
                setNav={setNav}
                theme={theme}
                toggleTheme={toggleTheme}
              />
            </div>
          </div>
        </header>

        <div className={`content${nav === "Hierarchy" ? " hierarchy-content" : ""}`}><React.Suspense fallback={<PageLoadingSkeleton />}>
          {nav === "Dashboard" && <Dashboard state={state} session={backendSession} setNav={setNav} notify={notify} openCommand={() => setCommandOpen(true)} quickActions={quickActions} canAddEmployee={hasPermission(backendSession, "employee.hr.create")} canRunPayroll={hasPermission(backendSession, "payroll.generate")} canOpenPayroll={canAccessRoute(backendSession, "Payroll")} onAddEmployee={() => {
            setNav("Employees");
            setModal(<EmployeeEditor state={state} close={closeModal} notify={notify} save={employee => setState(prev => upsertEmployee(prev, employee))} />);
          }} />}
          {nav === "My HR" && <MyHrPage state={state} session={backendSession} notify={notify} refreshWorkspace={refreshWorkspace} onOpenLeave={() => setNav("Leave")} />}
          {nav === "Approval Inbox" && <div className="experience-page"><section className="feature-heading"><div><span className="eyebrow">Workspace · Approvals</span><h2>Approval inbox</h2><p>Review decisions assigned to you across leave, certificates and payroll.</p></div></section><div className="workflow-page-grid"><ApprovalInboxPanel session={backendSession} notify={notify} /></div></div>}
          {nav === "Notifications" && <NotificationsPage session={backendSession} notify={notify} />}
          {nav === "Team" && <TeamPage state={state} session={backendSession} notify={notify} />}
          {nav === "Employees" && <Employees state={state} setState={setState} setModal={setModal} notify={notify} close={closeModal} savePdf={savePdf} canCreate={hasPermission(backendSession, "employee.hr.create")} canUpdate={hasPermission(backendSession, "employee.hr.update")} canTerminate={hasPermission(backendSession, "employee.hr.terminate")} canImport={hasAllPermissions(backendSession, "import.run", "employee.hr.create", "employee.hr.update", "employee.hr.read_sensitive", "department.manage", "position.manage", "payroll.configure")} canExport={hasAnyPermission(backendSession, "report.export", "audit.export")} canViewSalary={canViewSalary} session={backendSession} refreshWorkspace={refreshWorkspace} />}
          {nav === "Attendance" && <Attendance state={state} setState={setState} savePdf={savePdf} notify={notify} canManage={canManageAttendance} canExport={hasAnyPermission(backendSession, "report.export", "audit.export")} />}
          {nav === "Leave" && <LeaveWorkflowPage session={backendSession} notify={notify} />}
          {nav === "Business Trips" && <BusinessTrips state={state} setState={setState} notify={notify} />}
          {nav === "Expenses" && <Expenses state={state} setState={setState} notify={notify} />}
          {nav === "Loans" && <Loans state={state} setState={setState} setModal={setModal} notify={notify} close={closeModal} canOverrideLimit={canManageLoans} />}
          {nav === "Payroll" && <PayrollWorkflowPage session={backendSession} notify={notify} />}
          {nav === "Recruitment" && <Recruitment state={state} setState={setState} notify={notify} setNav={setNav} />}
          {nav === "Performance" && <PerformancePage session={backendSession} employees={state.employees} notify={notify} />}
          {nav === "Announcements" && <AnnouncementsPage session={backendSession} notify={notify} />}
          {nav === "Certificates" && <CertificatesPage session={backendSession} notify={notify} />}
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

      <nav className="mobile-bottom-nav" aria-label="Quick navigation">{(["Dashboard", "My HR", "Leave", "Notifications"] as NavItem[]).filter(item => visibleNavItems.includes(item)).map(item => { const Icon = navIcon[item]; return <Link key={item} to={navPaths[item]} className={nav === item ? "active" : ""} aria-current={nav === item ? "page" : undefined}><Icon size={19} /><span>{navLabels[item]}</span></Link>; })}</nav>
      {compactNavigation && sidebarOpen && <button type="button" aria-label="Close menu" className="scrim" onClick={() => setSidebarOpen(false)} />}
      {modal && <Dialog onClose={closeModal}>{modal}</Dialog>}
      <CommandPalette open={commandOpen} items={commandItems} pageLabel={navLabels[nav]} close={() => setCommandOpen(false)} searchPage={setPageQuery} />
      <Toast toast={toast} dismiss={dismissToast} />
    </div></PageSearchProvider></AuthorizationProvider>
  );
}

function AccountMenu({
  variant = "topbar",
  state,
  backendSession,
  onLogout,
  setNav,
  theme,
  toggleTheme
}: {
  variant?: "sidebar" | "topbar";
  state: HrState;
  backendSession: BackendSession;
  onLogout: () => void;
  setNav: (nav: NavItem) => void;
  theme: Theme;
  toggleTheme: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
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

  return <div className={`account-menu account-menu--${variant}`}>
    {open && <div id={menuId} ref={popoverRef} className="account-popover" role="menu" aria-label="Account options" onKeyDown={event => {
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
    <button ref={triggerRef} className="account-trigger" aria-label="Open account menu" title={backendSession.displayName || backendSession.email} aria-haspopup="menu" aria-controls={menuId} aria-expanded={open} onClick={() => setOpen(prev => !prev)}>
      <span className="account-avatar">{photo ? <img src={photo} alt="" /> : accountInitials(backendSession.email)}</span>
      {variant === "sidebar" && <span className="account-label"><strong>{backendSession.displayName || backendSession.email}</strong><small>{backendSession.roles[0] || "User"}</small></span>}
      {variant === "sidebar" && <ChevronRight size={17} aria-hidden="true" />}
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
  const search = teamRoute.useSearch();
  const navigate = teamRoute.useNavigate();
  const matches = usePageSearchList<{ id: string }>("team-employees", "/employees");
  const employees = rankedPageSearchItems(state.employees, matches.data, searchActive, employee => employee.id, match => match.id);
  const requestedPage = search.page ?? 1;
  const page = paginate(employees, requestedPage);
  useEffect(() => {
    if (page.page !== requestedPage) void navigate({ search: current => ({ ...current, page: page.page }), replace: true });
  }, [navigate, page.page, requestedPage]);
  return <div className="dashboard-grid">
    <Metric label="PEOPLE IN SCOPE" value={state.employees.length} hint="Direct reports and managed departments" />
    <section className="panel span-2"><div className="panel-head"><div><h3>People in your scope</h3><span>Compensation, bank and confidential HR fields are not included.</span></div></div>
      <DataTable label="People in scope" empty="No team members match this search." columns={["Employee", "Department", "Status", "Joined"]} rows={page.items.map(employee => [employeeName(employee), employee.fields.Department || "-", employee.status, formatDate(employee.fields["Joining Date"])])} />
      {employees.length > operationalPageSize && <Pagination total={employees.length} page={page.page} limit={operationalPageSize} totalPages={page.totalPages} label="team members" onPage={next => void navigate({ search: current => ({ ...current, page: next }) })} />}
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

function Dashboard({ state, session, setNav, notify, openCommand, quickActions, onAddEmployee, canAddEmployee, canRunPayroll, canOpenPayroll }: { state: HrState; session: BackendSession; setNav: (nav: NavItem) => void; notify: (message: string) => void; openCommand: () => void; quickActions: QuickAction[]; onAddEmployee: () => void; canAddEmployee: boolean; canRunPayroll: boolean; canOpenPayroll: boolean }) {
  const { search, active: searchActive } = usePageSearch();
  const persona = dashboardPersona(session);
  const [roleLabel, roleSubtitle] = dashboardRoleCopy(persona);
  const personalDashboard = persona === "employee";
  const managementDashboard = persona === "line-manager" || persona === "manager";
  const operationalDashboard = persona === "hr";
  const executiveDashboard = persona === "cpo" || persona === "coo";
  const canReadScopedEmployees = !personalDashboard && hasAnyPermission(session, "employee.team.read", "employee.management.read", "employee.hr.read", "employee.read_all");
  const employeeSearch = usePageSearchList<{ id: string }>("dashboard-employees", "/employees", canReadScopedEmployees);
  const active = activeEmployees(state.employees);
  const matchingActive = rankedPageSearchItems(active, employeeSearch.data, searchActive, employee => employee.id, match => match.id);
  const todayValue = todayISO();
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
  const canReadRecruitment = persona === "cpo" && hasPermission(session, "recruitment.read");
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
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekValue = todayISO(nextWeek);
  const leaveStartingSoon = upcomingLeave.filter(item => item.startDate > todayValue && item.startDate <= nextWeekValue);
  const recentLeaveActivity = [...visibleLeaves].sort((left, right) => right.startDate.localeCompare(left.startDate)).slice(0, 6);
  const attendanceRecorded = attendance.data?.summary.totalRecords ?? 0;
  const attendanceCompliance = attendanceRecorded ? Math.round((attendancePresent / attendanceRecorded) * 100) : null;
  const activeCandidates = state.candidates.filter(candidate => candidate.stage !== "Hired" && candidate.stage !== "Rejected").length;
  const canOpenLeave = canAccessRoute(session, "Leave") && hasPermission(session, "leave.self.create");
  const canOpenMyHr = canAccessRoute(session, "My HR");
  const canOpenDocuments = canAccessRoute(session, "Documents");
  const canOpenAttendance = operationalDashboard && canAccessRoute(session, "Attendance");
  const canOpenEmployees = operationalDashboard && canAccessRoute(session, "Employees");
  const canOpenTeam = managementDashboard && canAccessRoute(session, "Team");
  const canOpenRecruitment = canReadRecruitment && canAccessRoute(session, "Recruitment");

  const approvalQueue = canOpenApprovalInbox ? <div className="dashboard-row dashboard-row--single dashboard-row--priority" data-dashboard-widget="approval-inbox"><ApprovalInboxPanel session={session} notify={notify} /></div> : null;
  const workforcePanel = canReadScopedEmployees ? <section className="panel headcount-panel dashboard-widget" data-dashboard-widget="workforce-distribution"><div className="panel-head"><div><h3>{persona === "manager" ? "Management scope" : persona === "cpo" ? "People organization" : persona === "coo" ? "Organization by department" : "Workforce distribution"}</h3><span>{active.length} active employees in your permitted scope</span></div></div>{headcount.length ? <HeadcountDonut items={headcount} label={managementDashboard ? "in scope" : "active"} noun="employees" /> : <div className="empty">No employee distribution is available.</div>}</section> : null;
  const availabilityPanel = broadLeave ? <section className="panel dashboard-widget" data-dashboard-widget="leave-availability"><div className="panel-head"><div><h3>{persona === "line-manager" ? "Team availability" : persona === "manager" ? "Upcoming scoped leave" : persona === "coo" ? "Organization leave outlook" : "Leave overview"}</h3><span>{upcomingLeave.length} current or upcoming approved record(s)</span></div>{canAccessRoute(session, "Leave") && <button type="button" onClick={() => setNav("Leave")}>View leave</button>}</div>
    <DataTable label="Approved leave availability" empty="No current or upcoming approved leave." columns={["Employee", "Leave type", "Dates", "Days"]} rows={upcomingLeave.slice(0, 6).map(leave => [`${leave.employee.firstName} ${leave.employee.lastName}`, leave.leaveType.name, `${formatDate(leave.startDate)} – ${formatDate(leave.endDate)}`, leave.totalDays])} />
  </section> : null;
  const leaveDistributionPanel = broadLeave ? <section className="panel dashboard-widget" data-dashboard-widget="leave-distribution"><div className="panel-head"><div><h3>{persona === "cpo" ? "People leave distribution" : persona === "coo" ? "Organization leave summary" : "Leave distribution"}</h3><span>Requests visible within your current scope.</span></div></div>{leaveDistribution.length ? <HeadcountDonut items={leaveDistribution} label="requests" noun="records" /> : <div className="empty">No leave requests are available.</div>}</section> : null;
  const attendancePanel = canReadAttendanceSummary ? <section className="panel dashboard-attendance-panel dashboard-widget" data-dashboard-widget="attendance-summary"><div className="panel-head"><div><h3>{executiveDashboard ? "Attendance and compliance" : "Attendance overview"}</h3><span>High-level organization summary only.</span></div>{canOpenAttendance && <button type="button" onClick={() => setNav("Attendance")}>Open attendance</button>}</div>
    {attendance.isPending ? <div className="empty">Loading attendance…</div> : attendance.isError ? <div className="empty">Attendance could not be loaded.</div> : <div className="dashboard-attendance-summary">{executiveDashboard && <div><span>Coverage</span><strong>{attendanceCompliance === null ? "—" : `${attendanceCompliance}%`}</strong></div>}<div><span>Present</span><strong>{attendancePresent}</strong></div><div><span>Absent</span><strong>{attendanceAbsent}</strong></div><div><span>Late</span><strong>{attendanceLate}</strong></div></div>}
  </section> : null;

  return (
    <div className="dashboard-layout" data-dashboard-persona={persona}>
      <section className="dashboard-page-heading">
        <div><span className="eyebrow">Workspace</span><h2>{operationalDashboard ? "People operations, at a glance" : `${roleLabel} overview`}</h2><p>{operationalDashboard ? `Live information for Human Resources · ${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}` : roleSubtitle}</p></div>
        <div className="feature-actions"><button onClick={openCommand}><Search size={16} /> Search</button>{quickActions.length > 0 && <QuickCreateMenu actions={quickActions} />}</div>
      </section>
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="section-label">MedTech People · {roleLabel}</p>
          <h2>{operationalDashboard ? "Every people decision, in focus." : `${dashboardGreeting()}, ${session.displayName || session.email}`}</h2>
          <p>{operationalDashboard ? "Headcount, attendance, payroll and talent signals are aligned so you can act with confidence." : roleSubtitle}</p>
        </div>
        <div className="hero-signal" aria-hidden="true"><svg viewBox="0 0 420 160" preserveAspectRatio="none"><path d="M0 125 C70 100 85 70 145 84 S220 125 270 55 S340 58 420 30" /><circle cx="420" cy="30" r="5" /></svg></div>
        <div className="dashboard-snapshot">
          <span>Today’s brief</span>
          <strong><time dateTime={todayValue}>{formatDate(todayValue)}</time></strong>
          <dl>
            {persona === "employee" && <>
              {canReadLeave && <div><dt>Leave requests</dt><dd>{pendingLeave.length} pending</dd></div>}
              {canReadPersonalDocuments && <div><dt>Documents</dt><dd>{state.documents.length} available</dd></div>}
              {canReadLeave && <div><dt>Next leave</dt><dd>{upcomingLeave[0] ? formatDate(upcomingLeave[0].startDate) : "None scheduled"}</dd></div>}
            </>}
            {persona === "line-manager" && <>
              {canOpenApprovalInbox && <div><dt>Team approvals</dt><dd>{approvalCount} assigned</dd></div>}
              {broadLeave && <div><dt>Away today</dt><dd>{onLeaveToday.length} people</dd></div>}
              {broadLeave && <div><dt>Next 7 days</dt><dd>{leaveStartingSoon.length} starting</dd></div>}
            </>}
            {persona === "manager" && <>
              {canOpenApprovalInbox && <div><dt>Decisions</dt><dd>{approvalCount} assigned</dd></div>}
              {broadLeave && <div><dt>Leave today</dt><dd>{onLeaveToday.length} people</dd></div>}
              {canReadScopedEmployees && <div><dt>Departments</dt><dd>{headcount.length} in scope</dd></div>}
            </>}
            {persona === "hr" && <>
              {canOpenApprovalInbox && <div><dt>Approvals</dt><dd>{approvalCount} assigned</dd></div>}
              {broadLeave && <div><dt>Leave today</dt><dd>{onLeaveToday.length} people</dd></div>}
              {canReadAttendanceSummary && <div><dt>Attendance</dt><dd>{attendance.isPending ? "Loading…" : `${attendancePresent} present`}</dd></div>}
            </>}
            {persona === "cpo" && <>
              {canOpenApprovalInbox && <div><dt>Executive queue</dt><dd>{approvalCount} assigned</dd></div>}
              {canReadRecruitment && <div><dt>Open positions</dt><dd>{openPositions} vacancies</dd></div>}
              {canReadAttendanceSummary && <div><dt>Attendance</dt><dd>{attendance.isPending ? "Loading…" : attendanceCompliance === null ? "No records" : `${attendanceCompliance}% coverage`}</dd></div>}
            </>}
            {persona === "coo" && <>
              {canOpenApprovalInbox && <div><dt>Final approvals</dt><dd>{approvalCount} assigned</dd></div>}
              {canReadScopedEmployees && <div><dt>Departments</dt><dd>{headcount.length} active</dd></div>}
              {canReadAttendanceSummary && <div><dt>Attendance</dt><dd>{attendance.isPending ? "Loading…" : attendanceCompliance === null ? "No records" : `${attendanceCompliance}% coverage`}</dd></div>}
            </>}
          </dl>
        </div>
        <div className="hero-actions">
          {canOpenLeave && <button className="primary" onClick={() => setNav("Leave")}><CalendarCheck size={17} /> Apply leave</button>}
          {canOpenMyHr && <button onClick={() => setNav("My HR")}>My profile</button>}
          {personalDashboard && canOpenDocuments && <button onClick={() => setNav("Documents")}><FileText size={17} /> Documents</button>}
          {managementDashboard && canOpenApprovalInbox && <button onClick={() => setNav("Approval Inbox")}>Review approvals</button>}
          {canOpenTeam && <button onClick={() => setNav("Team")}><UsersRound size={17} /> View team</button>}
          {operationalDashboard && canAddEmployee && <button onClick={onAddEmployee}><UserRoundPlus size={17} /> Add employee</button>}
          {canOpenEmployees && <button onClick={() => setNav("Employees")}><UsersRound size={17} /> View employees</button>}
          {canOpenAttendance && <button onClick={() => setNav("Attendance")}><CalendarCheck size={17} /> View attendance</button>}
          {operationalDashboard && canOpenPayroll && <button onClick={() => setNav("Payroll")}><WalletCards size={17} /> {canRunPayroll ? "Run payroll" : "View payroll"}</button>}
          {canOpenRecruitment && <button onClick={() => setNav("Recruitment")}><BriefcaseBusiness size={17} /> Recruitment</button>}
          {executiveDashboard && canOpenApprovalInbox && <button onClick={() => setNav("Approval Inbox")}>Review approvals</button>}
        </div>
      </section>

      <section className="metric-grid">
        {persona === "employee" && <>
          {canReadPersonalBalances && <Metric label="Leave balance" value={balances.isPending ? "…" : `${availableLeaveDays} days`} hint="across eligible leave types" icon={<CalendarCheck size={17} />} />}
          {canReadLeave && <Metric label="Pending leave" value={pendingLeave.length} hint="personal requests in progress" tone={pendingLeave.length ? "warn" : "ok"} icon={<LayoutDashboard size={17} />} />}
          {canReadPersonalDocuments && <Metric label="Latest document" value={latestDocument ? formatDate(latestDocument.generatedOn) : "—"} hint={latestDocument?.filename || "No documents yet"} icon={<FileText size={17} />} />}
          {canReadPersonalRequests && <Metric label="Certificate requests" value={serviceRequests.data?.meta?.total ?? "—"} hint="salary, experience and clearance" icon={<BriefcaseBusiness size={17} />} />}
        </>}
        {persona === "line-manager" && <>
          {canReadScopedEmployees && <Metric label="Direct team" value={active.length} hint="active people in your scope" icon={<UsersRound size={17} />} />}
          {canOpenApprovalInbox && <Metric label="Awaiting decision" value={approvalInbox.isPending ? "…" : approvalCount} hint="items assigned to you" tone={approvalCount ? "warn" : "ok"} icon={<ShieldCheck size={17} />} />}
          {broadLeave && <Metric label="Away today" value={onLeaveToday.length} hint="approved team leave" icon={<CalendarCheck size={17} />} />}
          {broadLeave && <Metric label="Starting soon" value={leaveStartingSoon.length} hint="approved leave in the next 7 days" icon={<LayoutDashboard size={17} />} />}
        </>}
        {persona === "manager" && <>
          {canReadScopedEmployees && <Metric label="Management scope" value={active.length} hint="active employees visible to you" icon={<UsersRound size={17} />} />}
          {canOpenApprovalInbox && <Metric label="Pending decisions" value={approvalInbox.isPending ? "…" : approvalCount} hint="currently assigned to you" tone={approvalCount ? "warn" : "ok"} icon={<ShieldCheck size={17} />} />}
          {broadLeave && <Metric label="On leave today" value={onLeaveToday.length} hint="approved leave in scope" icon={<CalendarCheck size={17} />} />}
          {broadLeave && <Metric label="Upcoming leave" value={leaveStartingSoon.length} hint="starting within 7 days" icon={<LayoutDashboard size={17} />} />}
          {canReadScopedEmployees && <Metric label="Departments" value={headcount.length} hint="represented in your scope" icon={<BriefcaseBusiness size={17} />} />}
        </>}
        {persona === "hr" && <>
          {canReadScopedEmployees && <Metric label="Active workforce" value={active.length} hint={`${state.employees.length - active.length} inactive records`} icon={<UsersRound size={17} />} />}
          {canOpenApprovalInbox && <Metric label="Pending actions" value={approvalInbox.isPending ? "…" : approvalCount} hint="currently assigned to you" tone={approvalCount ? "warn" : "ok"} icon={<ShieldCheck size={17} />} />}
          {broadLeave && <Metric label="On leave today" value={onLeaveToday.length} hint="approved leave within HR scope" icon={<CalendarCheck size={17} />} />}
          {canReadScopedEmployees && <Metric label="Recent joiners" value={recentJoiners.length} hint="latest employee records" icon={<UserRoundPlus size={17} />} />}
          {canReadPayrollDashboard && <Metric label="Payroll runs" value={payrollRuns.isPending ? "…" : currentPayroll.length} hint="for the current month" icon={<WalletCards size={17} />} />}
          {canReadAttendanceSummary && <Metric label="Attendance today" value={attendance.isPending ? "…" : attendancePresent} hint={`${attendanceAbsent} absent · ${attendanceLate} late`} tone={attendanceAbsent ? "warn" : "ok"} icon={<CalendarCheck size={17} />} />}
        </>}
        {persona === "cpo" && <>
          {canReadScopedEmployees && <Metric label="People workforce" value={active.length} hint={`${state.employees.length - active.length} inactive records`} icon={<UsersRound size={17} />} />}
          {canReadRecruitment && <Metric label="Open positions" value={openPositions} hint="remaining active vacancies" icon={<BriefcaseBusiness size={17} />} />}
          {canReadRecruitment && <Metric label="Active candidates" value={activeCandidates} hint="not hired or rejected" icon={<UserRoundPlus size={17} />} />}
          {canOpenApprovalInbox && <Metric label="Executive approvals" value={approvalInbox.isPending ? "…" : approvalCount} hint="currently assigned to you" tone={approvalCount ? "warn" : "ok"} icon={<ShieldCheck size={17} />} />}
          {canReadAttendanceSummary && <Metric label="Attendance coverage" value={attendance.isPending ? "…" : attendanceCompliance === null ? "—" : `${attendanceCompliance}%`} hint={`${attendanceAbsent} absent · ${attendanceLate} late`} tone={attendanceAbsent ? "warn" : "ok"} icon={<CalendarCheck size={17} />} />}
          {broadLeave && <Metric label="On leave today" value={onLeaveToday.length} hint="approved organization leave" icon={<LayoutDashboard size={17} />} />}
        </>}
        {persona === "coo" && <>
          {canReadScopedEmployees && <Metric label="Organization headcount" value={active.length} hint={`${state.employees.length - active.length} inactive records`} icon={<UsersRound size={17} />} />}
          {canReadScopedEmployees && <Metric label="Departments" value={headcount.length} hint="organizational units in scope" icon={<BriefcaseBusiness size={17} />} />}
          {canOpenApprovalInbox && <Metric label="Final approvals" value={approvalInbox.isPending ? "…" : approvalCount} hint="currently assigned to you" tone={approvalCount ? "warn" : "ok"} icon={<ShieldCheck size={17} />} />}
          {canReadAttendanceSummary && <Metric label="Attendance coverage" value={attendance.isPending ? "…" : attendanceCompliance === null ? "—" : `${attendanceCompliance}%`} hint={`${attendanceAbsent} absent · ${attendanceLate} late`} tone={attendanceAbsent ? "warn" : "ok"} icon={<CalendarCheck size={17} />} />}
          {broadLeave && <Metric label="On leave today" value={onLeaveToday.length} hint="approved organization leave" icon={<CalendarCheck size={17} />} />}
          {broadLeave && <Metric label="Starting soon" value={leaveStartingSoon.length} hint="approved leave in the next 7 days" icon={<LayoutDashboard size={17} />} />}
        </>}
      </section>

      {persona === "employee" && <>
        <div className="dashboard-row dashboard-row--two">
          {canReadPersonalBalances && <section className="panel dashboard-balance-panel dashboard-widget" data-dashboard-widget="personal-leave-balance"><div className="panel-head"><div><h3>My leave balance</h3><span>Current-year availability by leave type.</span></div><button type="button" onClick={() => setNav("Leave")}>View Leave</button></div>
            {balances.isPending ? <div className="empty">Loading leave balances…</div> : balances.isError ? <div className="empty">Leave balances could not be loaded.</div> : <div className="dashboard-balance-list">{balances.data?.filter(balance => balance.eligible).map(balance => <div key={balance.leaveType.name}><span>{balance.leaveType.name}</span><strong>{balance.noBalanceRequired ? "No balance required" : `${balance.availableDays} days`}</strong><small>{balance.noBalanceRequired ? "Not deducted from annual allowance" : `${balance.usedDays} used · ${balance.pendingDays} pending`}</small></div>)}{!balances.data?.filter(balance => balance.eligible).length && <div className="empty compact">No available leave balances.</div>}</div>}
          </section>}
          {canReadLeave && <div className="dashboard-embedded-panel" data-dashboard-widget="personal-leave-status"><MyLeaveStatusPanel session={session} onOpenLeave={() => setNav("Leave")} /></div>}
        </div>
        <div className="dashboard-row dashboard-row--two">
          {canReadPersonalRequests && <section className="panel dashboard-widget" data-dashboard-widget="personal-requests"><div className="panel-head"><div><h3>My recent requests</h3><span>Leave and certificate activity that belongs to you.</span></div>{canOpenDocuments && <button type="button" onClick={() => setNav("Documents")}>Request certificate</button>}</div>
            {serviceRequests.isPending ? <div className="empty">Loading requests…</div> : serviceRequests.isError ? <div className="empty">Requests could not be loaded.</div> : <DataTable label="Recent personal requests" empty="No certificate requests yet." columns={["Type", "Requested", "Status"]} rows={(serviceRequests.data?.data ?? []).map(request => [request.requestType.replaceAll("_", " "), formatDate(request.createdAt), <Badge key={request.id} value={request.status} />])} />}
          </section>}
          {canReadAnnouncements && <section className="panel dashboard-widget" data-dashboard-widget="announcements"><div className="panel-head"><div><h3>Announcements</h3><span>Company updates relevant to you.</span></div></div>
            {announcements.isPending ? <div className="empty">Loading announcements…</div> : announcements.isError ? <div className="empty">Announcements could not be loaded.</div> : <div className="dashboard-announcements">{announcements.data?.data.map(item => <article key={item.id}><strong>{item.title}</strong><p>{item.content}</p><small>{formatDate(item.publishedAt || item.createdAt)}</small></article>)}{!announcements.data?.data.length && <div className="empty compact">No current announcements.</div>}</div>}
          </section>}
        </div>
      </>}

      {persona === "line-manager" && <>
        {approvalQueue}
        {(availabilityPanel || canReadScopedEmployees) && <div className={`dashboard-row ${availabilityPanel && canReadScopedEmployees ? "dashboard-row--two" : "dashboard-row--single"}`}>
          {availabilityPanel}
          {canReadScopedEmployees && <section className="panel dashboard-widget" data-dashboard-widget="team-snapshot"><div className="panel-head"><div><h3>Team snapshot</h3><span>Availability calculated from approved leave in your scope.</span></div>{canOpenTeam && <button type="button" onClick={() => setNav("Team")}>Open team</button>}</div><div className="dashboard-focus-list"><div><span>Available today</span><strong>{Math.max(active.length - onLeaveToday.length, 0)}</strong></div><div><span>Away today</span><strong>{onLeaveToday.length}</strong></div><div><span>Starting leave soon</span><strong>{leaveStartingSoon.length}</strong></div></div></section>}
        </div>}
      </>}

      {persona === "manager" && <>
        {approvalQueue}
        {(workforcePanel || availabilityPanel) && <div className={`dashboard-row ${workforcePanel && availabilityPanel ? "dashboard-row--two" : "dashboard-row--single"}`}>{workforcePanel}{availabilityPanel}</div>}
        {broadLeave && <div className="dashboard-row dashboard-row--single"><section className="panel dashboard-widget" data-dashboard-widget="recent-leave-activity"><div className="panel-head"><div><h3>Recent scoped leave activity</h3><span>Latest requests visible in your management scope.</span></div></div><DataTable label="Recent scoped leave activity" empty="No leave activity is available." columns={["Employee", "Leave type", "Start date", "Status"]} rows={recentLeaveActivity.map(leave => [`${leave.employee.firstName} ${leave.employee.lastName}`, leave.leaveType.name, formatDate(leave.startDate), <Badge key={leave.id} value={leave.status} />])} /></section></div>}
      </>}

      {persona === "hr" && <>
        {approvalQueue}
        {(workforcePanel || attendancePanel) && <div className={`dashboard-row ${workforcePanel && attendancePanel ? "dashboard-row--two" : "dashboard-row--single"}`}>{workforcePanel}{attendancePanel}</div>}
        {(leaveDistributionPanel || canReadScopedEmployees) && <div className={`dashboard-row ${leaveDistributionPanel && canReadScopedEmployees ? "dashboard-row--two" : "dashboard-row--single"}`}>
          {leaveDistributionPanel}
          {canReadScopedEmployees && <section className="panel dashboard-widget" data-dashboard-widget="recent-joiners"><div className="panel-head"><div><h3>Recent joiners</h3><span>Latest employee records.</span></div>{canOpenEmployees && <button type="button" onClick={() => setNav("Employees")}>Open directory</button>}</div>
            <DataTable label="Recent joiners" empty="No employees yet." columns={["Name", "Designation", "Joined", "Status"]} rows={recentJoiners.map(employee => [<strong key="name">{employeeName(employee)}</strong>, employee.fields.Designation || "-", formatDate(employee.fields["Joining Date"]), <Badge key="status" value={employee.status} />])} />
          </section>}
        </div>}
        {(broadLeave || canReadPayrollDashboard) && <div className="dashboard-row dashboard-row--single"><section className="panel dashboard-widget" data-dashboard-widget="operational-focus"><div className="panel-head"><div><h3>Operational focus</h3><span>Current priorities from the existing workspace.</span></div></div><div className="dashboard-focus-list dashboard-focus-list--inline">{broadLeave && <><div><span>Approved leave today</span><strong>{onLeaveToday.length}</strong></div><div><span>Pending leave requests</span><strong>{pendingLeave.length}</strong></div></>}{canReadPayrollDashboard && <div><span>Current-month payroll runs</span><strong>{currentPayroll.length}</strong></div>}</div></section></div>}
      </>}

      {persona === "cpo" && <>
        {approvalQueue}
        {(workforcePanel || canReadRecruitment) && <div className={`dashboard-row ${workforcePanel && canReadRecruitment ? "dashboard-row--two" : "dashboard-row--single"}`}>
          {workforcePanel}
          {canReadRecruitment && <section className="panel dashboard-widget" data-dashboard-widget="recruitment-summary"><div className="panel-head"><div><h3>Recruitment outlook</h3><span>{openPositions} remaining vacancies across {openJobs.length} open role(s)</span></div>{canOpenRecruitment && <button type="button" onClick={() => setNav("Recruitment")}>View recruitment</button>}</div><DataTable label="Open recruitment positions" empty="No open positions." columns={["Position", "Department", "Vacancies", "Candidates"]} rows={openJobs.slice(0, 6).map(job => [job.title, job.dept || "Unassigned", recruitmentJobVacancies(job, state.candidates).remaining, state.candidates.filter(candidate => candidate.jobId === job.id && candidate.stage !== "Rejected").length])} /></section>}
        </div>}
        {(leaveDistributionPanel || attendancePanel) && <div className={`dashboard-row ${leaveDistributionPanel && attendancePanel ? "dashboard-row--two" : "dashboard-row--single"}`}>{leaveDistributionPanel}{attendancePanel}</div>}
      </>}

      {persona === "coo" && <>
        {approvalQueue}
        {(workforcePanel || attendancePanel) && <div className={`dashboard-row ${workforcePanel && attendancePanel ? "dashboard-row--two" : "dashboard-row--single"}`}>{workforcePanel}{attendancePanel}</div>}
        {(availabilityPanel || leaveDistributionPanel) && <div className={`dashboard-row ${availabilityPanel && leaveDistributionPanel ? "dashboard-row--two" : "dashboard-row--single"}`}>{availabilityPanel}{leaveDistributionPanel}</div>}
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
    "Approval Inbox": "Decisions assigned to you across HR workflows.",
    Notifications: "Assignments, status changes and important updates.",
    Team: "Direct reports and managed department work.",
    Employees: "Employee records.",
    Attendance: "Daily attendance and monthly totals.",
    Leave: "Leave requests and balances.",
    "Business Trips": "Requests, travel costs and employee advances.",
    Expenses: "Employee expenses and reimbursement processing.",
    Loans: "Employee loans and payroll deductions.",
    Payroll: "Payslips and payroll exports.",
    Recruitment: "Job openings and candidates.",
    Performance: "Goals, feedback and performance review lifecycle.",
    Announcements: "Scheduled company news and targeted updates.",
    Certificates: "Certificate requests, approvals, versions and downloads.",
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

function DepartmentFilter({ value, departments, onChange }: { value: string; departments: readonly string[]; onChange: (value: string) => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = React.useId();
  const choices = ["", ...departments];
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 0 });

  function placeMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ top: rect.bottom + 4, left: rect.left, width: rect.width, maxHeight: Math.max(44, window.innerHeight - rect.bottom - 8) });
  }

  function showMenu() {
    setActiveIndex(Math.max(0, choices.indexOf(value)));
    placeMenu();
    setOpen(true);
  }

  function choose(index: number) {
    onChange(choices[index]);
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", closeOnScroll, true);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", closeOnScroll, true);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [open]);

  return <div className="department-filter">
    <button ref={triggerRef} className="department-filter__trigger" type="button" aria-label="Filter employees by department" aria-haspopup="listbox" aria-controls={menuId} aria-expanded={open} onClick={() => open ? setOpen(false) : showMenu()} onKeyDown={event => {
      if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); }
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!open) showMenu();
        else setActiveIndex(current => (current + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length);
      } else if ((event.key === "Enter" || event.key === " ") && open) { event.preventDefault(); choose(activeIndex); }
    }}><span>{value || "All departments"}</span><ChevronDown size={16} aria-hidden="true" /></button>
    {open && createPortal(<div ref={menuRef} id={menuId} className="department-filter__options" role="listbox" aria-label="Employee department choices" style={position}>{choices.map((choice, index) => <button className={[choice === value && "is-selected", index === activeIndex && "is-active"].filter(Boolean).join(" ")} type="button" role="option" aria-selected={choice === value} key={choice || "all"} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(index)}>{choice || "All departments"}</button>)}</div>, document.body)}
  </div>;
}

function Employees({ state, setState, setModal, notify, close, savePdf, canCreate, canUpdate, canTerminate, canImport, canExport, canViewSalary, session, refreshWorkspace }: CommonProps & { canCreate: boolean; canUpdate: boolean; canTerminate: boolean; canImport: boolean; canExport: boolean; canViewSalary: boolean; session: BackendSession | null | undefined; refreshWorkspace: () => Promise<void> }) {
  const { active: searchActive, search } = usePageSearch();
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const activeCount = state.employees.filter(employee => employee.status === "Active").length;
  const onLeaveCount = state.employees.filter(employee => employee.status === "On Leave").length;
  const departmentCount = new Set(state.employees.map(employee => employee.fields.Department).filter(Boolean)).size;
  const employees = useMemo(() => state.employees.filter(employee => {
    const matchesSearch = !searchActive || [employeeName(employee), employee.fields["Employee Code"]]
      .some(value => value.trim().toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    return matchesSearch && (!department || employee.fields.Department === department) && (!status || employee.status === status);
  }).sort((a, b) => a.fields["Employee Code"].localeCompare(b.fields["Employee Code"])), [state.employees, searchActive, search, department, status]);
  usePageSearchStatus("employees", { count: employees.length }, searchActive);
  const totalPages = Math.max(1, Math.ceil(employees.length / 20));
  const pageEmployees = employees.slice((page - 1) * 20, page * 20);

  useEffect(() => { setPage(1); }, [department, status, search]);
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
          <DepartmentFilter value={department} departments={state.settings.departments} onChange={setDepartment} />
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
        {employees.length > 20 && <Pagination total={employees.length} page={page} limit={20} totalPages={totalPages} label="employees" onPage={setPage} />}
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
  notify: Notify;
}) {
  const [draft, setDraft] = useState<EmployeeRecord>(() => structuredClone(employee ?? template ?? createEmptyEmployee(nextEmployeeCode(state.employees))));
  const initialDraft = useRef<EmployeeRecord | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const discardFocusRef = useRef<HTMLButtonElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [discardRequested, setDiscardRequested] = useState(false);
  if (!initialDraft.current) initialDraft.current = structuredClone(draft);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(initialDraft.current);
  const setField = (field: string, value: string) => {
    setDraft(prev => ({
      ...prev,
      fields: {
        ...prev.fields,
        [field]: value,
        ...(field === "Full Name"
          ? { "First Name": splitEmployeeName(value).firstName, "Last Name": splitEmployeeName(value).lastName }
          : {})
      }
    }));
    setErrors(previous => { const { [field]: _cleared, ...remaining } = previous; return remaining; });
  };

  useDialogCloseGuard(() => {
    if (!isDirty) return true;
    setDiscardRequested(true);
    return false;
  });

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!discardRequested) return;
    discardFocusRef.current?.focus();
  }, [discardRequested]);

  function requestClose() {
    if (isDirty) { setDiscardRequested(true); return; }
    close();
  }

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
    const nextErrors: Record<string, string> = {};
    if (!draft.fields["Employee Code"].trim()) nextErrors["Employee Code"] = "Enter the employee code.";
    if (!draft.fields["Full Name"].trim()) nextErrors["Full Name"] = "Enter the employee’s full name.";
    if (!/^\S+@\S+\.\S+$/.test(email)) nextErrors["E-Mail ID (Work)"] = "Enter a valid work email address.";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      window.requestAnimationFrame(() => summaryRef.current?.focus());
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
        {Object.keys(errors).length > 0 && <div ref={summaryRef} className="form-error-summary" tabIndex={-1} role="alert"><strong>Fix the highlighted employee details.</strong><ul>{Object.entries(errors).map(([field, message]) => { const id = `employee-${field.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`; return <li key={field}><a href={`#${id}`} onClick={event => { event.preventDefault(); document.getElementById(id)?.focus(); }}>{message}</a></li>; })}</ul></div>}
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
                  const id = `employee-${field.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
                  const error = errors[field];
                  const required = ["Employee Code", "Full Name", "E-Mail ID (Work)"].includes(field);
                  return <label key={field} htmlFor={id}>{field}{required && <span aria-hidden="true"> *</span>}
                    {values
                      ? <select id={id} name={id} aria-label={field} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} aria-required={required || undefined} value={draft.fields[field] || ""} onChange={event => setField(field, event.target.value)}><option value="" />{values.map(item => <option key={item}>{item}</option>)}</select>
                      : <input id={id} name={id} aria-label={field} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} aria-required={required || undefined} type={fieldType(field)} value={draft.fields[field] || ""} onChange={event => setField(field, event.target.value)} />}
                    {error && <span id={`${id}-error`} className="field-error" role="alert">{error}</span>}
                  </label>;
                })}
              </div>
            </details>
          ))}
        </div>
      </div>
      {discardRequested && <div className="employee-discard-confirmation" role="alert"><strong>Discard unsaved employee changes?</strong><span>Your edits have not been saved.</span><div><button ref={discardFocusRef} type="button" onClick={() => setDiscardRequested(false)}>Keep editing</button><button type="button" className="danger-outline" onClick={close}>Discard changes</button></div></div>}
      <div className="modal-actions employee-modal-actions"><button type="button" onClick={requestClose}>Cancel</button><button type="button" className="primary" onClick={submit}>Save employee</button></div>
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

function Attendance({ state, setState, savePdf, notify, canManage, canExport }: { state: HrState; setState: React.Dispatch<React.SetStateAction<HrState>>; savePdf: (file: GeneratedPdf | undefined, template: PdfTemplate, employeeId?: string) => void; notify: Notify; canManage: boolean; canExport: boolean }) {
  const authorization = useAuthorization();
  const now = new Date();
  const routeSearch = attendanceRoute.useSearch();
  const navigate = attendanceRoute.useNavigate();
  const date = routeSearch.date ?? todayISO();
  const month = routeSearch.month ?? now.getMonth() + 1;
  const year = routeSearch.year ?? now.getFullYear();
  const department = routeSearch.department ?? "";
  const status = routeSearch.status ?? "";
  const [confirmation, setConfirmation] = useState<ConfirmAction | null>(null);
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
  const requestedPage = routeSearch.page ?? 1;
  const requestedSummaryPage = routeSearch.summaryPage ?? 1;
  const dailyPage = paginate(visibleEmployees, requestedPage);
  const summaryPage = paginate(stats, requestedSummaryPage);
  const payrollImpact = active.reduce((sum, employee) => {
    const code = day[employee.id];
    return sum + (employeeSalary(employee).total / 30) * (code === "A" ? 1 : code === "H" ? 0.5 : 0);
  }, 0);
  const grouped = departments
    .map(name => {
      const departmentEmployees = active.filter(employee => (employee.fields.Department || "Unassigned") === name);
      return {
        name,
        employees: dailyPage.items.filter(employee => (employee.fields.Department || "Unassigned") === name),
        summary: attendanceDaySummary(departmentEmployees, day)
      };
    })
    .filter(group => group.employees.length);

  useEffect(() => {
    if (dailyPage.page === requestedPage && summaryPage.page === requestedSummaryPage) return;
    void navigate({ search: current => ({ ...current, page: dailyPage.page, summaryPage: summaryPage.page }), replace: true });
  }, [dailyPage.page, navigate, requestedPage, requestedSummaryPage, summaryPage.page]);

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
      if (result.latestDate) void navigate({ search: current => ({ ...current, date: result.latestDate, page: 1 }), replace: true });
      notify(`Attendance import complete: ${result.imported} row(s) across ${result.dates} date(s)${result.skipped ? `; ${result.skipped} skipped` : ""}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Attendance import failed. Use the downloaded template or a CSV exported from Excel.");
    }
  }

  function restoreDay(snapshot: { attendance?: Record<string, AttendanceCode>; approvals?: Record<string, "Approved" | "Not approved"> }) {
    setState(previous => {
      const attendance = { ...previous.attendance };
      const attendanceApprovals = { ...previous.attendanceApprovals };
      if (snapshot.attendance) attendance[date] = snapshot.attendance;
      else delete attendance[date];
      if (snapshot.approvals) attendanceApprovals[date] = snapshot.approvals;
      else delete attendanceApprovals[date];
      return { ...previous, attendance, attendanceApprovals };
    });
  }

  function snapshotDay() {
    return {
      attendance: state.attendance[date] ? { ...state.attendance[date] } : undefined,
      approvals: state.attendanceApprovals[date] ? { ...state.attendanceApprovals[date] } : undefined
    };
  }

  function requestMarkUnmarkedPresent() {
    const count = active.filter(employee => !day[employee.id]).length;
    if (!count) return notify("Everyone already has an attendance status for this day.");
    const snapshot = snapshotDay();
    setConfirmation({ title: "Mark unmarked employees present?", description: `This marks ${count} currently unmarked employee${count === 1 ? "" : "s"} as present. Existing attendance and approvals stay unchanged.`, confirmLabel: "Mark present", onConfirm: () => {
      setState(previous => markAllAttendance(previous, date, "P"));
      notify(`${count} employee${count === 1 ? "" : "s"} marked present.`, { label: "Undo", onAction: () => restoreDay(snapshot) });
    } });
  }

  function requestClearDay() {
    const count = Object.values(day).filter(code => code !== "L").length;
    if (!count) return notify("There are no non-leave attendance records to clear.");
    const snapshot = snapshotDay();
    setConfirmation({ title: "Clear this attendance day?", description: `This clears ${count} non-leave attendance record${count === 1 ? "" : "s"}. Leave records remain protected.`, confirmLabel: "Clear day", danger: true, onConfirm: () => {
      setState(previous => clearAttendanceDay(previous, date));
      notify("Attendance day cleared.", { label: "Undo", onAction: () => restoreDay(snapshot) });
    } });
  }

  return (
    <><section className="stack attendance-workspace">
      <div className="panel attendance-control">
        <div className="attendance-hero">
          <div>
            <h3>Daily Attendance</h3>
            <p>Mark each employee or import a completed attendance sheet.</p>
          </div>
          {canManage && <div className="inline-controls">
            <button onClick={() => void downloadAttendanceTemplate().catch(error => notify(errorMessage(error)))}><Download size={16} /> Template</button>
            <label className="button-like"><Upload size={16} /> Import attendance<input type="file" accept=".xls,.html,.csv,.tsv,application/vnd.ms-excel,text/html,text/csv" onChange={event => { void importAttendance(event.target.files?.[0]); event.target.value = ""; }} /></label>
            <button onClick={requestMarkUnmarkedPresent}>Mark unmarked present</button>
            <button className="danger-outline" onClick={requestClearDay}>Clear day</button>
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
          <input id="attendance-date" name="attendance-date" aria-label="Attendance date" type="date" value={date} onChange={event => void navigate({ search: current => ({ ...current, date: event.target.value || undefined, page: 1 }), replace: true })} />
          <select value={department} onChange={event => void navigate({ search: current => ({ ...current, department: event.target.value || undefined, page: 1 }), replace: true })} aria-label="Department filter"><option value="">All departments</option>{departments.map(item => <option key={item}>{item}</option>)}</select>
          <select value={status} onChange={event => void navigate({ search: current => ({ ...current, status: event.target.value || undefined, page: 1 }), replace: true })} aria-label="Status filter"><option value="">All statuses</option>{["Present", "Half-day", "Leave", "Absent", "Unmarked"].map(item => <option key={item}>{item}</option>)}</select>
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
                        {canManage ? <select className="attendance-status-select" data-label="Action" aria-label={`Attendance status for ${employeeName(employee)}`} value={code ?? ""} onChange={event => setState(prev => setAttendance(prev, date, employee.id, event.target.value as AttendanceCode))}>
                          <option value="" disabled>Not marked</option>
                          {(["P", "H", "L", "A"] as AttendanceCode[]).map(item => <option key={item} value={item}>{statusLabels[item]}</option>)}
                        </select> : <span data-label="Action">-</span>}
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
        {visibleEmployees.length > operationalPageSize && <Pagination total={visibleEmployees.length} page={dailyPage.page} limit={operationalPageSize} totalPages={dailyPage.totalPages} label="attendance employees" onPage={next => void navigate({ search: current => ({ ...current, page: next }) })} />}
        <p className="attendance-foot">Marked: <strong>{daySummary.marked}</strong>/{daySummary.total} · Present {daySummary.P} · Half-day {daySummary.H} · Leave {daySummary.L} · Absent {daySummary.A} · Unmarked {daySummary.unmarked}{canManage ? ` · Day LOP estimate ${formatMoney(payrollImpact, state.settings.company.currency)}` : ""}</p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div><h3>Monthly Summary</h3><span>Counts for {months[month - 1]} {year}</span></div>
          <div className="inline-controls">
          <select id="attendance-month" name="attendance-month" aria-label="Attendance report month" value={month} onChange={event => void navigate({ search: current => ({ ...current, month: Number(event.target.value), summaryPage: 1 }), replace: true })}>{months.map((item, index) => <option value={index + 1} key={item}>{item}</option>)}</select>
          <input id="attendance-year" name="attendance-year" aria-label="Attendance report year" type="number" min="1900" max="2200" value={year} onChange={event => void navigate({ search: current => ({ ...current, year: Number(event.target.value), summaryPage: 1 }), replace: true })} />
            {canExport && <button onClick={() => void withPdf(pdf => savePdf(pdf.saveReportPdf("attendance_report", state, year, month), "attendance_report"))}>PDF</button>}
          </div>
        </div>
        <DataTable label="Monthly attendance report" columns={["Code", "Employee", "Present", "Half-day", "Leave", "Absent", "%"]} rows={summaryPage.items.map(row => [row.employee.fields["Employee Code"], employeeName(row.employee), row.P, row.H, row.L, row.A, `${row.pct}%`])} />
        {stats.length > operationalPageSize && <Pagination total={stats.length} page={summaryPage.page} limit={operationalPageSize} totalPages={summaryPage.totalPages} label="monthly attendance rows" onPage={next => void navigate({ search: current => ({ ...current, summaryPage: next }) })} />}
      </div>
    </section>{confirmation && <ActionConfirmation action={confirmation} close={() => setConfirmation(null)} />}</>
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

function BusinessTrips({ state, setState, notify }: { state: HrState; setState: React.Dispatch<React.SetStateAction<HrState>>; notify: Notify }) {
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
  const destinationRef = useRef<HTMLInputElement>(null);
  const [confirmation, setConfirmation] = useState<ConfirmAction | null>(null);
  const days = from && to && to >= from ? inclusiveDays(from, to) : 0;

  useEffect(() => {
    if (!eligibleEmployees.some(employee => employee.id === employeeId)) setEmployeeId(eligibleEmployees[0]?.id || "");
  }, [eligibleEmployees, employeeId]);

  function updateTrip(id: string, patch: Partial<BusinessTrip>) {
    setState(prev => ({ ...prev, businessTrips: prev.businessTrips.map(item => item.id === id ? { ...item, ...patch } : item) }));
  }

  function requestStatusChange(trip: BusinessTrip, status: BusinessTrip["status"]) {
    const action = statusActionLabel(status, trip.status);
    setConfirmation({ title: `${action} this trip?`, description: `This changes the trip to ${status.toLowerCase()}. You can undo it immediately after confirmation.`, confirmLabel: action, danger: status === "Rejected", onConfirm: () => {
      updateTrip(trip.id, { status });
      notify(`Trip ${status.toLowerCase()}.`, { label: "Undo", onAction: () => updateTrip(trip.id, { status: trip.status }) });
    } });
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

  return <><section className="stack">
    {canCreate && <div className="panel">
      <div className="panel-head"><div><h3>Business Trips</h3><span>Requests, costs and advances.</span></div></div>
      <div className="form-grid compact">
        <label>Employee<EmployeePicker id="trip-employee" name="trip-employee" value={employeeId} onChange={setEmployeeId} options={employeePickerOptions(eligibleEmployees)} /></label>
        <label>Destination<input ref={destinationRef} id="trip-destination" name="trip-destination" value={destination} onChange={event => setDestination(event.target.value)} placeholder="Doha, Riyadh, Dubai..." /></label>
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
      <DataTable label="Business trips" empty={canCreate ? <div className="empty-state"><span>No business trips yet.</span><button type="button" onClick={() => destinationRef.current?.focus()}>Add trip request</button></div> : "No business trips yet."} columns={["Employee", "Destination", "Dates", "Days", "Cost", "Advance", "Status", "Actions"]} rows={state.businessTrips.map(trip => {
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
            {canReview && trip.status === "Pending" && <><button onClick={() => requestStatusChange(trip, "Approved")}>Approve</button><button className="danger-outline" onClick={() => requestStatusChange(trip, "Rejected")}>Reject</button></>}
            {canClose && trip.status === "Approved" && <button onClick={() => requestStatusChange(trip, "Closed")}>Close</button>}
            {(authorization.hasPermission("trip.hr.manage") || (authorization.hasPermission("trip.self.create") && trip.employeeId === authorization.scopes.employeeId)) && trip.status === "Pending" && <button onClick={() => confirmDelete(`trip to ${trip.destination}`) && setState(prev => ({ ...prev, businessTrips: prev.businessTrips.filter(item => item.id !== trip.id) }))}>Delete</button>}
          </div>
        ];
      })} />
    </div>
  </section>{confirmation && <ActionConfirmation action={confirmation} close={() => setConfirmation(null)} />}</>;
}

function Expenses({ state, setState, notify }: { state: HrState; setState: React.Dispatch<React.SetStateAction<HrState>>; notify: Notify }) {
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
  const amountRef = useRef<HTMLInputElement>(null);
  const [confirmation, setConfirmation] = useState<ConfirmAction | null>(null);
  const totals = expenseTotals(state.expenses);
  const employeeTrips = state.businessTrips.filter(item => item.employeeId === employeeId);

  useEffect(() => {
    if (!eligibleEmployees.some(employee => employee.id === employeeId)) setEmployeeId(eligibleEmployees[0]?.id || "");
  }, [eligibleEmployees, employeeId]);

  function updateExpense(id: string, patch: Partial<EmployeeExpense>) {
    setState(prev => ({ ...prev, expenses: prev.expenses.map(item => item.id === id ? { ...item, ...patch } : item) }));
  }

  function requestStatusChange(expense: EmployeeExpense, status: EmployeeExpense["status"]) {
    const action = statusActionLabel(status, expense.status);
    setConfirmation({ title: action === "Mark paid" ? "Mark this expense paid?" : `${action} this expense?`, description: `This changes the expense to ${status.toLowerCase()}. You can undo it immediately after confirmation.`, confirmLabel: action, danger: status === "Rejected", onConfirm: () => {
      updateExpense(expense.id, { status });
      notify(`Expense ${status.toLowerCase()}.`, { label: "Undo", onAction: () => updateExpense(expense.id, { status: expense.status }) });
    } });
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

  return <><section className="stack">
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
        <label htmlFor="expense-amount">Amount<input ref={amountRef} id="expense-amount" name="expense-amount" type="number" min="0" value={amount} onChange={event => setAmount(event.target.value)} /></label>
        <label className="wide" htmlFor="expense-description">Description<textarea id="expense-description" name="expense-description" value={description} onChange={event => setDescription(event.target.value)} /></label>
      </div>
      <div className="form-actions"><button className="primary" onClick={submit}>Submit expense</button></div>
    </div>}
    <div className="panel">
      <div className="panel-head"><h3>Expense Register</h3><span>{state.expenses.length} records</span></div>
      <DataTable label="Employee expenses" empty={canCreate ? <div className="empty-state"><span>No expenses yet.</span><button type="button" onClick={() => amountRef.current?.focus()}>Submit expense</button></div> : "No expenses yet."} columns={["Employee", "Category", "Date", "Amount", "Trip", "Status", "Actions"]} rows={state.expenses.map(expense => {
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
            {canReview && expense.status === "Submitted" && <><button onClick={() => requestStatusChange(expense, "Approved")}>Approve</button><button className="danger-outline" onClick={() => requestStatusChange(expense, "Rejected")}>Reject</button></>}
            {canPay && expense.status === "Approved" && <button onClick={() => requestStatusChange(expense, "Paid")}>Mark paid</button>}
            {(authorization.hasPermission("expense.hr.approve") || (authorization.hasPermission("expense.self.create") && expense.employeeId === authorization.scopes.employeeId)) && expense.status === "Submitted" && <button onClick={() => confirmDelete(`${expense.category} expense`) && setState(prev => ({ ...prev, expenses: prev.expenses.filter(item => item.id !== expense.id) }))}>Delete</button>}
          </div>
        ];
      })} />
    </div>
  </section>{confirmation && <ActionConfirmation action={confirmation} close={() => setConfirmation(null)} />}</>;
}

function Loans({ state, setState, setModal, notify, close, canOverrideLimit }: {
  state: HrState;
  setState: React.Dispatch<React.SetStateAction<HrState>>;
  setModal: (content: React.ReactNode) => void;
  notify: Notify;
  close: () => void;
  canOverrideLimit: boolean;
}) {
  const { active: searchActive } = usePageSearch();
  const searchResults = usePageSearchList<{ id: string }>("loans", "/loans");
  const [status, setStatus] = useState("");
  const [department, setDepartment] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmAction | null>(null);
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
  }

  function requestStatusChange(loan: EmployeeLoan, status: EmployeeLoan["status"]) {
    const description = status === "Cancelled" ? "Future payroll deductions will stop. You can undo this immediately after confirmation." : `This changes the loan to ${status.toLowerCase()}. You can undo it immediately after confirmation.`;
    const action = statusActionLabel(status, loan.status);
    setConfirmation({ title: `${action} this loan?`, description, confirmLabel: action, danger: status === "Cancelled", onConfirm: () => {
      updateStatus(loan, status);
      notify(`Loan ${status.toLowerCase()}.`, { label: "Undo", onAction: () => updateStatus(loan, loan.status) });
    } });
  }

  function openLoanForm(loan?: EmployeeLoan) {
    setModal(<LoanForm state={state} loan={loan} save={saveLoan} close={close} notify={notify} />);
  }

  return <><section className="stack">
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
            {canOverrideLimit && loan.status === "Draft" && <><button onClick={() => openLoanForm(loan)}>Edit</button><button className="primary" onClick={() => requestStatusChange(loan, "Active")}>Activate</button></>}
            {canOverrideLimit && loan.status === "Active" && <button onClick={() => requestStatusChange(loan, "Paused")}>Pause</button>}
            {canOverrideLimit && loan.status === "Paused" && <button onClick={() => requestStatusChange(loan, "Active")}>Resume</button>}
            {canOverrideLimit && (loan.status === "Active" || loan.status === "Paused") && <><button onClick={() => setModal(<LoanDeductionForm state={state} loan={loan} setState={setState} notify={notify} close={close} canOverrideLimit={canOverrideLimit} />)}>Set deduction</button><button onClick={() => setModal(<LoanPaymentForm state={state} loan={loan} setState={setState} notify={notify} close={close} />)}>Record payment</button><button className="danger-outline" onClick={() => requestStatusChange(loan, "Cancelled")}>Cancel</button></>}
          </div>
        ];
      })} />
    </div>
  </section>{confirmation && <ActionConfirmation action={confirmation} close={() => setConfirmation(null)} />}</>;
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
  const [pipelineTime, setPipelineTime] = useState(() => Date.now());
  const [draggedCandidateId, setDraggedCandidateId] = useState("");
  const candidatePointerDragRef = useRef<{ id: string; pointerId: number; startX: number; startY: number; active: boolean } | null>(null);
  const [dropStage, setDropStage] = useState<RecruitmentCandidate["stage"] | "">("");
  const pipelineCandidates = state.candidates.filter(candidate => candidate.stage !== "Hired" || !candidate.hiredAt || Date.parse(candidate.hiredAt) > pipelineTime - hiredCandidateVisibilityMs);
  const visibleCandidates = rankedPageSearchItems(pipelineCandidates, candidateSearch.data, searchActive, candidate => candidate.id, match => match.id);
  const [editingJobId, setEditingJobId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobDept, setJobDept] = useState(state.settings.departments[0] || "");
  const [jobOpenings, setJobOpenings] = useState("1");
  const [jobStatus, setJobStatus] = useState<RecruitmentJob["status"]>("Open");
  const [jobPostedOn, setJobPostedOn] = useState(todayISO());
  const [jobDescription, setJobDescription] = useState("");
  const [jobEditorOpen, setJobEditorOpen] = useState(false);
  const [jobEditorBaseline, setJobEditorBaseline] = useState("");
  const [jobTitleError, setJobTitleError] = useState(false);
  const [editingCandidateId, setEditingCandidateId] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [candidateJobId, setCandidateJobId] = useState(state.jobs[0]?.id || "");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [candidatePhone, setCandidatePhone] = useState("");
  const [candidateStage, setCandidateStage] = useState<RecruitmentCandidate["stage"]>("Applied");
  const [candidateRating, setCandidateRating] = useState("0");
  const [candidateNotes, setCandidateNotes] = useState("");
  const [candidateEditorOpen, setCandidateEditorOpen] = useState(false);
  const [candidateEditorBaseline, setCandidateEditorBaseline] = useState("");
  const [candidateNameError, setCandidateNameError] = useState(false);
  const [assessmentCandidateId, setAssessmentCandidateId] = useState("");
  const [assessmentEditorToken, setAssessmentEditorToken] = useState("");
  const [assessmentVersion, setAssessmentVersion] = useState(0);
  const [assessmentInitialDraft, setAssessmentInitialDraft] = useState<InterviewAssessment>({});
  const [offerCandidateId, setOfferCandidateId] = useState("");
  const pipeline = candidatePipeline(pipelineCandidates);
  const vacancies = new Map(state.jobs.map(job => [job.id, recruitmentJobVacancies(job, state.candidates)]));
  const openJobs = state.jobs.filter(job => job.status === "Open" && !vacancies.get(job.id)?.isFilled);
  const openPositions = openJobs.reduce((sum, job) => sum + (vacancies.get(job.id)?.remaining ?? 0), 0);
  const editingCandidateJobId = state.candidates.find(candidate => candidate.id === editingCandidateId)?.jobId;
  const candidateJobs = state.jobs.filter(job => openJobs.some(openJob => openJob.id === job.id) || job.id === editingCandidateJobId);
  const activeCandidates = state.candidates.filter(candidate => candidate.stage !== "Hired" && candidate.stage !== "Rejected");

  useEffect(() => {
    const nextExpiry = Math.min(...state.candidates
      .filter(candidate => candidate.stage === "Hired" && candidate.hiredAt)
      .map(candidate => Date.parse(candidate.hiredAt!) + hiredCandidateVisibilityMs)
      .filter(expiry => expiry > pipelineTime));
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(() => setPipelineTime(Date.now()), Math.max(0, nextExpiry - Date.now()) + 1);
    return () => window.clearTimeout(timer);
  }, [pipelineTime, state.candidates]);

  useEffect(() => {
    if (!candidateJobId && candidateJobs[0]) setCandidateJobId(candidateJobs[0].id);
    if (candidateJobId && !candidateJobs.some(job => job.id === candidateJobId)) setCandidateJobId(candidateJobs[0]?.id || "");
  }, [candidateJobId, editingCandidateId, state.jobs, state.candidates]);

  function jobEditorValue() {
    return JSON.stringify({ title: jobTitle, department: jobDept, openings: jobOpenings, status: jobStatus, postedOn: jobPostedOn, description: jobDescription });
  }

  function resetJobForm() {
    const initial = { title: "", department: state.settings.departments[0] || "", openings: "1", status: "Open" as const, postedOn: todayISO(), description: "" };
    setEditingJobId("");
    setJobTitle(initial.title);
    setJobDept(initial.department);
    setJobOpenings(initial.openings);
    setJobStatus(initial.status);
    setJobPostedOn(initial.postedOn);
    setJobDescription(initial.description);
    setJobTitleError(false);
    return JSON.stringify(initial);
  }

  function openJobEditor() {
    setJobEditorBaseline(resetJobForm());
    setJobEditorOpen(true);
  }

  function editJob(job: RecruitmentJob) {
    const initial = { title: job.title, department: job.dept, openings: String(job.openings), status: job.status, postedOn: job.postedOn, description: job.description };
    setEditingJobId(job.id);
    setJobTitle(initial.title);
    setJobDept(initial.department);
    setJobOpenings(initial.openings);
    setJobStatus(initial.status);
    setJobPostedOn(initial.postedOn);
    setJobDescription(initial.description);
    setJobEditorBaseline(JSON.stringify(initial));
    setJobEditorOpen(true);
  }

  function closeJobEditor() {
    if (jobEditorBaseline && jobEditorBaseline !== jobEditorValue() && !window.confirm("Discard unsaved job opening changes?")) return;
    resetJobForm();
    setJobEditorBaseline("");
    setJobEditorOpen(false);
  }

  function saveJob() {
    if (!jobTitle.trim()) {
      setJobTitleError(true);
      return notify("Enter a job title.");
    }
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
    setJobEditorBaseline("");
    setJobEditorOpen(false);
  }

  function deleteJob(id: string) {
    const job = state.jobs.find(item => item.id === id);
    if (!confirmDelete(`${job?.title || "job opening"}. Candidate history will be retained.`)) return;
    setState(prev => ({
      ...prev,
      jobs: prev.jobs.filter(job => job.id !== id)
    }));
    if (editingJobId === id) {
      resetJobForm();
      setJobEditorBaseline("");
      setJobEditorOpen(false);
    }
    notify("Opening archived. Candidate history was retained.");
  }

  function candidateEditorValue() {
    return JSON.stringify({ name: candidateName, jobId: candidateJobId, email: candidateEmail, phone: candidatePhone, stage: candidateStage, rating: candidateRating, notes: candidateNotes });
  }

  function resetCandidateForm() {
    const initial = { name: "", jobId: candidateJobs[0]?.id || "", email: "", phone: "", stage: "Applied" as const, rating: "0", notes: "" };
    setEditingCandidateId("");
    setCandidateName(initial.name);
    setCandidateJobId(initial.jobId);
    setCandidateEmail(initial.email);
    setCandidatePhone(initial.phone);
    setCandidateStage(initial.stage);
    setCandidateRating(initial.rating);
    setCandidateNotes(initial.notes);
    setCandidateNameError(false);
    return JSON.stringify(initial);
  }

  function openCandidateEditor() {
    setCandidateEditorBaseline(resetCandidateForm());
    setCandidateEditorOpen(true);
  }

  function editCandidate(candidate: RecruitmentCandidate) {
    const initial = { name: candidate.name, jobId: candidate.jobId, email: candidate.email, phone: candidate.phone, stage: candidate.stage, rating: String(candidate.rating || 0), notes: candidate.notes };
    setEditingCandidateId(candidate.id);
    setCandidateName(initial.name);
    setCandidateJobId(initial.jobId);
    setCandidateEmail(initial.email);
    setCandidatePhone(initial.phone);
    setCandidateStage(initial.stage);
    setCandidateRating(initial.rating);
    setCandidateNotes(initial.notes);
    setCandidateEditorBaseline(JSON.stringify(initial));
    setCandidateEditorOpen(true);
  }

  function closeCandidateEditor() {
    if (candidateEditorBaseline && candidateEditorBaseline !== candidateEditorValue() && !window.confirm("Discard unsaved candidate changes?")) return;
    resetCandidateForm();
    setCandidateEditorBaseline("");
    setCandidateEditorOpen(false);
  }

  function saveCandidate() {
    if (!editingCandidateId && !openJobs.length) return notify("Add or reopen a job with an available position first.");
    if (!candidateName.trim()) {
      setCandidateNameError(true);
      return notify("Enter the candidate's full name.");
    }
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
      hiredAt: existingCandidate?.hiredAt,
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
    setCandidateEditorBaseline("");
    setCandidateEditorOpen(false);
  }

  function moveCandidate(id: string, stage: RecruitmentCandidate["stage"]) {
    const candidate = state.candidates.find(item => item.id === id);
    if (!candidate || candidate.stage === stage) return false;
    if (candidate?.stage === "Hired" && stage !== "Hired") return notify("A hired candidate must be managed through the employee offboarding process.");
    const job = candidate && state.jobs.find(item => item.id === candidate.jobId);
    if (candidate && job && candidate.stage !== "Hired" && stage === "Hired" && (job.status !== "Open" || vacancies.get(job.id)?.isFilled)) {
      notify("All openings for this job are filled or closed.");
      return false;
    }
    setState(prev => ({
      ...prev,
      candidates: prev.candidates.map(candidate => candidate.id === id ? { ...candidate, stage } : candidate)
    }));
    notify(`${candidate.name} moved to ${stage}.`);
    return true;
  }

  function clearCandidatePointerDrag() {
    candidatePointerDragRef.current = null;
    setDraggedCandidateId("");
    setDropStage("");
  }

  function candidateDropStageAtPoint(clientX: number, clientY: number, candidateId: string) {
    const candidate = state.candidates.find(item => item.id === candidateId);
    const stage = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-stage]")?.dataset.stage;
    if (!candidate || candidate.stage === "Hired" || !stage || !candidateStages.includes(stage as RecruitmentCandidate["stage"]) || stage === candidate.stage) return "";
    return stage as RecruitmentCandidate["stage"];
  }

  function beginCandidatePointerDrag(event: React.PointerEvent<HTMLSpanElement>, candidate: RecruitmentCandidate) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    candidatePointerDragRef.current = { id: candidate.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false };
  }

  function updateCandidatePointerDrag(event: React.PointerEvent<HTMLSpanElement>) {
    const drag = candidatePointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
    drag.active = true;
    setDraggedCandidateId(drag.id);
    const stage = candidateDropStageAtPoint(event.clientX, event.clientY, drag.id);
    setDropStage(current => current === stage ? current : stage);
  }

  function finishCandidatePointerDrag(event: React.PointerEvent<HTMLSpanElement>) {
    const drag = candidatePointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const stage = drag.active ? candidateDropStageAtPoint(event.clientX, event.clientY, drag.id) : "";
    clearCandidatePointerDrag();
    if (stage) moveCandidate(drag.id, stage);
  }

  function addAsEmployee(candidate: RecruitmentCandidate) {
    if (candidate.employeeId) return notify("Candidate is already linked to an employee.");
    setState(prev => hireCandidateAsEmployee(prev, candidate.id));
    notify(`${candidate.name} added as an employee. Set salary details in Employees.`);
    setNav("Employees");
  }

  async function openAssessment(candidate: RecruitmentCandidate) {
    const job = state.jobs.find(item => item.id === candidate.jobId);
    const editorTokenKey = `medtech-hr-assessment-lease:${authorization.session.sessionId}:${candidate.id}`;
    const editorToken = sessionStorage.getItem(editorTokenKey) || crypto.randomUUID();
    sessionStorage.setItem(editorTokenKey, editorToken);
    try {
      const locked = await apiRequest<AssessmentResponse>(`/recruitment/candidates/${candidate.id}/interview-assessment/lease`, { method: "POST", csrfToken: authorization.session.csrfToken, body: JSON.stringify({ editorToken }) });
      setAssessmentInitialDraft(locked.interviewAssessment ?? candidate.interviewAssessment ?? { date: todayISO(), hiringDepartment: job?.dept || "" });
      setAssessmentVersion(locked.version);
      setAssessmentEditorToken(editorToken);
      setAssessmentCandidateId(candidate.id);
    } catch (error) { notify(errorMessage(error)); }
  }

  function openOffer(candidate: RecruitmentCandidate) {
    setOfferCandidateId(candidate.id);
  }

  async function saveAssessment(candidateId: string, interviewAssessment: Partial<InterviewAssessment>, expectedVersion: number) {
    const updated = await apiRequest<AssessmentResponse>(`/recruitment/candidates/${candidateId}/interview-assessment`, { method: "PATCH", csrfToken: authorization.session.csrfToken, body: JSON.stringify({ expectedVersion, editorToken: assessmentEditorToken, interviewAssessment }) });
    setAssessmentVersion(updated.version);
    return updated;
  }

  async function renewAssessmentLease(candidateId: string) {
    const locked = await apiRequest<AssessmentResponse>(`/recruitment/candidates/${candidateId}/interview-assessment/lease`, { method: "POST", csrfToken: authorization.session.csrfToken, body: JSON.stringify({ editorToken: assessmentEditorToken }) });
    setAssessmentVersion(locked.version);
    return locked;
  }

  async function closeAssessment() {
    const candidateId = assessmentCandidateId;
    const editorToken = assessmentEditorToken;
    if (candidateId && editorToken) {
      try {
        await apiRequest(`/recruitment/candidates/${candidateId}/interview-assessment/lease`, { method: "DELETE", csrfToken: authorization.session.csrfToken, body: JSON.stringify({ editorToken }) });
        sessionStorage.removeItem(`medtech-hr-assessment-lease:${authorization.session.sessionId}:${candidateId}`);
      }
      catch (error) { notify(`${errorMessage(error)} The edit lock will expire shortly.`); }
    }
    setAssessmentCandidateId("");
    setAssessmentEditorToken("");
  }

  async function saveOffer(candidateId: string, offerDetails: Partial<OfferDetails>) {
    const updated = await apiRequest<RecruitmentCandidate>(`/recruitment/candidates/${candidateId}`, { method: "PATCH", csrfToken: authorization.session.csrfToken, body: JSON.stringify({ offerDetails }) });
    const saved = updated.offerDetails ?? offerDetails;
    setState(previous => ({ ...previous, candidates: previous.candidates.map(candidate => candidate.id === candidateId ? { ...candidate, offerDetails: saved } : candidate) }));
    return saved;
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
        {canManage && (jobEditorOpen ? <button type="button" onClick={closeJobEditor}>Cancel</button> : <button className="primary" type="button" onClick={openJobEditor}>Add job</button>)}
      </div>
      {canManage && jobEditorOpen && <div className="recruitment-editor"><div className="form-grid compact">
        <label htmlFor="recruitment-job-title">Job title *<input id="recruitment-job-title" name="recruitment-job-title" autoComplete="off" aria-invalid={jobTitleError || undefined} aria-describedby={jobTitleError ? "recruitment-job-title-error" : undefined} value={jobTitle} onChange={event => { setJobTitle(event.target.value); if (jobTitleError) setJobTitleError(false); }} />{jobTitleError && <span className="field-error" id="recruitment-job-title-error">Enter a job title.</span>}</label>
        <label>Department<select id="recruitment-job-dept" name="recruitment-job-dept" value={jobDept} onChange={event => setJobDept(event.target.value)}>{state.settings.departments.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>No. of openings<input id="recruitment-job-openings" name="recruitment-job-openings" type="number" min="1" value={jobOpenings} onChange={event => setJobOpenings(event.target.value)} /></label>
        <label>Status<select id="recruitment-job-status" name="recruitment-job-status" value={jobStatus} onChange={event => setJobStatus(event.target.value as RecruitmentJob["status"])}><option>Open</option><option>On Hold</option><option>Closed</option></select></label>
        <label>Posted on<input id="recruitment-job-posted" name="recruitment-job-posted" type="date" value={jobPostedOn} onChange={event => setJobPostedOn(event.target.value)} /></label>
        <label className="wide" htmlFor="recruitment-job-description">Description<textarea id="recruitment-job-description" name="recruitment-job-description" value={jobDescription} onChange={event => setJobDescription(event.target.value)} /></label>
      </div>
      <div className="form-actions"><button className="primary" type="button" onClick={saveJob}>{editingJobId ? "Update opening" : "Add opening"}</button></div></div>}
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
            canManage ? <details className="card-actions-menu" key="actions"><summary>More actions</summary><div className="card-actions-menu__items"><button type="button" onClick={() => editJob(job)}>Edit opening</button><button type="button" className="danger-outline" onClick={() => deleteJob(job.id)}>Delete opening</button></div></details> : "-"
          ];
        })}
      />
    </div>

    <div className="panel">
        <div className="panel-head">
        <div><h3>Candidate Pipeline</h3><span id="candidate-pipeline-help">Use a tile's drag handle to move it to any stage, or use its stage selector. Hired candidates are final.</span></div>
        {canManage && (candidateEditorOpen ? <button type="button" onClick={closeCandidateEditor}>Cancel</button> : <button className="primary" type="button" onClick={openCandidateEditor} disabled={!candidateJobs.length}>Add candidate</button>)}
      </div>
      {canManage && candidateEditorOpen && <div className="recruitment-editor"><div className="form-grid compact">
        <label htmlFor="candidate-name">Full name *<input id="candidate-name" name="candidate-name" autoComplete="name" aria-invalid={candidateNameError || undefined} aria-describedby={candidateNameError ? "candidate-name-error" : undefined} value={candidateName} onChange={event => { setCandidateName(event.target.value); if (candidateNameError) setCandidateNameError(false); }} />{candidateNameError && <span className="field-error" id="candidate-name-error">Enter the candidate's full name.</span>}</label>
        <label>Applying for<select id="candidate-job" name="candidate-job" value={candidateJobId} disabled={!candidateJobs.length} onChange={event => setCandidateJobId(event.target.value)}>{candidateJobs.map(job => <option key={job.id} value={job.id}>{job.title}</option>)}</select></label>
        <label htmlFor="candidate-email">Email<input id="candidate-email" name="candidate-email" type="email" autoComplete="email" spellCheck={false} value={candidateEmail} onChange={event => setCandidateEmail(event.target.value)} /></label>
        <label htmlFor="candidate-phone">Phone<input id="candidate-phone" name="candidate-phone" type="tel" autoComplete="tel" value={candidatePhone} onChange={event => setCandidatePhone(event.target.value)} /></label>
        <label>Stage<select id="candidate-stage" name="candidate-stage" value={candidateStage} disabled={!editingCandidateId || candidateStage === "Hired"} onChange={event => setCandidateStage(event.target.value as RecruitmentCandidate["stage"])}>{candidateStages.map(stage => <option key={stage}>{stage}</option>)}</select></label>
        <label>Rating (0-5)<input id="candidate-rating" name="candidate-rating" type="number" min="0" max="5" value={candidateRating} onChange={event => setCandidateRating(event.target.value)} /></label>
        <label className="wide" htmlFor="candidate-notes">Notes<textarea id="candidate-notes" name="candidate-notes" value={candidateNotes} onChange={event => setCandidateNotes(event.target.value)} /></label>
      </div>
      <div className="form-actions"><button className="primary" type="button" onClick={saveCandidate}>{editingCandidateId ? "Update candidate" : "Add candidate"}</button></div></div>}

      <div className="recruitment-pipeline">
        {candidateStages.map(stage => {
          const cards = visibleCandidates.filter(candidate => candidate.stage === stage);
          const isDropTarget = Boolean(draggedCandidateId && dropStage === stage);
          return <div className={`pipeline-column${isDropTarget ? " pipeline-column-drop-target" : ""}`} data-stage={stage} key={stage}>
            <div className="pipeline-head"><strong>{stage}</strong><span>{cards.length}</span></div>
            {isDropTarget && <span className="pipeline-drop-hint" aria-live="polite">Drop in {stage}</span>}
            {cards.length ? cards.map(candidate => {
              const job = state.jobs.find(item => item.id === candidate.jobId);
              const movable = canManage && candidate.stage !== "Hired";
              return <article className={`candidate-card candidate-tile${draggedCandidateId === candidate.id ? " candidate-tile-dragging" : ""}`} key={candidate.id} aria-describedby={movable ? "candidate-pipeline-help" : undefined}>
                <div className="candidate-tile-header"><div><strong>{candidate.name}</strong><span>{job?.title || "(no job)"}</span></div>{movable && <span className="candidate-drag-handle" aria-hidden="true" title={`Drag ${candidate.name} to another stage`} onPointerDown={event => beginCandidatePointerDrag(event, candidate)} onPointerMove={updateCandidatePointerDrag} onPointerUp={finishCandidatePointerDrag} onPointerCancel={clearCandidatePointerDrag} onLostPointerCapture={clearCandidatePointerDrag}><GripVertical size={18} strokeWidth={2.25} /></span>}</div>
                <p>{candidate.email || candidate.phone || "No contact added"}</p>
                {candidate.rating > 0 && <em>Rating: {candidate.rating}/5</em>}
                {canManage && candidate.stage !== "Hired" ? <select aria-label={`Move ${candidate.name}`} value={candidate.stage} onChange={event => moveCandidate(candidate.id, event.target.value as RecruitmentCandidate["stage"])}>{candidateStages.map(option => <option key={option}>{option}</option>)}</select> : <Badge value={candidate.stage} />}
                {candidate.notes && <small>{candidate.notes}</small>}
                <div className="row-actions">
                  {candidate.stage === "Interview" && candidate.interviewAssessment && canManage && <button className="primary" type="button" onClick={() => void openAssessment(candidate)}>Open assessment</button>}
                  {candidate.stage === "Interview" && !candidate.interviewAssessment && <small>Preparing assessment…</small>}
                  {candidate.stage === "Offer" && candidate.offerDetails && canManage && <button className="primary" type="button" onClick={() => openOffer(candidate)}>Offer documents</button>}
                  {candidate.stage === "Offer" && !candidate.offerDetails && <small>Preparing offer…</small>}
                  {candidate.stage === "Hired" && (candidate.employeeId ? <Badge value="Employee added" /> : canManage && canHire ? <button className="primary" type="button" onClick={() => addAsEmployee(candidate)}>Add as employee</button> : null)}
                  {(canManage || (candidate.stage === "Interview" && candidate.interviewAssessment) || (candidate.stage === "Offer" && candidate.offerDetails)) && <details className="card-actions-menu"><summary>More actions</summary><div className="card-actions-menu__items">
                    {!canManage && candidate.stage === "Interview" && candidate.interviewAssessment && <button type="button" onClick={() => void downloadRecruitment(candidate, "interview-assessment")}>Assessment PDF</button>}
                    {!canManage && candidate.stage === "Offer" && candidate.offerDetails && <><button type="button" onClick={() => void downloadRecruitment(candidate, "interview-assessment")}>Assessment PDF</button><button type="button" onClick={() => void downloadRecruitment(candidate, "offer-letter")}>Offer PDF</button><button type="button" onClick={() => void downloadRecruitment(candidate, "nda")}>NDA PDF</button></>}
                    {canManage && <><button type="button" onClick={() => editCandidate(candidate)}>Edit candidate</button><button type="button" className="danger-outline" onClick={() => confirmDelete(candidate.name) && setState(prev => ({ ...prev, candidates: prev.candidates.filter(item => item.id !== candidate.id) }))}>Delete candidate</button></>}
                  </div></details>}
                </div>
              </article>;
            }) : <div className="empty compact">No {stage.toLowerCase()} candidates.</div>}
          </div>;
        })}
      </div>
    </div>
    {assessmentCandidateId && (() => { const candidate = state.candidates.find(item => item.id === assessmentCandidateId); const job = candidate && state.jobs.find(item => item.id === candidate.jobId); return candidate ? <InterviewAssessmentDialog candidate={candidate} job={job} value={assessmentInitialDraft} version={assessmentVersion} onSave={(draft, version) => saveAssessment(candidate.id, draft, version)} onRenew={() => renewAssessmentLease(candidate.id)} onDownload={() => void downloadRecruitment(candidate, "interview-assessment")} onClose={closeAssessment} /> : null; })()}
    {offerCandidateId && (() => { const candidate = state.candidates.find(item => item.id === offerCandidateId); const job = candidate && state.jobs.find(item => item.id === candidate.jobId); return candidate ? <OfferDocumentsDialog candidate={candidate} job={job} value={candidate.offerDetails ?? { issueDate: todayISO(), basic: 0, hra: 0, conveyance: 0, otherAllowance: 0, lineOfBusiness: job?.dept || "" }} onSave={draft => saveOffer(candidate.id, draft)} onDownload={document => void downloadRecruitment(candidate, document)} onClose={() => setOfferCandidateId("")} /> : null; })()}
  </section>;
}

function AssessmentCloseGuard({ requestClose }: { requestClose: () => void }) {
  useDialogCloseGuard(() => { requestClose(); return false; });
  return null;
}

function InterviewAssessmentDialog({ candidate, job, value, version, onSave, onRenew, onDownload, onClose }: { candidate: RecruitmentCandidate; job?: RecruitmentJob; value: InterviewAssessment; version: number; onSave: (draft: Partial<InterviewAssessment>, expectedVersion: number) => Promise<AssessmentResponse>; onRenew: () => Promise<AssessmentResponse>; onDownload: () => void; onClose: () => Promise<void> | void }) {
  const ratings: Array<[keyof InterviewAssessment, keyof InterviewAssessment, string]> = [
    ["greetingRating", "greetingRemarks", "Greeting, presentation and communication"], ["backgroundRating", "backgroundRemarks", "Background and experience"],
    ["technicalRating", "technicalRemarks", "Technical knowledge"], ["leadershipRating", "leadershipRemarks", "Leadership and competencies"]
  ];
  const [draft, setDraft] = useState(value);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error" | "unsaved">("saved");
  const draftRef = useRef(value);
  const dirtyKeys = useRef(new Set<keyof InterviewAssessment>());
  const versionRef = useRef(version);
  const saveQueue = useRef(Promise.resolve(true));
  const timer = useRef<number | undefined>(undefined);
  const retryTimer = useRef<number | undefined>(undefined);
  const retryCount = useRef(0);
  const closing = useRef(false);

  useEffect(() => { versionRef.current = version; }, [version]);
  useEffect(() => () => { window.clearTimeout(timer.current); window.clearTimeout(retryTimer.current); }, []);
  useEffect(() => {
    const heartbeat = window.setInterval(() => {
      void onRenew().then(updated => { versionRef.current = updated.version; }).catch(() => {
        setSaveState("error");
      });
    }, 30_000);
    return () => window.clearInterval(heartbeat);
  }, [onRenew]);

  function persist() {
    window.clearTimeout(timer.current);
    const save = async () => {
      const before = draftRef.current;
      const changedKeys = [...dirtyKeys.current];
      const changes = Object.fromEntries(changedKeys.map(key => [key, before[key] ?? null])) as Partial<InterviewAssessment>;
      if (!changedKeys.length) return true;
      setSaveState("saving");
      try {
        const updated = await onSave(changes, versionRef.current);
        versionRef.current = updated.version;
        const saved = updated.interviewAssessment ?? draftRef.current;
        const unchanged = draftRef.current === before;
        if (unchanged) {
          draftRef.current = saved;
          setDraft(saved);
        }
        changedKeys.forEach(key => { if (unchanged || draftRef.current[key] === before[key]) dirtyKeys.current.delete(key); });
        retryCount.current = 0;
        setSaveState(dirtyKeys.current.size ? "unsaved" : "saved");
        return true;
      } catch {
        const delay = Math.min(30_000, 1_000 * 2 ** retryCount.current++);
        setSaveState("error");
        try {
          const latest = await onRenew();
          versionRef.current = latest.version;
        } catch { /* The retry below keeps the active draft intact. */ }
        window.clearTimeout(retryTimer.current);
        retryTimer.current = window.setTimeout(() => { void persist(); }, delay);
        return false;
      }
    };
    saveQueue.current = saveQueue.current.then(save, save);
    return saveQueue.current;
  }

  function set(key: keyof InterviewAssessment, next: string | number | undefined, immediately = false) {
    const updated = { ...draftRef.current, [key]: next };
    draftRef.current = updated;
    dirtyKeys.current.add(key);
    setDraft(updated); setSaveState("unsaved");
    window.clearTimeout(timer.current);
    if (immediately) void persist();
    else timer.current = window.setTimeout(() => { void persist(); }, 200);
  }

  async function requestClose() {
    if (closing.current) return;
    closing.current = true;
    const saved = await persist();
    if (saved) await onClose();
    closing.current = false;
  }

  return <Dialog wide title="Interview assessment" onClose={onClose}>
    <AssessmentCloseGuard requestClose={() => { void requestClose(); }} />
    <div className="form-grid compact interview-assessment-form" onBlur={() => { void persist(); }}>
      <label>Candidate name<input value={draft.candidateName || candidate.name} readOnly /></label><label>Vacancy title<input value={draft.position || job?.title || "-"} readOnly /></label><label>Department<input value={draft.department || job?.dept || "-"} readOnly /></label><label>Interview date<input type="date" value={(draft.date || todayISO()).slice(0, 10)} onChange={event => set("date", event.target.value || undefined, true)} /></label>
      <label>Interview time<input value={draft.time || ""} onChange={event => set("time", event.target.value || undefined)} /></label><label>Venue<input value={draft.venue || ""} onChange={event => set("venue", event.target.value || undefined)} /></label>
      <label>Hiring name<input value={draft.hiringName || ""} onChange={event => set("hiringName", event.target.value || undefined)} /></label><label>Hiring department<input value={draft.hiringDepartment || job?.dept || ""} onChange={event => set("hiringDepartment", event.target.value || undefined)} /></label><label>Hiring position<input value={draft.hiringPosition || ""} onChange={event => set("hiringPosition", event.target.value || undefined)} /></label>
      {ratings.map(([ratingKey, remarksKey, label]) => <React.Fragment key={String(ratingKey)}><label>{label} rating<select value={String(draft[ratingKey] || "")} onChange={event => set(ratingKey, event.target.value ? Number(event.target.value) : undefined, true)}><option value="">Select 1–5</option>{[1, 2, 3, 4, 5].map(score => <option key={score}>{score}</option>)}</select></label><label className="wide">{label} remarks<textarea maxLength={2000} value={String(draft[remarksKey] || "")} onChange={event => set(remarksKey, event.target.value || undefined)} /></label></React.Fragment>)}
      <label>Overall rating<select value={String(draft.overallRating || "")} onChange={event => set("overallRating", event.target.value ? Number(event.target.value) : undefined, true)}><option value="">Select 1–5</option>{[1, 2, 3, 4, 5].map(score => <option key={score}>{score}</option>)}</select></label>
      <label>Visa status<input maxLength={500} value={draft.visaStatus || ""} onChange={event => set("visaStatus", event.target.value || undefined)} /></label><label>Driving licence<input maxLength={500} value={draft.drivingLicense || ""} onChange={event => set("drivingLicense", event.target.value || undefined)} /></label>
      <label>Current salary<input type="number" min="0" step="0.01" value={draft.currentSalary ?? ""} onChange={event => set("currentSalary", event.target.value === "" ? undefined : Number(event.target.value))} /></label><label>Expected salary<input type="number" min="0" step="0.01" value={draft.expectedSalary ?? ""} onChange={event => set("expectedSalary", event.target.value === "" ? undefined : Number(event.target.value))} /></label><label>Expected joining date<input type="date" value={(draft.expectedJoiningDate || "").slice(0, 10)} onChange={event => set("expectedJoiningDate", event.target.value || undefined, true)} /></label>
      <label className="wide">Interviewer comments<textarea maxLength={2000} value={draft.interviewerComments || ""} onChange={event => set("interviewerComments", event.target.value || undefined)} /></label><label className="wide">Manager comments<textarea maxLength={2000} value={draft.managerComments || ""} onChange={event => set("managerComments", event.target.value || undefined)} /></label>
    </div>
    <div className="modal-actions"><span className={`save-status save-status-${saveState}`} aria-live="polite">{saveState === "saving" || saveState === "unsaved" ? "Saving…" : saveState === "error" ? "Couldn’t save—retrying" : "Saved"}</span><button onClick={() => void requestClose()}>Close</button><button onClick={() => { void persist().then(saved => { if (saved) onDownload(); }); }}>Download PDF</button></div>
  </Dialog>;
}

function OfferDocumentsDialog({ candidate, job, value, onSave, onDownload, onClose }: { candidate: RecruitmentCandidate; job?: RecruitmentJob; value: OfferDetails; onSave: (draft: Partial<OfferDetails>) => Promise<Partial<OfferDetails>>; onDownload: (document: "interview-assessment" | "offer-letter" | "nda") => void; onClose: () => void }) {
  const [draft, setDraft] = useState(value);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error" | "unsaved">("saved");
  const draftRef = useRef(value);
  const dirtyKeys = useRef(new Set<keyof OfferDetails>());
  const saveQueue = useRef(Promise.resolve(true));
  const timer = useRef<number | undefined>(undefined);
  const retryTimer = useRef<number | undefined>(undefined);
  const retryCount = useRef(0);
  const closing = useRef(false);

  useEffect(() => () => { window.clearTimeout(timer.current); window.clearTimeout(retryTimer.current); }, []);

  function persist() {
    window.clearTimeout(timer.current);
    const save = async () => {
      const before = draftRef.current;
      const changedKeys = [...dirtyKeys.current];
      const changes = Object.fromEntries(changedKeys.map(key => [key, before[key] ?? null])) as Partial<OfferDetails>;
      if (!changedKeys.length) return true;
      setSaveState("saving");
      try {
        const saved = await onSave(changes);
        const unchanged = draftRef.current === before;
        if (unchanged) {
          draftRef.current = { ...before, ...saved };
          setDraft(draftRef.current);
        }
        changedKeys.forEach(key => { if (unchanged || draftRef.current[key] === before[key]) dirtyKeys.current.delete(key); });
        retryCount.current = 0;
        setSaveState(dirtyKeys.current.size ? "unsaved" : "saved");
        return true;
      } catch {
        const delay = Math.min(30_000, 1_000 * 2 ** retryCount.current++);
        setSaveState("error");
        window.clearTimeout(retryTimer.current);
        retryTimer.current = window.setTimeout(() => { void persist(); }, delay);
        return false;
      }
    };
    saveQueue.current = saveQueue.current.then(save, save);
    return saveQueue.current;
  }

  function set(key: keyof OfferDetails, next: string | number | undefined, immediately = false) {
    const updated = { ...draftRef.current, [key]: next };
    draftRef.current = updated;
    dirtyKeys.current.add(key);
    setDraft(updated); setSaveState("unsaved");
    window.clearTimeout(timer.current);
    if (immediately) void persist();
    else timer.current = window.setTimeout(() => { void persist(); }, 200);
  }

  async function requestClose() {
    if (closing.current) return;
    closing.current = true;
    if (await persist()) onClose();
    closing.current = false;
  }

  const total = Number(draft.basic || 0) + Number(draft.hra || 0) + Number(draft.conveyance || 0) + Number(draft.otherAllowance || 0);
  return <Dialog wide title="Offer stage documents" onClose={onClose}>
    <AssessmentCloseGuard requestClose={() => { void requestClose(); }} />
    <div className="form-grid compact">
      <label>Candidate name<input value={draft.candidateName || candidate.name} readOnly /></label><label>Designation<input value={draft.designation || job?.title || "-"} readOnly /></label><label>Line of Business<input value={draft.lineOfBusiness || job?.dept || "-"} readOnly /></label><label>Issue date<input type="date" value={(draft.issueDate || todayISO()).slice(0, 10)} onChange={event => set("issueDate", event.target.value || undefined, true)} /></label>
      <label>Basic<input type="number" min="0" step="0.01" value={draft.basic ?? 0} onChange={event => set("basic", Math.max(0, Number(event.target.value) || 0))} /></label><label>HRA<input type="number" min="0" step="0.01" value={draft.hra ?? 0} onChange={event => set("hra", Math.max(0, Number(event.target.value) || 0))} /></label><label>Conveyance<input type="number" min="0" step="0.01" value={draft.conveyance ?? 0} onChange={event => set("conveyance", Math.max(0, Number(event.target.value) || 0))} /></label><label>Other allowance<input type="number" min="0" step="0.01" value={draft.otherAllowance ?? 0} onChange={event => set("otherAllowance", Math.max(0, Number(event.target.value) || 0))} /></label><label>Contractual monthly pay<input value={formatMoney(total, "QAR")} readOnly /></label>
    </div>
    <div className="modal-actions"><span className={`save-status save-status-${saveState}`} aria-live="polite">{saveState === "saving" || saveState === "unsaved" ? "Saving…" : saveState === "error" ? "Couldn’t save—retrying" : "Saved"}</span><button onClick={() => void requestClose()}>Close</button>{candidate.interviewAssessment && <button onClick={() => { void persist().then(saved => { if (saved) onDownload("interview-assessment"); }); }}>Assessment PDF</button>}<button onClick={() => { void persist().then(saved => { if (saved) onDownload("offer-letter"); }); }}>Offer Letter PDF</button><button onClick={() => { void persist().then(saved => { if (saved) onDownload("nda"); }); }}>NDA PDF</button></div>
  </Dialog>;
}

function EOS({ state, setState, notify, savePdf }: { state: HrState; setState: React.Dispatch<React.SetStateAction<HrState>>; notify: Notify; savePdf: (file: GeneratedPdf | undefined, template: PdfTemplate, employeeId?: string) => void }) {
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
  const [confirmation, setConfirmation] = useState<ConfirmAction | null>(null);
  const employee = employees.find(item => item.id === employeeId);
  const summary = employee ? eosSummary(employee, state, asOf) : undefined;

  function updateRecord(id: string, patch: Partial<EosRecord>) {
    setState(prev => ({ ...prev, eosRecords: prev.eosRecords.map(item => item.id === id ? { ...item, ...patch } : item) }));
  }

  function requestRecordStatus(record: EosRecord, status: EosRecord["status"]) {
    const action = statusActionLabel(status, record.status);
    setConfirmation({ title: action === "Mark paid" ? "Mark this settlement paid?" : `${action} this settlement?`, description: `This changes the settlement to ${status.toLowerCase()}. You can undo it immediately after confirmation.`, confirmLabel: action, onConfirm: () => {
      updateRecord(record.id, { status });
      notify(`Settlement ${status.toLowerCase()}.`, { label: "Undo", onAction: () => updateRecord(record.id, { status: record.status }) });
    } });
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
  }

  function requestCloseEmployee(record: EosRecord) {
    const employee = state.employees.find(item => item.id === record.employeeId);
    if (!employee) return;
    const fields = { ...employee.fields };
    setConfirmation({ title: "Close this employee record?", description: "This marks the employee as resigned and records the settlement date. You can undo it immediately after confirmation.", confirmLabel: "Close employee", danger: true, onConfirm: () => {
      closeEmployee(record);
      notify("Employee marked resigned.", { label: "Undo", onAction: () => setState(previous => ({ ...previous, employees: previous.employees.map(item => item.id === employee.id ? { ...item, status: employee.status, fields } : item) })) });
    } });
  }

  return <><section className="stack">
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
            {canManage && record.status === "Draft" && <button onClick={() => requestRecordStatus(record, "Approved")}>Approve</button>}
            {canManage && record.status === "Approved" && <button onClick={() => requestRecordStatus(record, "Paid")}>Mark paid</button>}
            {canManage && record.status === "Paid" && <button className="danger-outline" onClick={() => requestCloseEmployee(record)}>Close employee</button>}
            {canExport && rowEmployee && <button onClick={() => void withPdf(pdf => savePdf(pdf.saveEosPdf(record, rowEmployee, state.settings), "final_settlement", rowEmployee.id))}>PDF</button>}
            {canManage && <button onClick={() => confirmDelete(`EOS record dated ${formatDate(record.asOf)}`) && setState(prev => ({ ...prev, eosRecords: prev.eosRecords.filter(item => item.id !== record.id) }))}>Delete</button>}
          </div>
        ];
      })} />
    </div>
  </section>{confirmation && <ActionConfirmation action={confirmation} close={() => setConfirmation(null)} />}</>;
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

  async function generate() {
    if (!employee) return notify("Select an employee first.");
    const [year, month] = payslipPeriod.split("-").map(Number);
    if (template === "payslip" && (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12)) return notify("Select a valid payslip month.");
    try {
      const file = await withPdf(pdf => pdf.saveEmployeeDocumentPdf(template, employee, state, notes, template === "payslip" ? { year, month } : undefined));
      savePdf(file, template, employee.id);
    } catch (error) {
      notify(errorMessage(error));
    }
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
          <button className="primary" onClick={() => void generate()}>{template === "payslip" ? "Generate payslip" : "Generate PDF"}</button>
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
  const [departments, setDepartments] = useState<DepartmentDraft[]>(() => state.settings.departments.map(name => ({ key: newId(), name })));
  const [leaveTypes, setLeaveTypes] = useState(() => state.settings.leaveTypes.map(item => ({ ...item })));
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [workdayHours, setWorkdayHours] = useState(state.settings.workdayHours);
  const [halfDayHours, setHalfDayHours] = useState(state.settings.halfDayHours);
  const [loanCapType, setLoanCapType] = useState(state.settings.loanDeductionCap.type);
  const [loanCapValue, setLoanCapValue] = useState(state.settings.loanDeductionCap.value);
  const [payrollProrationBasis, setPayrollProrationBasis] = useState(state.settings.payrollProrationBasis);
  const [payrollRequireBankDetails, setPayrollRequireBankDetails] = useState(state.settings.payrollRequireBankDetails);
  const [payrollRequireAttendance, setPayrollRequireAttendance] = useState(state.settings.payrollRequireAttendance);
  const [payrollVarianceThreshold, setPayrollVarianceThreshold] = useState(state.settings.payrollVarianceThreshold);
  const canSaveOrganizationSettings = canConfigureSystem || canManageDepartments || canConfigureLeave;
  const editorErrors = useMemo(() => settingsEditorErrors(departments, leaveTypes), [departments, leaveTypes]);
  const editableSettingsValid = (!canManageDepartments || !Object.keys(editorErrors.departments).length) && (!canConfigureLeave || !Object.keys(editorErrors.leaveTypes).length);
  const leaveDaysTotal = leaveTypes.reduce((total, item) => total + (Number.isFinite(item.days) ? item.days : 0), 0);

  function saveSettings() {
    if (!editableSettingsValid) {
      setAttemptedSave(true);
      window.setTimeout(() => document.querySelector<HTMLElement>(".settings-repeatable [aria-invalid='true']")?.focus(), 0);
      notify("Fix the highlighted Settings fields before saving.");
      return;
    }
    const nextDepartments = departments.map(item => item.name.trim());
    const nextLeaveTypes = leaveTypes.map(item => ({ ...item, name: item.name.trim() }));
    setState(prev => ({ ...prev, settings: {
      ...prev.settings,
      ...(canConfigureSystem ? { company, workdayHours: Math.max(0.25, workdayHours), halfDayHours: Math.max(0.25, Math.min(halfDayHours, workdayHours)), loanDeductionCap: { type: loanCapType, value: Math.max(0, loanCapType === "Percent" ? Math.min(100, loanCapValue) : loanCapValue) }, payrollProrationBasis, payrollRequireBankDetails, payrollRequireAttendance, payrollVarianceThreshold: Math.max(0, payrollVarianceThreshold) } : {}),
      ...(canManageDepartments ? { departments: nextDepartments } : {}),
      ...(canConfigureLeave ? { leaveTypes: nextLeaveTypes } : {})
    } }));
    setAttemptedSave(false);
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
    {canManageDepartments && sections.visible("departments") && <div className="panel"><div className="panel-head"><div><h3>Departments</h3><span>{departments.length} configured</span></div><button type="button" onClick={() => setDepartments(current => [...current, { key: newId(), name: "" }])}>Add department</button></div><div className="settings-repeatable" role="list" aria-label="Departments">{departments.map((department, index) => {
      const inputId = `settings-department-${department.key}`;
      const errorId = `${inputId}-error`;
      const error = editorErrors.departments[department.key];
      return <div className="settings-repeatable-row" role="listitem" key={department.key}><label htmlFor={inputId}>Department {index + 1}<input id={inputId} maxLength={150} value={department.name} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? errorId : undefined} onChange={event => setDepartments(current => current.map(item => item.key === department.key ? { ...item, name: event.target.value } : item))} /></label><button type="button" className="danger-outline settings-remove-row" aria-label={`Remove department ${department.name || index + 1}`} onClick={() => setDepartments(current => current.filter(item => item.key !== department.key))}><Trash2 size={15} aria-hidden="true" /> Remove</button>{error && <p className="field-error" id={errorId}>{error}</p>}</div>;
    })}</div><p className="settings-preview" aria-live="polite">Preview: {departments.filter(item => item.name.trim()).length} named department{departments.filter(item => item.name.trim()).length === 1 ? "" : "s"}.</p></div>}
    {canConfigureLeave && sections.visible("leave-types") && <div className="panel"><div className="panel-head"><div><h3>Leave Types</h3><span>{leaveTypes.length} configured</span></div><button type="button" onClick={() => setLeaveTypes(current => [...current, { id: newId(), name: "", code: "", days: 0, isPaid: true, requiresAttachment: false }])}>Add leave type</button></div><div className="settings-repeatable" role="list" aria-label="Leave types">{leaveTypes.map((leaveType, index) => {
      const nameId = `settings-leave-name-${leaveType.id}`;
      const daysId = `settings-leave-days-${leaveType.id}`;
      const nameError = editorErrors.leaveTypes[leaveType.id]?.name;
      const daysError = editorErrors.leaveTypes[leaveType.id]?.days;
      return <div className="settings-repeatable-row leave-type-row" role="listitem" key={leaveType.id}><label htmlFor={nameId}>Leave type {index + 1}<input id={nameId} maxLength={150} value={leaveType.name} aria-invalid={Boolean(nameError) || undefined} aria-describedby={nameError ? `${nameId}-error` : undefined} onChange={event => setLeaveTypes(current => current.map(item => item.id === leaveType.id ? { ...item, name: event.target.value } : item))} />{nameError && <span className="field-error" id={`${nameId}-error`}>{nameError}</span>}</label><label htmlFor={daysId}>Annual days<input id={daysId} type="number" min="0" max="366" step="0.01" value={leaveType.days} aria-invalid={Boolean(daysError) || undefined} aria-describedby={daysError ? `${daysId}-error` : undefined} onChange={event => setLeaveTypes(current => current.map(item => item.id === leaveType.id ? { ...item, days: Number(event.target.value) } : item))} />{daysError && <span className="field-error" id={`${daysId}-error`}>{daysError}</span>}</label><button type="button" className="danger-outline settings-remove-row" aria-label={`Remove leave type ${leaveType.name || index + 1}`} onClick={() => setLeaveTypes(current => current.filter(item => item.id !== leaveType.id))}><Trash2 size={15} aria-hidden="true" /> Remove</button></div>;
    })}</div><p className="settings-preview" aria-live="polite">Preview: {leaveTypes.filter(item => item.name.trim()).length} leave type{leaveTypes.filter(item => item.name.trim()).length === 1 ? "" : "s"} · {leaveDaysTotal.toFixed(2).replace(/\.00$/, "")} total annual days.</p></div>}
    {canConfigureSystem && sections.visible("payroll-policy") && <div className="panel"><div className="panel-head"><h3>Attendance Defaults</h3><span>Used for manual attendance</span></div><div className="form-grid compact"><label>Full day hours<input type="number" min="0.25" step="0.25" value={workdayHours} onChange={event => setWorkdayHours(Number(event.target.value))} /></label><label>Half-day hours<input type="number" min="0.25" step="0.25" max={workdayHours} value={halfDayHours} onChange={event => setHalfDayHours(Number(event.target.value))} /></label></div></div>}
    {canConfigureSystem && sections.visible("loan-policy") && <div className="panel"><div className="panel-head"><h3>Loan Deduction Limit</h3><span>Per employee, per payroll month</span></div><div className="form-grid compact"><label>Limit type<select value={loanCapType} onChange={event => setLoanCapType(event.target.value as "Amount" | "Percent")}><option>Amount</option><option>Percent</option></select></label><label>{loanCapType === "Percent" ? "Maximum % of gross salary" : `Maximum ${state.settings.company.currency} per month`}<input type="number" min="0" max={loanCapType === "Percent" ? 100 : undefined} step="0.01" value={loanCapValue} onChange={event => setLoanCapValue(Number(event.target.value) || 0)} /></label></div><p className="muted">Enter 0 for no company-wide cap. Individual loans can have a lower limit.</p></div>}
    {canConfigureSystem && sections.visible("payroll-policy") && <div className="panel"><div className="panel-head"><h3>Payroll Controls</h3><span>These values are snapshotted on every run.</span></div><div className="form-grid compact"><label>Proration basis<select value={payrollProrationBasis} onChange={event => setPayrollProrationBasis(event.target.value as "Fixed 30" | "Calendar Days")}><option>Fixed 30</option><option>Calendar Days</option></select></label><label>Net pay variance warning (%)<input type="number" min="0" max="1000" step="0.01" value={payrollVarianceThreshold} onChange={event => setPayrollVarianceThreshold(Number(event.target.value) || 0)} /></label><label className="checkbox-row"><input type="checkbox" checked={payrollRequireBankDetails} onChange={event => setPayrollRequireBankDetails(event.target.checked)} /> Require bank details before payroll</label><label className="checkbox-row"><input type="checkbox" checked={payrollRequireAttendance} onChange={event => setPayrollRequireAttendance(event.target.checked)} /> Block payroll when attendance is missing</label></div><p className="muted">Bank data is required by default. Attendance can remain a warning while the rollout is in progress.</p></div>}
    {canSaveOrganizationSettings && <div className="panel settings-save-panel"><div className="panel-head"><h3>Save Changes</h3></div><p className="muted">Save company, attendance, loan, department and leave settings.</p>{attemptedSave && !editableSettingsValid && <p className="sync-alert" role="alert">Some department or leave type fields need attention.</p>}<button className="primary" type="button" onClick={saveSettings}>Save settings</button></div>}
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

function DataTable({ columns, rows, empty, label = "Data table" }: { columns: React.ReactNode[]; rows: React.ReactNode[][]; empty?: React.ReactNode; label?: string }) {
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

function Toast({ toast, dismiss }: { toast: { message: string; action?: NotifyAction } | null; dismiss: () => void }) {
  if (!toast) return null;
  return <div className="toast" role="status" aria-live="polite"><span>{toast.message}</span>{toast.action && <button className="toast-action" type="button" onClick={() => { const action = toast.action; dismiss(); action?.onAction(); }}>{toast.action.label}</button>}<button type="button" aria-label="Dismiss notification" onClick={dismiss}><X size={16} aria-hidden="true" /></button></div>;
}

function ActionConfirmation({ action, close }: { action: ConfirmAction; close: () => void }) {
  return <Dialog title={action.title} description={action.description} onClose={close}>
    <div className="modal-actions"><button type="button" onClick={close}>Cancel</button><button type="button" className={action.danger ? "danger-outline" : "primary"} onClick={() => { action.onConfirm(); close(); }}>{action.confirmLabel}</button></div>
  </Dialog>;
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
const shellRoute = createRoute({ getParentRoute: () => rootRoute, id: "hr-shell", component: App, validateSearch: shellSearch });
const dashboardRoute = createRoute({ getParentRoute: () => shellRoute, path: "/" });
const meRoute = createRoute({ getParentRoute: () => shellRoute, path: "me" });
const approvalsRoute = createRoute({ getParentRoute: () => shellRoute, path: "approvals" });
const notificationsRoute = createRoute({ getParentRoute: () => shellRoute, path: "notifications" });
const teamRoute = createRoute({ getParentRoute: () => shellRoute, path: "team" });
const employeesRoute = createRoute({ getParentRoute: () => shellRoute, path: "employees" });
const attendanceRoute = createRoute({ getParentRoute: () => shellRoute, path: "attendance" });
const leaveRoute = createRoute({ getParentRoute: () => shellRoute, path: "leave" });
const businessTripsRoute = createRoute({ getParentRoute: () => shellRoute, path: "business-trips" });
const expensesRoute = createRoute({ getParentRoute: () => shellRoute, path: "expenses" });
const loansRoute = createRoute({ getParentRoute: () => shellRoute, path: "loans" });
const payrollRoute = createRoute({ getParentRoute: () => shellRoute, path: "payroll" });
const recruitmentRoute = createRoute({ getParentRoute: () => shellRoute, path: "recruitment" });
const performanceRoute = createRoute({ getParentRoute: () => shellRoute, path: "performance" });
const announcementsRoute = createRoute({ getParentRoute: () => shellRoute, path: "announcements" });
const announcementDetailRoute = createRoute({ getParentRoute: () => shellRoute, path: "announcements/$announcementId" });
const certificatesRoute = createRoute({ getParentRoute: () => shellRoute, path: "certificates" });
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
    approvalsRoute,
    notificationsRoute,
    teamRoute,
    employeesRoute,
    attendanceRoute,
    leaveRoute,
    businessTripsRoute,
    expensesRoute,
    loansRoute,
    payrollRoute,
    recruitmentRoute,
    performanceRoute,
    announcementsRoute,
    announcementDetailRoute,
    certificatesRoute,
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
