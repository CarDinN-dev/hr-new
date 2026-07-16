import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck2, ShieldCheck } from "lucide-react";
import { apiDownload, apiList, apiRequest, hasAnyPermission, hasPermission, startMicrosoftStepUp, type BackendSession } from "../api";
import { displayDate, displayTitle, idempotencyHeaders, saveDownload, workflowKey } from "./workflow-utils";

type ServiceRequest = {
  id: string;
  requestType: string;
  status: string;
  version: number;
  requesterUserId: string;
  subjectEmployeeId: string;
  createdAt: string;
  subject: { employeeCode: string; firstName: string; lastName: string };
  documents: Array<{ id: string; versionNumber: number; publishedAt?: string | null; revokedAt?: string | null; generatedBy?: { id: string; email: string } }>;
  events?: Array<{ id: string; type: string; fromStatus?: string | null; toStatus?: string | null; reason?: string | null; createdAt: string; actor?: { email: string } }>;
};

type ActionDialog = {
  request: ServiceRequest;
  action: "review" | "generate" | "submit-approval" | "approve" | "reject" | "publish" | "cancel" | "revoke" | "override";
  reasonRequired: boolean;
  targetStatus?: "APPROVED" | "PUBLISHED" | "REJECTED" | "REVOKED";
};

export function ServiceRequestsPanel({ session, notify }: { session: BackendSession; notify: (message: string) => void }) {
  const client = useQueryClient();
  const [requestType, setRequestType] = useState("SALARY_CERTIFICATE");
  const [action, setAction] = useState<ActionDialog | null>(null);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const canRead = hasAnyPermission(session, "service_request.self.read", "service_request.hr.read", "service_request.read_all");
  const requests = useQuery({
    queryKey: workflowKey(session, "service-requests"),
    queryFn: () => apiList<ServiceRequest>("/service-requests?limit=100"),
    enabled: canRead,
  });
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: workflowKey(session, "service-requests") }),
    client.invalidateQueries({ queryKey: workflowKey(session, "approval-inbox") }),
  ]);
  const create = useMutation({
    mutationFn: () => apiRequest<ServiceRequest>("/service-requests", {
      method: "POST", csrfToken: session.csrfToken, headers: idempotencyHeaders(), body: JSON.stringify({ requestType }),
    }),
    onSuccess: async () => { await refresh(); notify("Certificate request submitted."); },
  });
  const transition = useMutation({
    mutationFn: async (dialog: ActionDialog) => {
      if (dialog.action === "override" && session.authProvider === "local") {
        if (!password) throw new Error("Enter your password for this protected override.");
        await apiRequest("/auth/step-up/local", { method: "POST", csrfToken: session.csrfToken, body: JSON.stringify({ password }) });
      }
      return apiRequest<ServiceRequest>(`/service-requests/${dialog.request.id}/${dialog.action}`, {
        method: "POST",
        csrfToken: session.csrfToken,
        headers: idempotencyHeaders(),
        body: JSON.stringify({ expectedVersion: dialog.request.version, ...(reason.trim() ? { reason: reason.trim() } : {}), ...(dialog.targetStatus ? { targetStatus: dialog.targetStatus } : {}) }),
      });
    },
    onSuccess: async () => { await refresh(); setAction(null); setReason(""); setPassword(""); notify("Certificate workflow updated."); },
  });

  async function download(id: string) {
    const file = await apiDownload(`/service-requests/${id}/download`);
    saveDownload(file.blob, file.fileName);
  }
  function open(request: ServiceRequest, nextAction: ActionDialog["action"], reasonRequired = false) {
    setAction({ request, action: nextAction, reasonRequired, targetStatus: nextAction === "override" ? "APPROVED" : undefined });
    setReason(""); setPassword("");
  }

  if (!canRead) return null;
  return <section className="panel span-2">
    <div className="panel-head"><div><h3>Certificates</h3><span>Salary, experience and clearance requests.</span></div>{Boolean(session.employeeId) && hasPermission(session, "service_request.self.create") && <div className="inline-controls"><select value={requestType} onChange={event => setRequestType(event.target.value)}><option value="SALARY_CERTIFICATE">Salary certificate</option><option value="EXPERIENCE_CERTIFICATE">Experience certificate</option><option value="CLEARANCE_CERTIFICATE">Clearance certificate</option></select><button className="primary" disabled={create.isPending} onClick={() => create.mutate()}>Request</button></div>}</div>
    {requests.isPending ? <p className="muted">Loading certificate requests…</p> : requests.isError ? <p className="sync-alert">{requests.error.message}</p> : <div className="list-stack">{requests.data?.map(request => <div className="workflow-card" key={request.id}><div className="list-row"><div><strong>{displayTitle(request.requestType)} · {request.subject.firstName} {request.subject.lastName}</strong><span>{displayTitle(request.status)} · {displayDate(request.createdAt)} · version {request.version}</span></div><div className="row-actions"><button onClick={() => setExpandedId(previous => previous === request.id ? null : request.id)}>{expandedId === request.id ? "Hide history" : "History"}</button>{request.status === "PUBLISHED" && hasAnyPermission(session, "service_request.self.download", "service_request.pdf.download_all") && <button onClick={() => void download(request.id).catch(error => notify(error.message))}><FileCheck2 size={15} /> Download</button>}{request.status === "SUBMITTED" && hasPermission(session, "service_request.hr.generate") && <button onClick={() => open(request, "review")}>Start review</button>}{request.status === "IN_HR_REVIEW" && hasPermission(session, "service_request.hr.generate") && <button onClick={() => open(request, "generate")}>Generate</button>}{request.status === "GENERATED" && hasPermission(session, "service_request.hr.generate") && <><button onClick={() => open(request, "generate")}>Regenerate</button><button onClick={() => open(request, "submit-approval")}>Send for approval</button></>}{request.status === "PENDING_HR_APPROVAL" && hasPermission(session, "service_request.hr.approve") && <button onClick={() => open(request, "approve")}>Approve</button>}{!["REJECTED", "CANCELLED", "REVOKED", "PUBLISHED"].includes(request.status) && hasPermission(session, "service_request.hr.reject") && <button className="danger-outline" onClick={() => open(request, "reject", true)}>Reject</button>}{request.status === "APPROVED" && hasPermission(session, "service_request.hr.publish") && <button onClick={() => open(request, "publish")}>Publish</button>}{request.status === "PUBLISHED" && hasPermission(session, "service_request.hr.revoke") && <button className="danger-outline" onClick={() => open(request, "revoke", true)}>Revoke</button>}{!["PUBLISHED", "REJECTED", "CANCELLED", "REVOKED"].includes(request.status) && request.requesterUserId === session.id && hasPermission(session, "service_request.self.cancel") && <button onClick={() => open(request, "cancel", true)}>Cancel</button>}{hasPermission(session, "service_request.override") && <button onClick={() => open(request, "override", true)}>Override</button>}</div></div>{expandedId === request.id && <div className="workflow-history">{request.events?.map(event => <div key={event.id}><strong>{displayTitle(event.type)}</strong><span>{event.actor?.email || "System"} · {new Date(event.createdAt).toLocaleString()}{event.reason ? ` · ${event.reason}` : ""}</span></div>)}{!request.events?.length && <span className="muted">No events recorded.</span>}</div>}</div>)}{!requests.data?.length && <div className="empty compact">No certificate requests.</div>}</div>}
    {create.isError && <p className="sync-alert">{create.error.message}</p>}
    {action && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true"><h2>{displayTitle(action.action)} certificate</h2><p>{action.request.subject.firstName} {action.request.subject.lastName} · {displayTitle(action.request.requestType)}</p>{action.action === "override" && <label>Target status<select value={action.targetStatus} onChange={event => setAction(previous => previous ? { ...previous, targetStatus: event.target.value as ActionDialog["targetStatus"] } : previous)}><option>APPROVED</option><option>PUBLISHED</option><option>REJECTED</option><option>REVOKED</option></select></label>}<label>Reason{action.reasonRequired ? " (required)" : " (optional)"}<textarea autoFocus maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></label>{action.action === "override" && <><p className="sync-alert"><ShieldCheck size={16} /> Super Administrator overrides require recent authentication.</p>{session.authProvider === "local" ? <label>Current password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label> : <button onClick={startMicrosoftStepUp}>Re-authenticate with Microsoft</button>}</>}<div className="modal-actions"><button onClick={() => setAction(null)}>Cancel</button><button className="primary" disabled={transition.isPending || (action.reasonRequired && reason.trim().length < 3) || (action.action === "override" && session.authProvider === "local" && !password)} onClick={() => transition.mutate(action)}>Confirm</button></div>{transition.isError && <p className="sync-alert">{transition.error.message}</p>}</div></div>}
  </section>;
}
