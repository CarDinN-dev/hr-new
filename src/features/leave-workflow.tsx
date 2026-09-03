import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, FileText, Paperclip, ShieldCheck, Upload, X } from "lucide-react";
import { apiList, apiRequest, hasActiveSuperAdminRole, hasAnyPermission, hasPermission, startMicrosoftStepUp, type BackendSession } from "../api";
import { Dialog } from "../dialog";
import { EmployeePicker } from "../employee-picker";
import { displayDate, displayTitle, idempotencyHeaders, workflowKey } from "./workflow-utils";
import { usePageSearch, usePageSearchStatus } from "../page-search";
import { useDeepLinkFocus, useHashRecordId } from "../deep-link";

const searched = (path: string, search: string) => search ? `${path}${path.includes("?") ? "&" : "?"}search=${encodeURIComponent(search)}` : path;

type LeaveAttachment = { id: string; fileName: string; fileUrl: string; contentType: string; sizeBytes: number; scanStatus: string; scannedAt?: string | null; createdAt: string };
export type LeaveRecord = {
  id: string; version: number; requesterUserId: string; employeeId: string; status: string; currentStage?: string | null; routeType: string;
  startDate: string; endDate: string; totalDays: string; paidDays: string; unpaidDays: string; isHalfDay: boolean; reason?: string | null;
  employee: { employeeCode: string; firstName: string; lastName: string };
  leaveType: { id: string; name: string; code: string; requiresAttachment: boolean };
  attachments?: LeaveAttachment[];
  steps: Array<{ id: string; stage: string; status: string; sequence: number; workflowVersion: number; selfApprovalAllowed: boolean; decidedAt?: string | null; reason?: string | null; assignees: Array<{ userId: string; isActive: boolean; revokedAt?: string | null; user?: { email: string } }> }>;
  decisions?: Array<{ id: string; decisionType: string; stage?: string | null; fromStatus: string; toStatus: string; reason?: string | null; createdAt: string; actor: { email: string } }>;
};
type LeaveTypeRecord = { id: string; name: string; code: string; annualAllowanceDays: string; isPaid: boolean; requiresAttachment: boolean };
type LeaveBalance = { id: string; totalDays: string; usedDays: string; pendingDays: string; availableDays: string; noBalanceRequired: boolean; eligible: boolean; leaveType: LeaveTypeRecord };
type LeavePreview = { totalDays: string | null; paidDays: string | null; unpaidDays: string | null; eligible: boolean; message?: string | null; requiresAttachment: boolean; availableDays: string | null; noBalanceRequired: boolean };
type LeaveEmployee = { id: string; employeeCode: string; firstName: string; lastName: string };
type EligibleAssignee = { id: string; email: string; employee?: { firstName: string; lastName: string } | null };
type DecisionAction = "approve" | "self-approve" | "reject" | "return" | "cancel" | "reassign" | "override" | "correct-resubmit";
type Decision = { request: LeaveRecord; action: DecisionAction; reasonRequired: boolean };

const attachmentAccept = ".pdf,.jpg,.jpeg,.png,.webp";
const finalStatuses = ["APPROVED", "REJECTED", "CANCELLED"];

function leaveStatusTone(status: string) {
  const value = status.toUpperCase();
  if (value.includes("APPROVED")) return "good";
  if (value.includes("REJECTED") || value.includes("CANCELLED")) return "bad";
  if (value.includes("PENDING") || value.includes("RETURNED") || value.includes("BLOCKED")) return "warn";
  return "neutral";
}

function codeOf(type?: Pick<LeaveTypeRecord, "code" | "name">) {
  const code = type?.code?.trim().toUpperCase();
  if (code) return code;
  return type?.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_") ?? "";
}

function halfDayDisabled(type?: Pick<LeaveTypeRecord, "code" | "name">) {
  return ["UMRAH_HAJJ", "COMPASSIONATE", "MATERNITY"].includes(codeOf(type));
}

function hasDateRange(startDate: string, endDate: string) {
  return Boolean(startDate && endDate && startDate !== endDate);
}

function days(value: string | number | null | undefined) {
  if (value == null || value === "") return "—";
  const amount = Number(value);
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
}

function fileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function LeaveTypePicker({ value, options, onChange }: { value: string; options: readonly LeaveTypeRecord[]; onChange: (value: string) => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 0 });
  const selected = options.find(type => type.id === value);

  function placeMenu() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    let bounds = trigger.getBoundingClientRect();
    if (window.innerHeight - bounds.bottom < 52) {
      trigger.scrollIntoView({ block: "center", inline: "nearest" });
      bounds = trigger.getBoundingClientRect();
    }
    setPosition({ top: bounds.bottom + 4, left: bounds.left, width: bounds.width, maxHeight: Math.min(288, window.innerHeight - bounds.bottom - 8) });
  }

  function showMenu() {
    setActiveIndex(Math.max(0, options.findIndex(type => type.id === value)));
    placeMenu();
    setOpen(true);
  }

  function choose(index: number) {
    const type = options[index];
    if (!type) return;
    onChange(type.id);
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("resize", placeMenu);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.removeEventListener("resize", placeMenu);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [open]);

  return <div className="leave-type-picker">
    <button ref={triggerRef} className="leave-type-picker__trigger" type="button" aria-label="Leave type" aria-haspopup="listbox" aria-controls={menuId} aria-expanded={open} disabled={!options.length} onClick={() => open ? setOpen(false) : showMenu()} onKeyDown={event => {
      if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); }
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!open) showMenu();
        else setActiveIndex(current => (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
      } else if ((event.key === "Enter" || event.key === " ") && open) { event.preventDefault(); choose(activeIndex); }
    }}><span>{selected?.name ?? "Choose leave type"}</span><ChevronDown size={16} aria-hidden="true" /></button>
    {open && createPortal(<div ref={menuRef} id={menuId} className="leave-type-picker__options" role="listbox" aria-label="Leave type choices" style={position}>{options.map((type, index) => <button className={[type.id === value && "is-selected", index === activeIndex && "is-active"].filter(Boolean).join(" ")} type="button" role="option" aria-selected={type.id === value} key={type.id} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(index)}>{type.name}</button>)}</div>, document.body)}
  </div>;
}

function requestBody(form: { employeeId?: string; leaveTypeId: string; startDate: string; endDate: string; isHalfDay: boolean; reason?: string }, file?: File | null, expectedVersion?: number) {
  const body = new FormData();
  if (form.employeeId) body.set("employeeId", form.employeeId);
  body.set("leaveTypeId", form.leaveTypeId);
  body.set("startDate", form.startDate);
  body.set("endDate", form.endDate);
  body.set("isHalfDay", String(form.isHalfDay));
    if (form.reason?.trim()) body.set("reason", form.reason.trim());
  if (expectedVersion !== undefined) body.set("expectedVersion", String(expectedVersion));
  if (file) body.set("file", file);
  return body;
}

export function MyLeaveStatusPanel({ session, onOpenLeave }: { session: BackendSession; onOpenLeave: () => void }) {
  const { search } = usePageSearch();
  const requests = useQuery({ queryKey: [...workflowKey(session, "my-leave-status"), search], queryFn: () => apiList<LeaveRecord>(searched("/leave/mine", search)), enabled: Boolean(session.employeeId) && hasPermission(session, "leave.self.read") });
  usePageSearchStatus("my-leave", { count: requests.data?.length, loading: requests.isFetching, error: requests.error?.message });
  if (!hasPermission(session, "leave.self.read")) return null;
  const current = requests.data?.find(request => !finalStatuses.includes(request.status)) ?? requests.data?.[0];
  return <section className="panel span-2"><div className="panel-head"><div><h3>Current leave application</h3><span>Your latest active request, or most recent completed request.</span></div><button type="button" onClick={onOpenLeave}>View Leave</button></div>
    {requests.isPending ? <p className="muted">Loading leave application...</p> : requests.isError ? <p className="sync-alert">{requests.error.message}</p> : !current ? <div className="empty compact">No leave applications yet.</div> : <div className="list-row"><div><strong>{current.leaveType.name}</strong><span>{displayDate(current.startDate)} – {displayDate(current.endDate)} · {current.totalDays} day(s)</span></div><span className={`badge ${leaveStatusTone(current.status)}`}>{displayTitle(current.status)}</span></div>}
  </section>;
}

export function LeaveWorkflowPage({ session, notify }: { session: BackendSession; notify: (message: string) => void }) {
  const client = useQueryClient();
  const { search } = usePageSearch();
  const isSuperAdmin = hasActiveSuperAdminRole(session);
  const canSubmitForEmployee = hasPermission(session, "leave.hr.manage");
  const canHrOverride = hasPermission(session, "leave.hr.override");
  const canSuperOverride = hasPermission(session, "leave.override");
  const broad = hasAnyPermission(session, "leave.team.read", "leave.management.read", "leave.hr.read", "leave.read_all");
  const canInbox = hasAnyPermission(session, "leave.team.approve_line_manager", "leave.management.approve_manager", "leave.hr.approve", "leave.executive.approve_cpo", "leave.executive.approve_coo", "leave.executive.self_approve_coo");
  const selfService = !broad && !canSubmitForEmployee;
  const records = useQuery({ queryKey: [...workflowKey(session, "leave-records", broad), search], queryFn: () => apiList<LeaveRecord>(searched(broad ? "/leave/requests" : "/leave/mine", search)) });
  const inbox = useQuery({ queryKey: [...workflowKey(session, "leave-inbox"), search], queryFn: () => apiList<LeaveRecord>(searched("/leave/inbox", search)), enabled: canInbox });
  usePageSearchStatus("leave-records", { count: records.data?.length, loading: records.isFetching, error: records.error?.message });
  usePageSearchStatus("leave-inbox", { count: inbox.data?.length, loading: inbox.isFetching, error: inbox.error?.message });
  const leaveTypes = useQuery({ queryKey: workflowKey(session, "leave-types"), queryFn: () => apiList<LeaveTypeRecord>("/leave/types") });
  const employees = useQuery({ queryKey: workflowKey(session, "leave-employees"), queryFn: () => apiList<LeaveEmployee>("/employees?limit=1000"), enabled: canSubmitForEmployee });
  const [form, setForm] = useState({ employeeId: "", leaveTypeId: "", startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), isHalfDay: false });
  const [attachment, setAttachment] = useState<File | null>(null);
  const [submittedRequest, setSubmittedRequest] = useState<LeaveRecord | null>(null);
  const selectedType = leaveTypes.data?.find(type => type.id === form.leaveTypeId) ?? leaveTypes.data?.[0];
  const selectedLeaveTypeId = selectedType?.id ?? "";
  const targetEmployeeId = canSubmitForEmployee ? form.employeeId : session.employeeId ?? "";
  const balanceYear = Number(form.startDate.slice(0, 4)) || new Date().getFullYear();
  const balances = useQuery({ queryKey: workflowKey(session, "leave-balances", targetEmployeeId, balanceYear), queryFn: () => apiList<LeaveBalance>(`/leave/balances?employeeId=${encodeURIComponent(targetEmployeeId)}&year=${balanceYear}`), enabled: Boolean(targetEmployeeId) });
  const preview = useQuery({
    queryKey: workflowKey(session, "leave-preview", targetEmployeeId, selectedLeaveTypeId, form.startDate, form.endDate, form.isHalfDay),
    queryFn: () => apiRequest<LeavePreview>("/leave/preview", { method: "POST", csrfToken: session.csrfToken, body: JSON.stringify({ employeeId: canSubmitForEmployee ? targetEmployeeId : undefined, leaveTypeId: selectedLeaveTypeId, startDate: form.startDate, endDate: form.endDate, isHalfDay: form.isHalfDay }) }),
    enabled: Boolean(targetEmployeeId && selectedLeaveTypeId && form.startDate && form.endDate), retry: false,
  });
  const [decision, setDecision] = useState<Decision | null>(null);
  const requiresStepUp = decision?.action === "self-approve" && !isSuperAdmin;
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionPassword, setDecisionPassword] = useState("");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [overrideStatus, setOverrideStatus] = useState<"APPROVED" | "REJECTED" | "CANCELLED">("APPROVED");
  const [correction, setCorrection] = useState({ leaveTypeId: "", startDate: "", endDate: "", isHalfDay: false, reason: "" });
  const [correctionFile, setCorrectionFile] = useState<File | null>(null);
  const correctionType = leaveTypes.data?.find(type => type.id === correction.leaveTypeId);
  const formHasDateRange = hasDateRange(form.startDate, form.endDate);
  const correctionHasDateRange = hasDateRange(correction.startDate, correction.endDate);
  const previewNeedsMoreBalance = Boolean(preview.data && !preview.data.noBalanceRequired && preview.data.paidDays != null && preview.data.availableDays != null && Number(preview.data.paidDays) > Number(preview.data.availableDays));
  const [timelineId, setTimelineId] = useState<string | null>(null);
  const timeline = useQuery({ queryKey: workflowKey(session, "leave-timeline", timelineId), queryFn: () => apiRequest<LeaveRecord>(`/leave/${timelineId}/timeline`), enabled: Boolean(timelineId) });
  const eligible = useQuery({ queryKey: workflowKey(session, "leave-assignees", decision?.request.id), queryFn: () => apiRequest<EligibleAssignee[]>(`/leave/${decision!.request.id}/eligible-assignees`), enabled: decision?.action === "reassign" });
  const invalidate = () => Promise.all([
    client.invalidateQueries({ queryKey: workflowKey(session, "leave-records", broad) }), client.invalidateQueries({ queryKey: workflowKey(session, "leave-inbox") }),
    client.invalidateQueries({ queryKey: workflowKey(session, "approval-inbox") }), client.invalidateQueries({ queryKey: workflowKey(session, "leave-balances", targetEmployeeId, balanceYear) }),
    client.invalidateQueries({ queryKey: workflowKey(session, "leave-preview") }),
  ]);
  const submit = useMutation({
    mutationFn: () => apiRequest<LeaveRecord>("/leave/submit", { method: "POST", csrfToken: session.csrfToken, headers: idempotencyHeaders(), body: requestBody({ ...form, employeeId: canSubmitForEmployee ? targetEmployeeId : undefined, leaveTypeId: selectedLeaveTypeId }, attachment) }),
    onSuccess: async request => {
      const today = new Date().toISOString().slice(0, 10);
      setSubmittedRequest(request);
      setAttachment(null);
      setForm(previous => ({ ...previous, startDate: today, endDate: today, isHalfDay: false }));
      await invalidate();
    },
  });
  const replaceAttachment = useMutation({
    mutationFn: ({ request, file }: { request: LeaveRecord; file: File }) => { const body = new FormData(); body.set("file", file); return apiRequest<LeaveRecord>(`/leave/${request.id}/attachment`, { method: "POST", csrfToken: session.csrfToken, body }); },
    onSuccess: async () => { await invalidate(); notify("Leave attachment replaced."); },
  });
  const decide = useMutation({
    mutationFn: async (target: Decision) => {
      const protectedDecision = target.action === "self-approve" && !isSuperAdmin;
      if (protectedDecision && session.authProvider === "local") {
        if (!decisionPassword) throw new Error("Enter your password for this protected decision.");
        await apiRequest("/auth/step-up/local", { method: "POST", csrfToken: session.csrfToken, body: JSON.stringify({ password: decisionPassword }) });
      }
      if (target.action === "correct-resubmit") {
        const updated = await apiRequest<LeaveRecord>(`/leave/${target.request.id}/correction`, { method: "POST", csrfToken: session.csrfToken, headers: idempotencyHeaders(), body: requestBody({ ...correction, leaveTypeId: correction.leaveTypeId }, correctionFile, target.request.version) });
        return apiRequest<LeaveRecord>(`/leave/${target.request.id}/resubmit`, { method: "POST", csrfToken: session.csrfToken, headers: idempotencyHeaders(), body: JSON.stringify({ expectedVersion: updated.version, reason: decisionReason.trim() || undefined }) });
      }
      const body: Record<string, unknown> = { expectedVersion: target.request.version, ...(decisionReason.trim() ? { reason: decisionReason.trim() } : {}) };
      if (target.action === "reassign") body.assigneeUserId = assigneeUserId;
      if (target.action === "override") body.targetStatus = overrideStatus;
      return apiRequest<LeaveRecord>(`/leave/${target.request.id}/${target.action}`, { method: "POST", csrfToken: session.csrfToken, headers: idempotencyHeaders(), body: JSON.stringify(body) });
    },
    onSuccess: async () => { await invalidate(); setDecision(null); setDecisionReason(""); setDecisionPassword(""); setAssigneeUserId(""); setCorrectionFile(null); notify("Leave request updated."); },
  });

  const inboxIds = new Set((inbox.data ?? []).map(item => item.id));
  const all = useMemo(() => { const map = new Map<string, LeaveRecord>(); for (const item of [...(records.data ?? []), ...(inbox.data ?? [])]) map.set(item.id, item); return [...map.values()]; }, [records.data, inbox.data]);
  const focusedRequestId = useHashRecordId("leave");
  useDeepLinkFocus("leave", focusedRequestId, records.isSuccess && (!canInbox || inbox.isSuccess), all.some(item => item.id === focusedRequestId), notify);
  function openDecision(request: LeaveRecord, action: DecisionAction, reasonRequired = false) {
    setDecision({ request, action, reasonRequired }); setDecisionReason(""); setDecisionPassword(""); setAssigneeUserId(""); setCorrectionFile(null);
    setCorrection({ leaveTypeId: request.leaveType.id, startDate: request.startDate.slice(0, 10), endDate: request.endDate.slice(0, 10), isHalfDay: request.isHalfDay, reason: request.reason || "" });
  }

  return <section className="stack leave-workflow">
    {(Boolean(session.employeeId) || canSubmitForEmployee) && hasPermission(session, "leave.self.create") && <div className="leave-workspace-grid">
      <div className="panel leave-balance-panel"><div className="panel-head"><div><h3>Leave balance</h3><span>{targetEmployeeId ? (canSubmitForEmployee ? `${balanceYear} balances for the selected employee` : `Your ${balanceYear} leave balances`) : "Choose an employee to see their balances"}</span></div></div>
        {!targetEmployeeId ? <div className="leave-balance-empty"><strong>Balance ready when you are</strong><span>Select an employee in the request form to review their available leave before submitting.</span></div> : balances.isPending ? <div className="leave-balance-skeleton" aria-label="Loading leave balances"><span /><span /><span /></div> : balances.isError ? <p className="sync-alert">{balances.error.message}</p> : <div className="leave-balance-grid">{balances.data?.map(balance => {
          const emptyBalance = balance.eligible && !balance.noBalanceRequired && Number(balance.availableDays) <= 0;
          return <article className={`leave-balance-card${balance.noBalanceRequired ? " is-unlimited" : balance.eligible ? "" : " is-unavailable"}${emptyBalance ? " is-empty" : ""}`} key={balance.leaveType.id}>
            <header><strong>{balance.leaveType.name}</strong></header>
            {balance.noBalanceRequired ? <div className="leave-balance-card__state"><strong>No balance required</strong><span>This leave type is not deducted from an annual allowance.</span></div> : balance.eligible ? <><div className="leave-balance-card__available"><span>Available</span><strong>{days(balance.availableDays)}<small> days</small></strong></div>{emptyBalance && <span className="leave-balance-card__notice">No days currently available</span>}<dl><div><dt>Total</dt><dd><strong>{days(balance.totalDays)}</strong><span>days</span></dd></div><div><dt>Used</dt><dd><strong>{days(balance.usedDays)}</strong><span>days</span></dd></div><div><dt>Pending</dt><dd><strong>{days(balance.pendingDays)}</strong><span>days</span></dd></div></dl></> : <div className="leave-balance-card__state"><strong>Unavailable</strong><span>This leave type is not currently eligible.</span></div>}
          </article>;
        })}{!balances.data?.length && <div className="empty compact">No active leave types.</div>}</div>}
      </div>
      <div className="panel leave-request-panel"><div className="panel-head"><div><h3>Request leave</h3><span>Dates, paid days, and balance eligibility are calculated by the server.</span></div></div>
        {submittedRequest && <div className="leave-submit-success" role="status" aria-live="polite"><CheckCircle2 size={22} aria-hidden="true" /><div><strong>Leave request submitted</strong><span>{submittedRequest.leaveType.name} · {displayDate(submittedRequest.startDate)} – {displayDate(submittedRequest.endDate)} · {days(submittedRequest.totalDays)} day(s) · {displayTitle(submittedRequest.status)}</span></div><button type="button" aria-label="Dismiss submitted leave confirmation" onClick={() => setSubmittedRequest(null)}><X size={16} aria-hidden="true" /></button></div>}
        <div className="leave-request-sections">
          <section className="leave-form-section" aria-labelledby="leave-request-details"><div className="leave-form-section__heading"><h4 id="leave-request-details">Request details</h4><p>Choose who the leave is for and the applicable leave type.</p></div><div className="form-grid compact leave-request-grid">
            {canSubmitForEmployee && <label>Employee<EmployeePicker value={form.employeeId} onChange={employeeId => setForm(previous => ({ ...previous, employeeId }))} options={employees.data?.map(employee => ({ id: employee.id, label: `${employee.employeeCode} — ${employee.firstName} ${employee.lastName}` })) ?? []} clearable /></label>}
            <label className={canSubmitForEmployee ? undefined : "wide"}>Leave type<LeaveTypePicker value={selectedLeaveTypeId} options={leaveTypes.data ?? []} onChange={leaveTypeId => { const type = leaveTypes.data?.find(item => item.id === leaveTypeId); setForm(previous => ({ ...previous, leaveTypeId, isHalfDay: halfDayDisabled(type) ? false : previous.isHalfDay })); setAttachment(null); }} /></label>
          </div></section>
          <section className="leave-form-section" aria-labelledby="leave-request-dates"><div className="leave-form-section__heading"><h4 id="leave-request-dates">When</h4><p>Set the date range and duration for this request.</p></div><div className="form-grid compact leave-request-grid">
            <label>From<input type="date" value={form.startDate} onChange={event => setForm(previous => ({ ...previous, startDate: event.target.value, isHalfDay: hasDateRange(event.target.value, previous.endDate) ? false : previous.isHalfDay }))} /></label>
            <label>To<input type="date" value={form.endDate} onChange={event => setForm(previous => ({ ...previous, endDate: event.target.value, isHalfDay: hasDateRange(previous.startDate, event.target.value) ? false : previous.isHalfDay }))} /></label>
            <label className="wide">Duration<select value={form.isHalfDay ? "half" : "full"} disabled={halfDayDisabled(selectedType)} onChange={event => setForm(previous => ({ ...previous, isHalfDay: event.target.value === "half" }))}><option value="full">Full day(s)</option><option value="half" disabled={formHasDateRange}>Half day</option></select></label>
          </div></section>
          {(preview.data?.requiresAttachment || selectedType?.requiresAttachment) && <section className="leave-form-section" aria-labelledby="leave-request-supporting"><div className="leave-form-section__heading"><h4 id="leave-request-supporting">Supporting document</h4><p>Add a PDF or image for this leave type. It must pass virus scanning before approval.</p></div>
            <div className="leave-file-field"><label className="leave-file-picker"> <input key={attachment ? `${attachment.name}-${attachment.lastModified}` : "new-attachment"} type="file" accept={attachmentAccept} aria-label="Attachment (required)" onChange={event => setAttachment(event.target.files?.[0] ?? null)} /><Upload size={18} aria-hidden="true" /><span><strong>{attachment ? "Choose a different attachment" : "Add required attachment"}</strong><small>PDF, JPG, PNG, or WebP · up to 10 MB</small></span></label>{attachment && <div className="leave-selected-file" role="status"><FileText size={18} aria-hidden="true" /><span><strong>{attachment.name}</strong><small>{fileSize(attachment.size)} · Ready to save with this request</small></span><button type="button" aria-label="Remove selected attachment" onClick={() => setAttachment(null)}><X size={16} /></button></div>}</div>
          </section>}
        </div>
        {preview.data && <div className="leave-request-estimate" aria-busy={preview.isFetching}><div className="leave-request-estimate__heading"><strong>Request estimate</strong><span role="status" aria-live="polite">{preview.isFetching ? "Refreshing estimate…" : "Calculated from your current selection"}</span></div><div className="settlement-preview"><div><span>Total</span><strong>{days(preview.data.totalDays)}</strong></div><div><span>Paid</span><strong>{days(preview.data.paidDays)}</strong></div><div><span>Unpaid</span><strong>{days(preview.data.unpaidDays)}</strong></div><div><span>Available</span><strong>{preview.data.noBalanceRequired ? "No balance required" : days(preview.data.availableDays)}</strong></div></div></div>}
        {preview.data && !preview.data.eligible && <p className="leave-balance-warning" role="alert"><strong>{previewNeedsMoreBalance ? "Not enough leave balance for this request." : "This leave request is not eligible."}</strong><span>{previewNeedsMoreBalance ? `This request needs ${days(preview.data.paidDays)} paid day(s), but only ${days(preview.data.availableDays)} day(s) are available. Choose a shorter range or another leave type.` : preview.data.message || "This leave request is not eligible."}</span></p>}
        <div className="leave-submit-row"><span>{attachment ? "Your attachment will be saved with this request." : "Review the request estimate before submitting."}</span><div className="form-actions"><button className="primary" disabled={submit.isPending || preview.isPending || !selectedLeaveTypeId || !targetEmployeeId || preview.data?.eligible === false || Boolean(preview.data?.requiresAttachment && !attachment)} onClick={() => submit.mutate()}>{submit.isPending ? "Submitting…" : "Submit request"}</button></div></div>
        {submit.isError && <p className="sync-alert" role="alert">{submit.error.message}</p>}
      </div>
    </div>}
    <div className="panel leave-requests-panel"><div className="panel-head"><div><h3>{selfService ? "My leave requests" : "Leave requests"}</h3><span>{all.length} {all.length === 1 ? "request" : "requests"}{!selfService && <> · {inbox.data?.length ?? 0} awaiting your decision</>}</span></div></div>{records.isPending || (canInbox && inbox.isPending) ? <p className="muted">Loading leave requests…</p> : records.isError ? <p className="sync-alert">{records.error.message}</p> : <div className="table-wrap table-wide table-actions" role="region" aria-label="Leave requests"><table><thead><tr>{!selfService && <th>Employee</th>}<th>Leave</th><th>Dates</th><th>Paid / unpaid</th><th>Attachment</th><th>Status</th><th>Actions</th></tr></thead><tbody>{all.map(request => {
      const own = request.employeeId === session.employeeId;
      const ownRequest = own && request.requesterUserId === session.id;
      const assigned = inboxIds.has(request.id);
      const selfApproval = own && request.routeType === "COO_SELF" && request.currentStage === "COO" && hasPermission(session, "leave.executive.self_approve_coo");
      const canReplace = !finalStatuses.includes(request.status) && (own || canSubmitForEmployee);
      const canCancel = ownRequest && (request.status.startsWith("PENDING_") || request.status === "RETURNED_FOR_CORRECTION" || request.status === "BLOCKED_APPROVER_MISSING") && hasPermission(session, "leave.self.cancel");
      const canReassign = Boolean(request.currentStage) && hasPermission(session, "leave.reassign");
      const canHrDirectOverride = canHrOverride && !canSuperOverride && !own && !finalStatuses.includes(request.status);
      const canSuperDirectOverride = canSuperOverride && !finalStatuses.includes(request.status);
      const hasMoreActions = (assigned && !selfApproval) || canCancel || canReassign || canSuperDirectOverride;
      return <tr id={`leave-${request.id}`} tabIndex={-1} className="leave-request-row" key={request.id}>
        {!selfService && <td data-label="Employee"><div className="leave-request-person"><strong>{request.employee.firstName} {request.employee.lastName}</strong><span>{request.employee.employeeCode}</span></div></td>}
        <td data-label="Leave"><div className="leave-request-type"><strong>{request.leaveType.name}</strong><span>{request.totalDays} day(s)</span></div></td>
        <td data-label="Dates">{displayDate(request.startDate)} – {displayDate(request.endDate)}</td>
        <td data-label="Paid / unpaid"><span className="leave-request-days">{days(request.paidDays)} <small>paid</small> · {days(request.unpaidDays)} <small>unpaid</small></span></td>
        <td data-label="Attachment"><div className="leave-request-attachments">{request.attachments?.map(file => <a className="leave-attached-file" href={file.fileUrl} target="_blank" rel="noreferrer" key={file.id}><FileText size={16} aria-hidden="true" /><span><strong>{file.fileName}</strong><small>{fileSize(file.sizeBytes)} · {displayTitle(file.scanStatus)}</small></span></a>)}{!request.attachments?.length && <span className="leave-no-attachment">No attachment</span>}{canReplace && <label className="leave-replace-attachment"><input type="file" accept={attachmentAccept} aria-label={`${request.attachments?.length ? "Replace" : "Add"} attachment for ${request.leaveType.name} request`} disabled={replaceAttachment.isPending} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) replaceAttachment.mutate({ request, file }); }} /><Paperclip size={15} aria-hidden="true" />{replaceAttachment.isPending ? "Saving…" : request.attachments?.length ? "Replace attachment" : "Add attachment"}</label>}</div></td>
        <td data-label="Status"><div className="leave-request-status"><span className={`badge ${leaveStatusTone(request.status)}`}>{displayTitle(request.status)}</span>{request.currentStage && <small>{displayTitle(request.currentStage)} stage</small>}</div></td>
        <td data-label="Actions"><div className="leave-request-actions"><button type="button" onClick={() => setTimelineId(request.id)}>Timeline</button>{assigned && !selfApproval && <button type="button" className="primary" onClick={() => openDecision(request, "approve")}>Approve</button>}{selfApproval && <button type="button" className="primary" onClick={() => openDecision(request, "self-approve")}>Self-approve</button>}{ownRequest && request.status === "RETURNED_FOR_CORRECTION" && <button type="button" className="primary" onClick={() => openDecision(request, "correct-resubmit")}>Correct and resubmit</button>}{canHrDirectOverride && <button type="button" className="primary" onClick={() => { setOverrideStatus("APPROVED"); openDecision(request, "override", true); }}>Override & approve</button>}{hasMoreActions && <details className="leave-request-more-actions"><summary>More actions</summary><div>{assigned && !selfApproval && <><button type="button" onClick={() => openDecision(request, "return", true)}>Return</button><button type="button" className="danger-outline" onClick={() => openDecision(request, "reject", true)}>Reject</button></>}{canCancel && <button type="button" onClick={() => openDecision(request, "cancel", true)}>Cancel</button>}{canReassign && <button type="button" onClick={() => openDecision(request, "reassign", true)}>Reassign</button>}{canSuperDirectOverride && <button type="button" onClick={() => openDecision(request, "override", true)}>Override</button>}</div></details>}</div></td>
      </tr>;
    })}</tbody></table>{!all.length && <div className="empty">No leave requests.</div>}{replaceAttachment.isError && <p className="sync-alert">{replaceAttachment.error.message}</p>}</div>}</div>
    {decision && <Dialog wide title={decision.action === "override" && canHrOverride && !canSuperOverride ? "Override & approve" : `${displayTitle(decision.action)} leave`} onClose={() => setDecision(null)}><p>Employee: {decision.request.employee.firstName} {decision.request.employee.lastName}</p>{decision.action === "correct-resubmit" && <div className="form-grid compact"><label>Leave type<select value={correction.leaveTypeId} onChange={event => { const type = leaveTypes.data?.find(item => item.id === event.target.value); setCorrection(previous => ({ ...previous, leaveTypeId: event.target.value, isHalfDay: halfDayDisabled(type) ? false : previous.isHalfDay })); setCorrectionFile(null); }}>{leaveTypes.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>From<input type="date" value={correction.startDate} onChange={event => setCorrection(previous => ({ ...previous, startDate: event.target.value, isHalfDay: hasDateRange(event.target.value, previous.endDate) ? false : previous.isHalfDay }))} /></label><label>To<input type="date" value={correction.endDate} onChange={event => setCorrection(previous => ({ ...previous, endDate: event.target.value, isHalfDay: hasDateRange(previous.startDate, event.target.value) ? false : previous.isHalfDay }))} /></label><label>Duration<select value={correction.isHalfDay ? "half" : "full"} disabled={halfDayDisabled(correctionType)} onChange={event => setCorrection(previous => ({ ...previous, isHalfDay: event.target.value === "half" }))}><option value="full">Full day(s)</option><option value="half" disabled={correctionHasDateRange}>Half day</option></select></label>{correctionType?.requiresAttachment && <label className="wide">Replacement attachment<input type="file" accept={attachmentAccept} onChange={event => setCorrectionFile(event.target.files?.[0] ?? null)} /><small>Leave blank to retain the current valid attachment.</small></label>}<label className="wide">Request reason<textarea value={correction.reason} onChange={event => setCorrection(previous => ({ ...previous, reason: event.target.value }))} /></label></div>}{decision.action === "reassign" && <label>Replacement approver<select value={assigneeUserId} onChange={event => setAssigneeUserId(event.target.value)}><option value="">Select qualified approver</option>{eligible.data?.map(user => <option value={user.id} key={user.id}>{user.employee ? `${user.employee.firstName} ${user.employee.lastName} · ` : ""}{user.email}</option>)}</select></label>}{decision.action === "override" && (canSuperOverride ? <label>Target status<select value={overrideStatus} onChange={event => setOverrideStatus(event.target.value as typeof overrideStatus)}><option>APPROVED</option><option>REJECTED</option><option>CANCELLED</option></select></label> : <p className="muted">This immediately approves the leave and bypasses all remaining approval stages.</p>)}<label>Decision reason{decision.reasonRequired ? " (required)" : " (optional)"}<textarea autoFocus maxLength={2000} value={decisionReason} onChange={event => setDecisionReason(event.target.value)} /></label>{requiresStepUp && <><p className="sync-alert"><ShieldCheck size={16} /> This protected action requires recent authentication.</p>{session.authProvider === "local" ? <label>Current password<input type="password" autoComplete="current-password" value={decisionPassword} onChange={event => setDecisionPassword(event.target.value)} /></label> : <button type="button" onClick={startMicrosoftStepUp}>Re-authenticate with Microsoft</button>}</>}<div className="modal-actions"><button onClick={() => setDecision(null)}>Cancel</button><button className="primary" disabled={decide.isPending || (decision.reasonRequired && decisionReason.trim().length < 3) || (decision.action === "reassign" && !assigneeUserId) || (requiresStepUp && session.authProvider === "local" && !decisionPassword)} onClick={() => decide.mutate(decision)}>Confirm</button></div>{decide.isError && <p role="alert" className="sync-alert">{decide.error.message}</p>}</Dialog>}
    {timelineId && <Dialog wide title="Leave timeline" onClose={() => setTimelineId(null)}>{timeline.isPending ? <p className="muted">Loading timeline…</p> : timeline.isError ? <p className="sync-alert">{timeline.error.message}</p> : <div className="workflow-history">{timeline.data?.steps.map(step => <div key={step.id}><strong>{step.sequence}. {displayTitle(step.stage)} · {displayTitle(step.status)}</strong><span>{step.assignees.map(item => item.user?.email).filter(Boolean).join(", ") || "No approver"}{step.reason ? ` · ${step.reason}` : ""}</span></div>)}{timeline.data?.decisions?.map(item => <div key={item.id}><strong>{displayTitle(item.decisionType)} · {displayTitle(item.toStatus)}</strong><span>{item.actor.email} · {new Date(item.createdAt).toLocaleString()}{item.reason ? ` · ${item.reason}` : ""}</span></div>)}</div>}<div className="modal-actions"><button onClick={() => setTimelineId(null)}>Close</button></div></Dialog>}
  </section>;
}
