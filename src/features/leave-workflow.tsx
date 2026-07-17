import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { apiList, apiRequest, hasAnyPermission, hasPermission, startMicrosoftStepUp, type BackendSession } from "../api";
import { displayDate, displayTitle, idempotencyHeaders, workflowKey } from "./workflow-utils";

export type LeaveRecord = {
  id: string;
  version: number;
  requesterUserId: string;
  employeeId: string;
  status: string;
  currentStage?: string | null;
  routeType: string;
  startDate: string;
  endDate: string;
  totalDays: string;
  isHalfDay: boolean;
  reason?: string | null;
  employee: { employeeCode: string; firstName: string; lastName: string };
  leaveType: { id: string; name: string };
  steps: Array<{
    id: string;
    stage: string;
    status: string;
    sequence: number;
    workflowVersion: number;
    selfApprovalAllowed: boolean;
    decidedAt?: string | null;
    reason?: string | null;
    assignees: Array<{ userId: string; isActive: boolean; revokedAt?: string | null; user?: { email: string } }>;
  }>;
  decisions?: Array<{ id: string; decisionType: string; stage?: string | null; fromStatus: string; toStatus: string; reason?: string | null; createdAt: string; actor: { email: string } }>;
};
type LeaveTypeRecord = { id: string; name: string; annualAllowanceDays: string };
type EmployeeOption = { id: string; employeeCode: string; firstName: string; lastName: string };
type EligibleAssignee = { id: string; email: string; employee?: { firstName: string; lastName: string } | null };
type DecisionAction = "approve" | "self-approve" | "reject" | "return" | "cancel" | "reassign" | "override" | "correct-resubmit";
type Decision = { request: LeaveRecord; action: DecisionAction; reasonRequired: boolean };

export function LeaveWorkflowPage({ session, notify }: { session: BackendSession; notify: (message: string) => void }) {
  const client = useQueryClient();
  const broad = hasAnyPermission(session, "leave.team.read", "leave.management.read", "leave.hr.read", "leave.read_all");
  const canInbox = hasAnyPermission(session, "leave.team.approve_line_manager", "leave.management.approve_manager", "leave.hr.approve", "leave.executive.approve_cpo", "leave.executive.approve_coo", "leave.executive.self_approve_coo");
  const records = useQuery({ queryKey: workflowKey(session, "leave-records", broad), queryFn: () => apiList<LeaveRecord>(broad ? "/leave/requests" : "/leave/mine") });
  const inbox = useQuery({ queryKey: workflowKey(session, "leave-inbox"), queryFn: () => apiList<LeaveRecord>("/leave/inbox"), enabled: canInbox });
  const leaveTypes = useQuery({ queryKey: workflowKey(session, "leave-types"), queryFn: () => apiList<LeaveTypeRecord>("/leave/types") });
  const canHrSubmit = hasPermission(session, "leave.hr.manage");
  const employees = useQuery({ queryKey: workflowKey(session, "leave-submit-employees"), queryFn: () => apiList<EmployeeOption>("/employees"), enabled: canHrSubmit });
  const [form, setForm] = useState({ employeeId: session.employeeId || "", leaveTypeId: "", startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), isHalfDay: false, reason: "" });
  const [decision, setDecision] = useState<Decision | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionPassword, setDecisionPassword] = useState("");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [overrideStatus, setOverrideStatus] = useState<"APPROVED" | "REJECTED" | "CANCELLED">("APPROVED");
  const [correction, setCorrection] = useState({ leaveTypeId: "", startDate: "", endDate: "", isHalfDay: false, reason: "" });
  const [timelineId, setTimelineId] = useState<string | null>(null);
  const timeline = useQuery({ queryKey: workflowKey(session, "leave-timeline", timelineId), queryFn: () => apiRequest<LeaveRecord>(`/leave/${timelineId}/timeline`), enabled: Boolean(timelineId) });
  const eligible = useQuery({ queryKey: workflowKey(session, "leave-assignees", decision?.request.id), queryFn: () => apiRequest<EligibleAssignee[]>(`/leave/${decision!.request.id}/eligible-assignees`), enabled: decision?.action === "reassign" });
  const invalidate = () => Promise.all([
    client.invalidateQueries({ queryKey: workflowKey(session, "leave-records", broad) }),
    client.invalidateQueries({ queryKey: workflowKey(session, "leave-inbox") }),
    client.invalidateQueries({ queryKey: workflowKey(session, "approval-inbox") }),
  ]);
  const submit = useMutation({
    mutationFn: () => apiRequest<LeaveRecord>("/leave/submit", { method: "POST", csrfToken: session.csrfToken, headers: idempotencyHeaders(), body: JSON.stringify({ ...form, employeeId: canHrSubmit ? form.employeeId : undefined, leaveTypeId: form.leaveTypeId || leaveTypes.data?.[0]?.id }) }),
    onSuccess: async () => { await invalidate(); setForm(previous => ({ ...previous, reason: "" })); notify("Leave request submitted."); },
  });
  const decide = useMutation({
    mutationFn: async (target: Decision) => {
      if (["self-approve", "override"].includes(target.action) && session.authProvider === "local") {
        if (!decisionPassword) throw new Error("Enter your password for this protected decision.");
        await apiRequest("/auth/step-up/local", { method: "POST", csrfToken: session.csrfToken, body: JSON.stringify({ password: decisionPassword }) });
      }
      if (target.action === "correct-resubmit") {
        const updated = await apiRequest<LeaveRecord>(`/leave/${target.request.id}/correction`, { method: "POST", csrfToken: session.csrfToken, headers: idempotencyHeaders(), body: JSON.stringify({ ...correction, expectedVersion: target.request.version }) });
        return apiRequest<LeaveRecord>(`/leave/${target.request.id}/resubmit`, { method: "POST", csrfToken: session.csrfToken, headers: idempotencyHeaders(), body: JSON.stringify({ expectedVersion: updated.version, reason: decisionReason.trim() || undefined }) });
      }
      const body: Record<string, unknown> = { expectedVersion: target.request.version, ...(decisionReason.trim() ? { reason: decisionReason.trim() } : {}) };
      if (target.action === "reassign") body.assigneeUserId = assigneeUserId;
      if (target.action === "override") body.targetStatus = overrideStatus;
      return apiRequest<LeaveRecord>(`/leave/${target.request.id}/${target.action}`, { method: "POST", csrfToken: session.csrfToken, headers: idempotencyHeaders(), body: JSON.stringify(body) });
    },
    onSuccess: async () => { await invalidate(); setDecision(null); setDecisionReason(""); setDecisionPassword(""); setAssigneeUserId(""); notify("Leave request updated."); },
  });

  const inboxIds = new Set((inbox.data ?? []).map(item => item.id));
  const all = useMemo(() => {
    const map = new Map<string, LeaveRecord>();
    for (const item of [...(records.data ?? []), ...(inbox.data ?? [])]) map.set(item.id, item);
    return [...map.values()];
  }, [records.data, inbox.data]);
  function openDecision(request: LeaveRecord, action: DecisionAction, reasonRequired = false) {
    setDecision({ request, action, reasonRequired }); setDecisionReason(""); setDecisionPassword(""); setAssigneeUserId("");
    setCorrection({ leaveTypeId: request.leaveType.id, startDate: request.startDate.slice(0, 10), endDate: request.endDate.slice(0, 10), isHalfDay: request.isHalfDay, reason: request.reason || "" });
  }

  return <section className="stack">
    {(canHrSubmit || (Boolean(session.employeeId) && hasPermission(session, "leave.self.create"))) && <div className="panel"><div className="panel-head"><div><h3>Request leave</h3><span>Approval routing is assigned by the server.</span></div></div><div className="form-grid compact">{canHrSubmit && <label>Employee<select value={form.employeeId} onChange={event => setForm(previous => ({ ...previous, employeeId: event.target.value }))}><option value="">Select employee</option>{employees.data?.map(item => <option value={item.id} key={item.id}>{item.employeeCode} · {item.firstName} {item.lastName}</option>)}</select></label>}<label>Leave type<select value={form.leaveTypeId} onChange={event => setForm(previous => ({ ...previous, leaveTypeId: event.target.value }))}>{leaveTypes.data?.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>From<input type="date" value={form.startDate} onChange={event => setForm(previous => ({ ...previous, startDate: event.target.value }))} /></label><label>To<input type="date" value={form.endDate} onChange={event => setForm(previous => ({ ...previous, endDate: event.target.value }))} /></label><label>Duration<select value={form.isHalfDay ? "half" : "full"} onChange={event => setForm(previous => ({ ...previous, isHalfDay: event.target.value === "half" }))}><option value="full">Full day(s)</option><option value="half">Half day</option></select></label><label className="wide">Reason<textarea maxLength={2000} value={form.reason} onChange={event => setForm(previous => ({ ...previous, reason: event.target.value }))} /></label></div><div className="form-actions"><button className="primary" disabled={submit.isPending || !leaveTypes.data?.length || (canHrSubmit && !form.employeeId)} onClick={() => submit.mutate()}>{submit.isPending ? "Submitting…" : "Submit request"}</button></div>{submit.isError && <p className="sync-alert" role="alert">{submit.error.message}</p>}</div>}
    <div className="panel"><div className="panel-head"><div><h3>Leave requests</h3><span>{inbox.data?.length ?? 0} assigned to you</span></div></div>{records.isPending || inbox.isPending ? <p className="muted">Loading leave requests…</p> : records.isError ? <p className="sync-alert">{records.error.message}</p> : <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Leave</th><th>Dates</th><th>Status</th><th>Actions</th></tr></thead><tbody>{all.map(request => {
      const own = request.employeeId === session.employeeId;
      const assigned = inboxIds.has(request.id);
      const selfApproval = own && request.routeType === "COO_SELF" && request.currentStage === "COO" && hasPermission(session, "leave.executive.self_approve_coo");
      return <tr key={request.id}><td>{request.employee.employeeCode} — {request.employee.firstName} {request.employee.lastName}</td><td>{request.leaveType.name}<br /><small>{request.totalDays} day(s)</small></td><td>{displayDate(request.startDate)} – {displayDate(request.endDate)}</td><td><span className="badge neutral">{displayTitle(request.status)}</span><br /><small>{request.currentStage ? `${displayTitle(request.currentStage)} stage` : ""}</small></td><td><div className="row-actions"><button onClick={() => setTimelineId(request.id)}>Timeline</button>{assigned && !selfApproval && <><button onClick={() => openDecision(request, "approve")}>Approve</button><button onClick={() => openDecision(request, "return", true)}>Return</button><button className="danger-outline" onClick={() => openDecision(request, "reject", true)}>Reject</button></>}{selfApproval && <button className="primary" onClick={() => openDecision(request, "self-approve")}>Self-approve</button>}{own && request.status === "RETURNED_FOR_CORRECTION" && <button className="primary" onClick={() => openDecision(request, "correct-resubmit")}>Correct and resubmit</button>}{own && (request.status.startsWith("PENDING_") || request.status === "RETURNED_FOR_CORRECTION" || request.status === "BLOCKED_APPROVER_MISSING") && hasPermission(session, "leave.self.cancel") && <button onClick={() => openDecision(request, "cancel", true)}>Cancel</button>}{request.currentStage && hasPermission(session, "leave.reassign") && <button onClick={() => openDecision(request, "reassign", true)}>Reassign</button>}{hasPermission(session, "leave.override") && !["APPROVED", "REJECTED", "CANCELLED"].includes(request.status) && <button onClick={() => openDecision(request, "override", true)}>Override</button>}</div></td></tr>;
    })}</tbody></table>{!all.length && <div className="empty">No leave requests.</div>}</div>}</div>
    {decision && <div className="modal-backdrop"><div className="modal modal-wide" role="dialog" aria-modal="true"><h2>{displayTitle(decision.action)} leave</h2><p>Employee: {decision.request.employee.firstName} {decision.request.employee.lastName}</p>{decision.action === "correct-resubmit" && <div className="form-grid compact"><label>Leave type<select value={correction.leaveTypeId} onChange={event => setCorrection(previous => ({ ...previous, leaveTypeId: event.target.value }))}>{leaveTypes.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>From<input type="date" value={correction.startDate} onChange={event => setCorrection(previous => ({ ...previous, startDate: event.target.value }))} /></label><label>To<input type="date" value={correction.endDate} onChange={event => setCorrection(previous => ({ ...previous, endDate: event.target.value }))} /></label><label>Duration<select value={correction.isHalfDay ? "half" : "full"} onChange={event => setCorrection(previous => ({ ...previous, isHalfDay: event.target.value === "half" }))}><option value="full">Full day(s)</option><option value="half">Half day</option></select></label><label className="wide">Request reason<textarea value={correction.reason} onChange={event => setCorrection(previous => ({ ...previous, reason: event.target.value }))} /></label></div>}{decision.action === "reassign" && <label>Replacement approver<select value={assigneeUserId} onChange={event => setAssigneeUserId(event.target.value)}><option value="">Select qualified approver</option>{eligible.data?.map(user => <option value={user.id} key={user.id}>{user.employee ? `${user.employee.firstName} ${user.employee.lastName} · ` : ""}{user.email}</option>)}</select></label>}{decision.action === "override" && <label>Target status<select value={overrideStatus} onChange={event => setOverrideStatus(event.target.value as typeof overrideStatus)}><option>APPROVED</option><option>REJECTED</option><option>CANCELLED</option></select></label>}<label>Decision reason{decision.reasonRequired ? " (required)" : " (optional)"}<textarea autoFocus maxLength={2000} value={decisionReason} onChange={event => setDecisionReason(event.target.value)} /></label>{["self-approve", "override"].includes(decision.action) && <><p className="sync-alert"><ShieldCheck size={16} /> This protected action requires recent authentication.</p>{session.authProvider === "local" ? <label>Current password<input type="password" autoComplete="current-password" value={decisionPassword} onChange={event => setDecisionPassword(event.target.value)} /></label> : <button type="button" onClick={startMicrosoftStepUp}>Re-authenticate with Microsoft</button>}</>}<div className="modal-actions"><button onClick={() => setDecision(null)}>Cancel</button><button className="primary" disabled={decide.isPending || (decision.reasonRequired && decisionReason.trim().length < 3) || (decision.action === "reassign" && !assigneeUserId) || (["self-approve", "override"].includes(decision.action) && session.authProvider === "local" && !decisionPassword)} onClick={() => decide.mutate(decision)}>Confirm</button></div>{decide.isError && <p role="alert" className="sync-alert">{decide.error.message}</p>}</div></div>}
    {timelineId && <div className="modal-backdrop"><div className="modal modal-wide" role="dialog" aria-modal="true"><h2>Leave timeline</h2>{timeline.isPending ? <p className="muted">Loading timeline…</p> : timeline.isError ? <p className="sync-alert">{timeline.error.message}</p> : <div className="workflow-history">{timeline.data?.steps.map(step => <div key={step.id}><strong>{step.sequence}. {displayTitle(step.stage)} · {displayTitle(step.status)}</strong><span>{step.assignees.map(item => item.user?.email).filter(Boolean).join(", ") || "No approver"}{step.reason ? ` · ${step.reason}` : ""}</span></div>)}{timeline.data?.decisions?.map(item => <div key={item.id}><strong>{displayTitle(item.decisionType)} · {displayTitle(item.toStatus)}</strong><span>{item.actor.email} · {new Date(item.createdAt).toLocaleString()}{item.reason ? ` · ${item.reason}` : ""}</span></div>)}</div>}<div className="modal-actions"><button onClick={() => setTimelineId(null)}>Close</button></div></div></div>}
  </section>;
}
