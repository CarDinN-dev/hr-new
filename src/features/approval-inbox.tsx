import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, hasPermission, type BackendSession } from "../api";
import type { LeaveRecord } from "./leave-workflow";
import type { PayrollRun } from "./payroll-workflow";
import { displayDate, displayTitle, idempotencyHeaders, workflowKey } from "./workflow-utils";

type Certificate = { id: string; requestType: string; status: string; version: number; subject: { firstName: string; lastName: string } };
type ApprovalInbox = { leave: LeaveRecord[]; certificates: Certificate[]; payroll: PayrollRun[] };
type ReasonAction = { type: "leave-reject" | "leave-return" | "certificate-reject"; id: string; version: number; label: string; reason: string };

export function ApprovalInboxPanel({ session, notify }: { session: BackendSession; notify: (message: string) => void }) {
  const client = useQueryClient();
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null);
  const inbox = useQuery({ queryKey: workflowKey(session, "approval-inbox"), queryFn: () => apiRequest<ApprovalInbox>("/approvals/inbox") });
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: workflowKey(session, "approval-inbox") }),
    client.invalidateQueries({ queryKey: workflowKey(session, "leave-inbox") }),
    client.invalidateQueries({ queryKey: workflowKey(session, "service-requests") }),
    client.invalidateQueries({ queryKey: workflowKey(session, "payroll-runs") }),
  ]);
  const mutate = useMutation({
    mutationFn: ({ path, expectedVersion, reason }: { path: string; expectedVersion: number; reason?: string }) => apiRequest(path, { method: "POST", csrfToken: session.csrfToken, headers: idempotencyHeaders(), body: JSON.stringify({ expectedVersion, ...(reason ? { reason } : {}) }) }),
    onSuccess: async () => { await refresh(); setReasonAction(null); notify("Approval item updated."); },
  });
  const count = (inbox.data?.leave.length ?? 0) + (inbox.data?.certificates.length ?? 0) + (inbox.data?.payroll.length ?? 0);
  function confirmReason() {
    if (!reasonAction) return;
    const path = reasonAction.type === "leave-reject" ? `/leave/${reasonAction.id}/reject` : reasonAction.type === "leave-return" ? `/leave/${reasonAction.id}/return` : `/service-requests/${reasonAction.id}/reject`;
    mutate.mutate({ path, expectedVersion: reasonAction.version, reason: reasonAction.reason.trim() });
  }
  return <section className="panel span-2"><div className="panel-head"><div><h3>Approval inbox</h3><span>{count} item(s) assigned to you</span></div></div>{inbox.isPending ? <p className="muted">Loading approvals…</p> : inbox.isError ? <p className="sync-alert">{inbox.error.message}</p> : <div className="list-stack">
    {inbox.data?.leave.map(item => <div className="list-row" key={`l-${item.id}`}><div><strong>Leave · {item.employee.firstName} {item.employee.lastName}</strong><span>{displayTitle(item.currentStage)} stage · {displayDate(item.startDate)} – {displayDate(item.endDate)}</span></div><div className="row-actions"><button disabled={mutate.isPending} onClick={() => mutate.mutate({ path: `/leave/${item.id}/approve`, expectedVersion: item.version })}>Approve</button><button onClick={() => setReasonAction({ type: "leave-return", id: item.id, version: item.version, label: "Return leave for correction", reason: "" })}>Return</button><button className="danger-outline" onClick={() => setReasonAction({ type: "leave-reject", id: item.id, version: item.version, label: "Reject leave", reason: "" })}>Reject</button></div></div>)}
    {inbox.data?.certificates.map(item => <div className="list-row" key={`c-${item.id}`}><div><strong>Certificate · {displayTitle(item.requestType)}</strong><span>{item.subject.firstName} {item.subject.lastName}</span></div><div className="row-actions">{hasPermission(session, "service_request.hr.approve") && <button disabled={mutate.isPending} onClick={() => mutate.mutate({ path: `/service-requests/${item.id}/approve`, expectedVersion: item.version })}>Approve</button>}{hasPermission(session, "service_request.hr.reject") && <button className="danger-outline" onClick={() => setReasonAction({ type: "certificate-reject", id: item.id, version: item.version, label: "Reject certificate", reason: "" })}>Reject</button>}</div></div>)}
    {inbox.data?.payroll.map(item => <div className="list-row" key={`p-${item.id}`}><div><strong>Payroll · {item.year}-{String(item.month).padStart(2, "0")}</strong><span>Revision {item.revision}</span></div>{hasPermission(session, "payroll.approve") && <button disabled={mutate.isPending} onClick={() => mutate.mutate({ path: `/payroll/runs/${item.id}/approve`, expectedVersion: item.version })}>Approve</button>}</div>)}
    {!count && <div className="empty compact">No approvals waiting.</div>}
  </div>}
  {mutate.isError && <p className="sync-alert">{mutate.error.message}</p>}
  {reasonAction && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true"><h2>{reasonAction.label}</h2><label>Reason<textarea autoFocus value={reasonAction.reason} onChange={event => setReasonAction(previous => previous ? { ...previous, reason: event.target.value } : previous)} /></label><div className="modal-actions"><button onClick={() => setReasonAction(null)}>Cancel</button><button className="primary" disabled={reasonAction.reason.trim().length < 3 || mutate.isPending} onClick={confirmReason}>Confirm</button></div></div></div>}
  </section>;
}
