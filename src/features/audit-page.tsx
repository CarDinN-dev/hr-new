import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ShieldCheck } from "lucide-react";
import { apiDownload, apiList, apiRequest, hasPermission, type BackendSession } from "../api";

type AuditEvent = {
  id: string;
  sequence: string;
  occurredAtUtc: string;
  actorEmailSnapshot?: string | null;
  action: string;
  outcome: string;
  resourceType: string;
  resourceId?: string | null;
  reason?: string | null;
};

type AuditPolicy = {
  id: string;
  enabled: boolean;
  retentionDays: number;
  version: number;
};

type LegalHold = {
  id: string;
  name: string;
  reason: string;
  resourceType?: string | null;
  resourceId?: string | null;
  endsAt?: string | null;
  releasedAt?: string | null;
  createdAt: string;
  createdBy?: { email: string };
};

const queryKey = (session: BackendSession, name: string, ...parts: unknown[]) =>
  [name, session.sessionId, session.authorizationVersion, ...parts] as const;

export function AuditHistoryPage({ session, notify }: { session: BackendSession; notify: (message: string) => void }) {
  const client = useQueryClient();
  const [filters, setFilters] = useState({ search: "", outcome: "", action: "", resourceType: "", dateFrom: "", dateTo: "" });
  const [exportFormat, setExportFormat] = useState<"CSV" | "PDF" | null>(null);
  const [exportReason, setExportReason] = useState("");
  const [policyDraft, setPolicyDraft] = useState<{ enabled: boolean; retentionDays: number; reason: string } | null>(null);
  const [holdDraft, setHoldDraft] = useState({ name: "", reason: "", resourceType: "", resourceId: "", endsAt: "" });
  const [release, setRelease] = useState<{ hold: LegalHold; reason: string } | null>(null);
  const params = auditParams(filters);

  const events = useQuery({
    queryKey: queryKey(session, "audit-events", params.toString()),
    queryFn: () => apiList<AuditEvent>(`/audit/events?${params}`),
  });
  const chain = useQuery({
    queryKey: queryKey(session, "audit-chain"),
    queryFn: () => apiRequest<{ valid: boolean; eventCount: number; brokenAtSequence?: string }>("/audit/events/verify-chain"),
  });
  const policy = useQuery({
    queryKey: queryKey(session, "audit-policy"),
    queryFn: () => apiRequest<AuditPolicy>("/audit/events/policy"),
    enabled: hasPermission(session, "audit.configure"),
  });
  const holds = useQuery({
    queryKey: queryKey(session, "audit-holds"),
    queryFn: () => apiList<LegalHold>("/audit/events/legal-holds"),
    enabled: hasPermission(session, "audit.configure"),
  });

  const savePolicy = useMutation({
    mutationFn: () => apiRequest<AuditPolicy>("/audit/events/policy", {
      method: "POST",
      csrfToken: session.csrfToken,
      body: JSON.stringify({ ...policyDraft, expectedVersion: policy.data?.version }),
    }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKey(session, "audit-policy") });
      setPolicyDraft(null);
      notify("Audit retention policy updated.");
    },
  });
  const createHold = useMutation({
    mutationFn: () => apiRequest<LegalHold>("/audit/events/legal-holds", {
      method: "POST",
      csrfToken: session.csrfToken,
      body: JSON.stringify({
        name: holdDraft.name.trim(),
        reason: holdDraft.reason.trim(),
        ...(holdDraft.resourceType.trim() ? { resourceType: holdDraft.resourceType.trim() } : {}),
        ...(holdDraft.resourceId.trim() ? { resourceId: holdDraft.resourceId.trim() } : {}),
        ...(holdDraft.endsAt ? { endsAt: new Date(holdDraft.endsAt).toISOString() } : {}),
      }),
    }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKey(session, "audit-holds") });
      setHoldDraft({ name: "", reason: "", resourceType: "", resourceId: "", endsAt: "" });
      notify("Legal hold created.");
    },
  });
  const releaseHold = useMutation({
    mutationFn: () => apiRequest(`/audit/events/legal-holds/${release!.hold.id}/release`, {
      method: "POST",
      csrfToken: session.csrfToken,
      body: JSON.stringify({ reason: release!.reason.trim() }),
    }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKey(session, "audit-holds") });
      setRelease(null);
      notify("Legal hold released.");
    },
  });

  async function exportAudit(format: "CSV" | "PDF") {
    const record = await apiRequest<{ id: string }>("/audit/events/exports", {
      method: "POST",
      csrfToken: session.csrfToken,
      body: JSON.stringify({ format, exportReason: exportReason.trim(), ...Object.fromEntries(params) }),
    });
    const file = await apiDownload(`/audit/events/exports/${record.id}/download`);
    saveDownload(file.blob, file.fileName);
    setExportFormat(null);
    setExportReason("");
    notify("Audit export downloaded.");
  }

  return <section className="stack">
    <div className="panel">
      <div className="panel-head">
        <div><h3>Audit integrity</h3><span>Hash-chained, append-only event history.</span></div>
        <span className={`badge ${chain.data?.valid ? "good" : "bad"}`}>
          <ShieldCheck size={14} /> {chain.isPending ? "Checking" : chain.data?.valid ? `${chain.data.eventCount} verified` : `Broken at ${chain.data?.brokenAtSequence || "unknown"}`}
        </span>
      </div>
    </div>

    <div className="panel">
      <div className="panel-head">
        <div><h3>Audit history</h3><span>Security and business events recorded by the server.</span></div>
        {hasPermission(session, "audit.export") && <div className="inline-controls">
          <button onClick={() => setExportFormat("CSV")}><Download size={14} /> CSV</button>
          <button onClick={() => setExportFormat("PDF")}>PDF</button>
        </div>}
      </div>
      <div className="form-grid compact audit-filters">
        <label>Search<input type="search" value={filters.search} onChange={event => setFilters(previous => ({ ...previous, search: event.target.value }))} /></label>
        <label>Outcome<select value={filters.outcome} onChange={event => setFilters(previous => ({ ...previous, outcome: event.target.value }))}><option value="">All</option><option>SUCCESS</option><option>DENIED</option><option>FAILED</option></select></label>
        <label>Action<input value={filters.action} onChange={event => setFilters(previous => ({ ...previous, action: event.target.value.toUpperCase() }))} /></label>
        <label>Resource type<input value={filters.resourceType} onChange={event => setFilters(previous => ({ ...previous, resourceType: event.target.value }))} /></label>
        <label>From<input type="date" value={filters.dateFrom} onChange={event => setFilters(previous => ({ ...previous, dateFrom: event.target.value }))} /></label>
        <label>To<input type="date" value={filters.dateTo} onChange={event => setFilters(previous => ({ ...previous, dateTo: event.target.value }))} /></label>
      </div>
      {events.isPending ? <p className="muted">Loading audit history…</p> : events.isError ? <p className="sync-alert">{events.error.message}</p> : <div className="table-wrap"><table><thead><tr><th>Sequence</th><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th><th>Outcome</th><th>Reason</th></tr></thead><tbody>{events.data?.map(item => <tr key={item.id}><td>{item.sequence}</td><td>{new Date(item.occurredAtUtc).toLocaleString()}</td><td>{item.actorEmailSnapshot || "System"}</td><td>{item.action}</td><td>{item.resourceType}{item.resourceId ? <small><br />{item.resourceId}</small> : null}</td><td>{item.outcome}</td><td>{item.reason || "—"}</td></tr>)}</tbody></table></div>}
    </div>

    {hasPermission(session, "audit.configure") && <>
      <div className="panel">
        <div className="panel-head"><div><h3>Retention policy</h3><span>Deletion remains disabled unless explicitly enabled and run by maintenance.</span></div>{policy.data && <button onClick={() => setPolicyDraft({ enabled: policy.data.enabled, retentionDays: policy.data.retentionDays, reason: "" })}>Edit policy</button>}</div>
        {policy.isPending ? <p className="muted">Loading policy…</p> : policy.data && <div className="metric-row"><div><span>Status</span><strong>{policy.data.enabled ? "Enabled" : "Disabled"}</strong></div><div><span>Retention</span><strong>{policy.data.retentionDays} days</strong></div><div><span>Version</span><strong>{policy.data.version}</strong></div></div>}
      </div>
      <div className="panel">
        <div className="panel-head"><div><h3>Legal holds</h3><span>Held records are excluded from retention pruning.</span></div></div>
        <div className="form-grid compact">
          <label>Name<input value={holdDraft.name} onChange={event => setHoldDraft(previous => ({ ...previous, name: event.target.value }))} /></label>
          <label>Resource type (optional)<input value={holdDraft.resourceType} onChange={event => setHoldDraft(previous => ({ ...previous, resourceType: event.target.value }))} /></label>
          <label>Resource ID (optional)<input value={holdDraft.resourceId} onChange={event => setHoldDraft(previous => ({ ...previous, resourceId: event.target.value }))} /></label>
          <label>End date (optional)<input type="date" value={holdDraft.endsAt} onChange={event => setHoldDraft(previous => ({ ...previous, endsAt: event.target.value }))} /></label>
          <label className="wide">Reason<textarea value={holdDraft.reason} onChange={event => setHoldDraft(previous => ({ ...previous, reason: event.target.value }))} /></label>
        </div>
        <div className="modal-actions"><button className="primary" disabled={holdDraft.name.trim().length < 2 || holdDraft.reason.trim().length < 3 || createHold.isPending} onClick={() => createHold.mutate()}>Create hold</button></div>
        {createHold.isError && <p className="sync-alert">{createHold.error.message}</p>}
        <div className="list-stack">{holds.data?.map(hold => <div className="list-row" key={hold.id}><div><strong>{hold.name}</strong><span>{hold.releasedAt ? "Released" : "Active"} · {hold.resourceType || "All matching audit records"} · created {new Date(hold.createdAt).toLocaleDateString()}</span></div>{!hold.releasedAt && <button onClick={() => setRelease({ hold, reason: "" })}>Release</button>}</div>)}</div>
      </div>
    </>}

    {exportFormat && <ReasonModal title={`Export audit history as ${exportFormat}`} reason={exportReason} setReason={setExportReason} busy={false} onCancel={() => setExportFormat(null)} onConfirm={() => void exportAudit(exportFormat).catch(error => notify(error.message))} />}
    {policyDraft && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true"><h2>Retention policy</h2><label className="switch-row"><input type="checkbox" checked={policyDraft.enabled} onChange={event => setPolicyDraft(previous => previous ? { ...previous, enabled: event.target.checked } : previous)} /> Enable retention pruning</label><label>Retention days<input type="number" min={30} value={policyDraft.retentionDays} onChange={event => setPolicyDraft(previous => previous ? { ...previous, retentionDays: Number(event.target.value) } : previous)} /></label><label>Reason<textarea value={policyDraft.reason} onChange={event => setPolicyDraft(previous => previous ? { ...previous, reason: event.target.value } : previous)} /></label><div className="modal-actions"><button onClick={() => setPolicyDraft(null)}>Cancel</button><button className="primary" disabled={policyDraft.retentionDays < 30 || policyDraft.reason.trim().length < 3 || savePolicy.isPending} onClick={() => savePolicy.mutate()}>Save policy</button></div>{savePolicy.isError && <p className="sync-alert">{savePolicy.error.message}</p>}</div></div>}
    {release && <ReasonModal title={`Release ${release.hold.name}`} reason={release.reason} setReason={reason => setRelease(previous => previous ? { ...previous, reason } : previous)} busy={releaseHold.isPending} onCancel={() => setRelease(null)} onConfirm={() => releaseHold.mutate()} />}
  </section>;
}

function auditParams(filters: { search: string; outcome: string; action: string; resourceType: string; dateFrom: string; dateTo: string }) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) if (value) params.set(name, value);
  if (filters.dateFrom) params.set("dateFrom", new Date(`${filters.dateFrom}T00:00:00Z`).toISOString());
  if (filters.dateTo) params.set("dateTo", new Date(`${filters.dateTo}T23:59:59.999Z`).toISOString());
  return params;
}

function saveDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ReasonModal({ title, reason, setReason, busy, onCancel, onConfirm }: { title: string; reason: string; setReason: (value: string) => void; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true"><h2>{title}</h2><label>Reason<textarea autoFocus maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label><div className="modal-actions"><button onClick={onCancel}>Cancel</button><button className="primary" disabled={reason.trim().length < 3 || busy} onClick={onConfirm}>Confirm</button></div></div></div>;
}
