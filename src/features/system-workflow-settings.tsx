import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiList, apiRequest, hasAnyPermission, hasPermission, type BackendSession } from "../api";

type SystemUser = { id: string; email: string; isActive: boolean };
type WorkflowPolicy = {
  id: string;
  workflowType: "LEAVE";
  stage: "LINE_MANAGER" | "MANAGER" | "HR" | "CPO" | "COO";
  mode: "PRIMARY_APPROVER" | "ANY_ONE" | "NAMED_POOL";
  version: number;
  primaryUser?: SystemUser | null;
  members: Array<{ user: SystemUser }>;
};
type WorkflowDelegation = {
  id: string;
  workflowType: "LEAVE";
  stage: WorkflowPolicy["stage"];
  startsAt: string;
  endsAt: string;
  revokedAt?: string | null;
  version: number;
  delegator: SystemUser;
  delegate: SystemUser;
};
type PolicyDraft = { policy: WorkflowPolicy; mode: WorkflowPolicy["mode"]; primaryUserId: string; memberUserIds: Set<string>; reason: string };

const key = (session: BackendSession, value: string) => [value, session.sessionId, session.authorizationVersion] as const;

export function SystemWorkflowSettings({ session, notify }: { session: BackendSession; notify: (message: string) => void }) {
  const client = useQueryClient();
  const canRead = hasAnyPermission(session, "workflow.policy.read", "workflow.delegation.read");
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft | null>(null);
  const [delegation, setDelegation] = useState({ delegatorUserId: "", delegateUserId: "", stage: "HR" as WorkflowPolicy["stage"], startsAt: "", endsAt: "", reason: "" });
  const [revoke, setRevoke] = useState<{ delegation: WorkflowDelegation; reason: string } | null>(null);

  const users = useQuery({
    queryKey: key(session, "system-workflow-users"),
    queryFn: () => apiList<SystemUser>("/system/users?limit=100&isActive=true"),
    enabled: canRead,
  });
  const policies = useQuery({
    queryKey: key(session, "workflow-policies"),
    queryFn: () => apiList<WorkflowPolicy>("/system/workflow-policy"),
    enabled: hasPermission(session, "workflow.policy.read"),
  });
  const delegations = useQuery({
    queryKey: key(session, "workflow-delegations"),
    queryFn: () => apiList<WorkflowDelegation>("/system/delegations"),
    enabled: hasPermission(session, "workflow.delegation.read"),
  });
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: key(session, "workflow-policies") }),
    client.invalidateQueries({ queryKey: key(session, "workflow-delegations") }),
  ]);
  const savePolicy = useMutation({
    mutationFn: () => apiRequest(`/system/workflow-policy/${policyDraft!.policy.workflowType}/${policyDraft!.policy.stage}`, {
      method: "PUT",
      csrfToken: session.csrfToken,
      body: JSON.stringify({
        mode: policyDraft!.mode,
        primaryUserId: policyDraft!.mode === "PRIMARY_APPROVER" ? policyDraft!.primaryUserId : undefined,
        memberUserIds: policyDraft!.mode === "NAMED_POOL" ? [...policyDraft!.memberUserIds] : [],
        expectedVersion: policyDraft!.policy.version,
        reason: policyDraft!.reason.trim(),
      }),
    }),
    onSuccess: async () => { await refresh(); setPolicyDraft(null); notify("Workflow approval policy updated."); },
  });
  const createDelegation = useMutation({
    mutationFn: () => apiRequest("/system/delegations", {
      method: "POST",
      csrfToken: session.csrfToken,
      body: JSON.stringify({
        workflowType: "LEAVE",
        stage: delegation.stage,
        delegatorUserId: delegation.delegatorUserId,
        delegateUserId: delegation.delegateUserId,
        startsAt: new Date(delegation.startsAt).toISOString(),
        endsAt: new Date(delegation.endsAt).toISOString(),
        reason: delegation.reason.trim(),
      }),
    }),
    onSuccess: async () => { await refresh(); setDelegation({ delegatorUserId: "", delegateUserId: "", stage: "HR", startsAt: "", endsAt: "", reason: "" }); notify("Workflow delegation created."); },
  });
  const revokeDelegation = useMutation({
    mutationFn: () => apiRequest(`/system/delegations/${revoke!.delegation.id}/revoke`, {
      method: "POST",
      csrfToken: session.csrfToken,
      body: JSON.stringify({ expectedVersion: revoke!.delegation.version, reason: revoke!.reason.trim() }),
    }),
    onSuccess: async () => { await refresh(); setRevoke(null); notify("Workflow delegation revoked."); },
  });

  if (!canRead) return null;
  return <>
    {hasPermission(session, "workflow.policy.read") && <div className="panel">
      <div className="panel-head"><div><h3>Workflow policy</h3><span>Configure named HR, CPO and COO approval pools.</span></div></div>
      {policies.isPending ? <p className="muted">Loading workflow policy…</p> : <div className="list-stack">{policies.data?.map(policy => <div className="list-row" key={policy.id}><div><strong>{policy.workflowType} · {policy.stage}</strong><span>{policy.mode} · {policy.primaryUser?.email || policy.members.map(member => member.user.email).join(", ") || "No approver assigned"}</span></div>{hasPermission(session, "workflow.policy.manage") && <button onClick={() => setPolicyDraft({ policy, mode: policy.mode, primaryUserId: policy.primaryUser?.id || "", memberUserIds: new Set(policy.members.map(member => member.user.id)), reason: "" })}>Edit</button>}</div>)}</div>}
    </div>}

    {hasPermission(session, "workflow.delegation.read") && <div className="panel">
      <div className="panel-head"><div><h3>Approval delegations</h3><span>Temporary, stage-specific reassignment with overlap protection.</span></div></div>
      {hasPermission(session, "workflow.delegation.manage") && <><div className="form-grid compact">
        <label>Delegator<select value={delegation.delegatorUserId} onChange={event => setDelegation(previous => ({ ...previous, delegatorUserId: event.target.value }))}><option value="">Select user</option>{users.data?.map(user => <option key={user.id} value={user.id}>{user.email}</option>)}</select></label>
        <label>Delegate<select value={delegation.delegateUserId} onChange={event => setDelegation(previous => ({ ...previous, delegateUserId: event.target.value }))}><option value="">Select user</option>{users.data?.map(user => <option key={user.id} value={user.id}>{user.email}</option>)}</select></label>
        <label>Stage<select value={delegation.stage} onChange={event => setDelegation(previous => ({ ...previous, stage: event.target.value as WorkflowPolicy["stage"] }))}>{["LINE_MANAGER", "MANAGER", "HR", "CPO", "COO"].map(stage => <option key={stage}>{stage}</option>)}</select></label>
        <label>Starts<input type="datetime-local" value={delegation.startsAt} onChange={event => setDelegation(previous => ({ ...previous, startsAt: event.target.value }))} /></label>
        <label>Ends<input type="datetime-local" value={delegation.endsAt} onChange={event => setDelegation(previous => ({ ...previous, endsAt: event.target.value }))} /></label>
        <label className="wide">Reason<textarea value={delegation.reason} onChange={event => setDelegation(previous => ({ ...previous, reason: event.target.value }))} /></label>
      </div><div className="modal-actions"><button className="primary" disabled={!delegation.delegatorUserId || !delegation.delegateUserId || delegation.delegatorUserId === delegation.delegateUserId || !delegation.startsAt || !delegation.endsAt || new Date(delegation.endsAt) <= new Date(delegation.startsAt) || delegation.reason.trim().length < 3 || createDelegation.isPending} onClick={() => createDelegation.mutate()}>Create delegation</button></div>{createDelegation.isError && <p className="sync-alert">{createDelegation.error.message}</p>}</>}
      <div className="list-stack">{delegations.data?.map(item => <div className="list-row" key={item.id}><div><strong>{item.delegator.email} → {item.delegate.email}</strong><span>{item.stage} · {new Date(item.startsAt).toLocaleString()} to {new Date(item.endsAt).toLocaleString()} · {item.revokedAt ? "Revoked" : "Active"}</span></div>{hasPermission(session, "workflow.delegation.manage") && !item.revokedAt && <button onClick={() => setRevoke({ delegation: item, reason: "" })}>Revoke</button>}</div>)}</div>
    </div>}

    {policyDraft && <div className="modal-backdrop"><div className="modal modal-wide" role="dialog" aria-modal="true"><h2>{policyDraft.policy.stage} approval policy</h2><label>Assignment mode<select value={policyDraft.mode} onChange={event => setPolicyDraft(previous => previous ? { ...previous, mode: event.target.value as WorkflowPolicy["mode"], primaryUserId: "", memberUserIds: new Set() } : previous)}><option value="PRIMARY_APPROVER">Primary approver</option><option value="ANY_ONE">Any qualified role holder</option><option value="NAMED_POOL">Named pool</option></select></label>{policyDraft.mode === "PRIMARY_APPROVER" ? <label>Primary approver<select value={policyDraft.primaryUserId} onChange={event => setPolicyDraft(previous => previous ? { ...previous, primaryUserId: event.target.value } : previous)}><option value="">Select user</option>{users.data?.map(user => <option key={user.id} value={user.id}>{user.email}</option>)}</select></label> : policyDraft.mode === "NAMED_POOL" ? <fieldset><legend>Approver members</legend><div className="checkbox-grid">{users.data?.map(user => <label key={user.id}><input type="checkbox" checked={policyDraft.memberUserIds.has(user.id)} onChange={event => setPolicyDraft(previous => { if (!previous) return previous; const memberUserIds = new Set(previous.memberUserIds); if (event.target.checked) memberUserIds.add(user.id); else memberUserIds.delete(user.id); return { ...previous, memberUserIds }; })} /> {user.email}</label>)}</div></fieldset> : <p className="muted">The server assigns any active user holding the required organizational role and stage permission.</p>}<label>Reason<textarea value={policyDraft.reason} onChange={event => setPolicyDraft(previous => previous ? { ...previous, reason: event.target.value } : previous)} /></label><div className="modal-actions"><button onClick={() => setPolicyDraft(null)}>Cancel</button><button className="primary" disabled={(policyDraft.mode === "PRIMARY_APPROVER" && !policyDraft.primaryUserId) || (policyDraft.mode === "NAMED_POOL" && !policyDraft.memberUserIds.size) || policyDraft.reason.trim().length < 3 || savePolicy.isPending} onClick={() => savePolicy.mutate()}>Save policy</button></div>{savePolicy.isError && <p className="sync-alert">{savePolicy.error.message}</p>}</div></div>}
    {revoke && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true"><h2>Revoke delegation</h2><label>Reason<textarea autoFocus value={revoke.reason} onChange={event => setRevoke(previous => previous ? { ...previous, reason: event.target.value } : previous)} /></label><div className="modal-actions"><button onClick={() => setRevoke(null)}>Cancel</button><button className="primary" disabled={revoke.reason.trim().length < 3 || revokeDelegation.isPending} onClick={() => revokeDelegation.mutate()}>Revoke</button></div>{revokeDelegation.isError && <p className="sync-alert">{revokeDelegation.error.message}</p>}</div></div>}
  </>;
}
