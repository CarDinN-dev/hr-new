import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, ShieldCheck } from "lucide-react";
import { apiList, apiRequest, hasActiveSuperAdminRole, hasAnyPermission, hasPermission, startMicrosoftStepUp, type BackendSession } from "../api";
import { Dialog } from "../dialog";
import { EmployeePicker } from "../employee-picker";
import { displayDate, displayTitle, idempotencyHeaders, workflowKey } from "./workflow-utils";
import { usePageSearch, usePageSearchStatus } from "../page-search";

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

const attachmentAccept = ".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx";
const finalStatuses = ["APPROVED", "REJECTED", "CANCELLED"];

function codeOf(type?: Pick<LeaveTypeRecord, "code" | "name">) {
  const code = type?.code?.trim().toUpperCase();
  if (code) return code;
  return type?.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_") ?? "";
}

function halfDayDisabled(type?: Pick<LeaveTypeRecord, "code" | "name">) {
  return ["UMRAH_HAJJ", "COMPASSIONATE", "MATERNITY"].includes(codeOf(type));
}

function days(value: string | number | null | undefined) {
  if (value == null || value === "") return "—";
  const amount = Number(value);
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
}

function requestBody(form: { employeeId?: string; leaveTypeId: string; startDate: string; endDate: string; isHalfDay: boolean; reason: string }, file?: File | null, expectedVersion?: number) {
  const body = new FormData();
  if (form.employeeId) body.set("employeeId", form.employeeId);
  body.set("leaveTypeId", form.leaveTypeId);
  body.set("startDate", form.startDate);
  body.set("endDate", form.endDate);
  body.set("isHalfDay", String(form.isHalfDay));
  if (form.reason.trim()) body.set("reason", form.reason.trim());
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
    {requests.isPending ? <p className="muted">Loading leave application...</p> : requests.isError ? <p className="sync-alert">{requests.error.message}</p> : !current ? <div className="empty compact">No leave applications yet.</div> : <div className="list-row"><div><strong>{current.leaveType.name}</strong><span>{displayDate(current.startDate)} – {displayDate(current.endDate)} · {current.totalDays} day(s)</span></div><span className="badge neutral">{displayTitle(current.status)}</span></div>}
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
  const records = useQuery({ queryKey: [...workflowKey(session, "leave-records", broad), search], queryFn: () => apiList<LeaveRecord>(searched(broad ? "/leave/requests" : "/leave/mine", search)) });
  const inbox = useQuery({ queryKey: [...workflowKey(session, "leave-inbox"), search], queryFn: () => apiList<LeaveRecord>(searched("/leave/inbox", search)), enabled: canInbox });
  usePageSearchStatus("leave-records", { count: records.data?.length, loading: records.isFetching, error: records.error?.message });
  usePageSearchStatus("leave-inbox", { count: inbox.data?.length, loading: inbox.isFetching, error: inbox.error?.message });
  const leaveTypes = useQuery({ queryKey: workflowKey(session, "leave-types"), queryFn: () => apiList<LeaveTypeRecord>("/leave/types") });
  const employees = useQuery({ queryKey: workflowKey(session, "leave-employees"), queryFn: () => apiList<LeaveEmployee>("/employees?limit=1000"), enabled: canSubmitForEmployee });
  const [form, setForm] = useState({ employeeId: "", leaveTypeId: "", startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), isHalfDay: false, reason: "" });
  const [attachment, setAttachment] = useState<File | null>(null);
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
    onSuccess: async () => { await invalidate(); setForm(previous => ({ ...previous, reason: "" })); setAttachment(null); notify("Leave request submitted."); },
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
  function openDecision(request: LeaveRecord, action: DecisionAction, reasonRequired = false) {
    setDecision({ request, action, reasonRequired }); setDecisionReason(""); setDecisionPassword(""); setAssigneeUserId(""); setCorrectionFile(null);
    setCorrection({ leaveTypeId: request.leaveType.id, startDate: request.startDate.slice(0, 10), endDate: request.endDate.slice(0, 10), isHalfDay: request.isHalfDay, reason: request.reason || "" });
  }

  return <section className="stack">
    {(Boolean(session.employeeId) || canSubmitForEmployee) && hasPermission(session, "leave.self.create") && <div className="leave-workspace-grid">
      <div className="panel leave-balance-panel"><div className="panel-head"><div><h3>Leave balance</h3><span>{targetEmployeeId ? `${balanceYear} balances for the selected employee` : "Select an employee to view balances"}</span></div></div>
        {balances.isPending && targetEmployeeId ? <p className="muted">Loading leave balances…</p> : balances.isError ? <p className="sync-alert">{balances.error.message}</p> : <div className="leave-balance-grid">{balances.data?.map(balance => <article className={`leave-balance-card${balance.noBalanceRequired ? " is-unlimited" : balance.eligible ? "" : " is-unavailable"}`} key={balance.leaveType.id}><header><div><span className="leave-balance-card__eyebrow">{balance.eligible ? "Current-year balance" : "Eligibility"}</span><strong>{balance.leaveType.name}</strong></div>{balance.eligible && !balance.noBalanceRequired && <span className="leave-balance-card__year">{balanceYear}</span>}</header>{balance.noBalanceRequired ? <div className="leave-balance-card__state"><strong>No balance required</strong><span>This leave type is not deducted from an annual allowance.</span></div> : balance.eligible ? <><div className="leave-balance-card__available"><span>Available to request</span><strong>{days(balance.availableDays)}<small> days</small></strong></div><dl><div><dt>Total allowance</dt><dd>{days(balance.totalDays)} days</dd></div><div><dt>Used</dt><dd>{days(balance.usedDays)} days</dd></div><div><dt>Pending</dt><dd>{days(balance.pendingDays)} days</dd></div></dl></> : <div className="leave-balance-card__state"><strong>Unavailable</strong><span>This leave type is not currently eligible.</span></div>}</article>)}{targetEmployeeId && !balances.data?.length && <div className="empty compact">No active leave types.</div>}</div>}
      </div>
      <div className="panel leave-request-panel"><div className="panel-head"><div><h3>Request leave</h3><span>Dates, paid days, and balance eligibility are calculated by the server.</span></div></div>
        <div className="form-grid compact">
          {canSubmitForEmployee && <label>Employee<EmployeePicker value={form.employeeId} onChange={employeeId => setForm(previous => ({ ...previous, employeeId }))} options={employees.data?.map(employee => ({ id: employee.id, label: `${employee.employeeCode} — ${employee.firstName} ${employee.lastName}` })) ?? []} clearable /></label>}
          <label>Leave type<select value={selectedLeaveTypeId} onChange={event => { const type = leaveTypes.data?.find(item => item.id === event.target.value); setForm(previous => ({ ...previous, leaveTypeId: event.target.value, isHalfDay: halfDayDisabled(type) ? false : previous.isHalfDay })); setAttachment(null); }}>{leaveTypes.data?.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label>From<input type="date" value={form.startDate} onChange={event => setForm(previous => ({ ...previous, startDate: event.target.value }))} /></label>
          <label>To<input type="date" value={form.endDate} onChange={event => setForm(previous => ({ ...previous, endDate: event.target.value }))} /></label>
          <label>Duration<select value={form.isHalfDay ? "half" : "full"} disabled={halfDayDisabled(selectedType)} onChange={event => setForm(previous => ({ ...previous, isHalfDay: event.target.value === "half" }))}><option value="full">Full day(s)</option><option value="half">Half day</option></select></label>
          {(preview.data?.requiresAttachment || selectedType?.requiresAttachment) && <label className="wide">Attachment (required)<input key={attachment ? `${attachment.name}-${attachment.lastModified}` : "new-attachment"} type="file" accept={attachmentAccept} onChange={event => setAttachment(event.target.files?.[0] ?? null)} /><small>One PDF, image, Word, or Excel file up to 10 MB.</small></label>}
          <label className="wide">Reason<textarea maxLength={2000} value={form.reason} onChange={event => setForm(previous => ({ ...previous, reason: event.target.value }))} /></label>
        </div>
        {preview.data && <div className="settlement-preview"><div><span>Total</span><strong>{days(preview.data.totalDays)}</strong></div><div><span>Paid</span><strong>{days(preview.data.paidDays)}</strong></div><div><span>Unpaid</span><strong>{days(preview.data.unpaidDays)}</strong></div><div><span>Available</span><strong>{preview.data.noBalanceRequired ? "No balance required" : days(preview.data.availableDays)}</strong></div></div>}
        {preview.data && !preview.data.eligible && <p className="sync-alert" role="alert">{preview.data.message || "This leave request is not eligible."}</p>}
        <div className="form-actions"><button className="primary" disabled={submit.isPending || preview.isPending || !selectedLeaveTypeId || !targetEmployeeId || preview.data?.eligible === false || Boolean(preview.data?.requiresAttachment && !attachment)} onClick={() => submit.mutate()}>{submit.isPending ? "Submitting…" : "Submit request"}</button></div>
        {submit.isError && <p className="sync-alert" role="alert">{submit.error.message}</p>}
      </div>
    </div>}
    <div className="panel leave-requests-panel"><div className="panel-head"><div><h3>Leave requests</h3><span>{inbox.data?.length ?? 0} assigned to you</span></div></div>{records.isPending || (canInbox && inbox.isPending) ? <p className="muted">Loading leave requests…</p> : records.isError ? <p className="sync-alert">{records.error.message}</p> : <div className="table-wrap table-wide table-actions" role="region" aria-label="Leave requests"><table><thead><tr><th>Employee</th><th>Leave</th><th>Dates</th><th>Paid / unpaid</th><th>Attachment</th><th>Status</th><th>Actions</th></tr></thead><tbody>{all.map(request => {
      const own = request.employeeId === session.employeeId;
      const ownRequest = own && request.requesterUserId === session.id;
      const assigned = inboxIds.has(request.id);
      const selfApproval = own && request.routeType === "COO_SELF" && request.currentStage === "COO" && hasPermission(session, "leave.executive.self_approve_coo");
      const canReplace = !finalStatuses.includes(request.status) && (own || canSubmitForEmployee);
      return <tr key={request.id}><td data-label="Employee">{request.employee.employeeCode} — {request.employee.firstName} {request.employee.lastName}</td><td data-label="Leave">{request.leaveType.name}<br /><small>{request.totalDays} day(s)</small></td><td data-label="Dates">{displayDate(request.startDate)} – {displayDate(request.endDate)}</td><td data-label="Paid / unpaid">{days(request.paidDays)} / {days(request.unpaidDays)}</td><td data-label="Attachment">{request.attachments?.map(file => <div key={file.id}><a href={file.fileUrl} target="_blank" rel="noreferrer"><Paperclip size={13} /> {file.fileName}</a><br /><small>{displayTitle(file.scanStatus)}</small></div>)}{!request.attachments?.length && "—"}{canReplace && <label className="button-like">{request.attachments?.length ? "Replace" : "Add file"}<input type="file" accept={attachmentAccept} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) replaceAttachment.mutate({ request, file }); }} /></label>}</td><td data-label="Status"><span className="badge neutral">{displayTitle(request.status)}</span><br /><small>{request.currentStage ? `${displayTitle(request.currentStage)} stage` : ""}</small></td><td data-label="Actions"><div className="row-actions"><button onClick={() => setTimelineId(request.id)}>Timeline</button>{assigned && !selfApproval && <><button onClick={() => openDecision(request, "approve")}>Approve</button><button onClick={() => openDecision(request, "return", true)}>Return</button><button className="danger-outline" onClick={() => openDecision(request, "reject", true)}>Reject</button></>}{selfApproval && <button className="primary" onClick={() => openDecision(request, "self-approve")}>Self-approve</button>}{ownRequest && request.status === "RETURNED_FOR_CORRECTION" && <button className="primary" onClick={() => openDecision(request, "correct-resubmit")}>Correct and resubmit</button>}{ownRequest && (request.status.startsWith("PENDING_") || request.status === "RETURNED_FOR_CORRECTION" || request.status === "BLOCKED_APPROVER_MISSING") && hasPermission(session, "leave.self.cancel") && <button onClick={() => openDecision(request, "cancel", true)}>Cancel</button>}{request.currentStage && hasPermission(session, "leave.reassign") && <button onClick={() => openDecision(request, "reassign", true)}>Reassign</button>}{canHrOverride && !canSuperOverride && !own && !finalStatuses.includes(request.status) && <button className="primary" onClick={() => { setOverrideStatus("APPROVED"); openDecision(request, "override", true); }}>Override & approve</button>}{canSuperOverride && !finalStatuses.includes(request.status) && <button onClick={() => openDecision(request, "override", true)}>Override</button>}</div></td></tr>;
    })}</tbody></table>{!all.length && <div className="empty">No leave requests.</div>}{replaceAttachment.isError && <p className="sync-alert">{replaceAttachment.error.message}</p>}</div>}</div>
    {decision && <Dialog wide title={decision.action === "override" && canHrOverride && !canSuperOverride ? "Override & approve" : `${displayTitle(decision.action)} leave`} onClose={() => setDecision(null)}><p>Employee: {decision.request.employee.firstName} {decision.request.employee.lastName}</p>{decision.action === "correct-resubmit" && <div className="form-grid compact"><label>Leave type<select value={correction.leaveTypeId} onChange={event => { const type = leaveTypes.data?.find(item => item.id === event.target.value); setCorrection(previous => ({ ...previous, leaveTypeId: event.target.value, isHalfDay: halfDayDisabled(type) ? false : previous.isHalfDay })); setCorrectionFile(null); }}>{leaveTypes.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>From<input type="date" value={correction.startDate} onChange={event => setCorrection(previous => ({ ...previous, startDate: event.target.value }))} /></label><label>To<input type="date" value={correction.endDate} onChange={event => setCorrection(previous => ({ ...previous, endDate: event.target.value }))} /></label><label>Duration<select value={correction.isHalfDay ? "half" : "full"} disabled={halfDayDisabled(correctionType)} onChange={event => setCorrection(previous => ({ ...previous, isHalfDay: event.target.value === "half" }))}><option value="full">Full day(s)</option><option value="half">Half day</option></select></label>{correctionType?.requiresAttachment && <label className="wide">Replacement attachment<input type="file" accept={attachmentAccept} onChange={event => setCorrectionFile(event.target.files?.[0] ?? null)} /><small>Leave blank to retain the current valid attachment.</small></label>}<label className="wide">Request reason<textarea value={correction.reason} onChange={event => setCorrection(previous => ({ ...previous, reason: event.target.value }))} /></label></div>}{decision.action === "reassign" && <label>Replacement approver<select value={assigneeUserId} onChange={event => setAssigneeUserId(event.target.value)}><option value="">Select qualified approver</option>{eligible.data?.map(user => <option value={user.id} key={user.id}>{user.employee ? `${user.employee.firstName} ${user.employee.lastName} · ` : ""}{user.email}</option>)}</select></label>}{decision.action === "override" && (canSuperOverride ? <label>Target status<select value={overrideStatus} onChange={event => setOverrideStatus(event.target.value as typeof overrideStatus)}><option>APPROVED</option><option>REJECTED</option><option>CANCELLED</option></select></label> : <p className="muted">This immediately approves the leave and bypasses all remaining approval stages.</p>)}<label>Decision reason{decision.reasonRequired ? " (required)" : " (optional)"}<textarea autoFocus maxLength={2000} value={decisionReason} onChange={event => setDecisionReason(event.target.value)} /></label>{requiresStepUp && <><p className="sync-alert"><ShieldCheck size={16} /> This protected action requires recent authentication.</p>{session.authProvider === "local" ? <label>Current password<input type="password" autoComplete="current-password" value={decisionPassword} onChange={event => setDecisionPassword(event.target.value)} /></label> : <button type="button" onClick={startMicrosoftStepUp}>Re-authenticate with Microsoft</button>}</>}<div className="modal-actions"><button onClick={() => setDecision(null)}>Cancel</button><button className="primary" disabled={decide.isPending || (decision.reasonRequired && decisionReason.trim().length < 3) || (decision.action === "reassign" && !assigneeUserId) || (requiresStepUp && session.authProvider === "local" && !decisionPassword)} onClick={() => decide.mutate(decision)}>Confirm</button></div>{decide.isError && <p role="alert" className="sync-alert">{decide.error.message}</p>}</Dialog>}
    {timelineId && <Dialog wide title="Leave timeline" onClose={() => setTimelineId(null)}>{timeline.isPending ? <p className="muted">Loading timeline…</p> : timeline.isError ? <p className="sync-alert">{timeline.error.message}</p> : <div className="workflow-history">{timeline.data?.steps.map(step => <div key={step.id}><strong>{step.sequence}. {displayTitle(step.stage)} · {displayTitle(step.status)}</strong><span>{step.assignees.map(item => item.user?.email).filter(Boolean).join(", ") || "No approver"}{step.reason ? ` · ${step.reason}` : ""}</span></div>)}{timeline.data?.decisions?.map(item => <div key={item.id}><strong>{displayTitle(item.decisionType)} · {displayTitle(item.toStatus)}</strong><span>{item.actor.email} · {new Date(item.createdAt).toLocaleString()}{item.reason ? ` · ${item.reason}` : ""}</span></div>)}</div>}<div className="modal-actions"><button onClick={() => setTimelineId(null)}>Close</button></div></Dialog>}
  </section>;
}
