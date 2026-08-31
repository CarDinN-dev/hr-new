import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bell, CheckCheck } from "lucide-react";
import { apiPage, apiRequest, hasAnyPermission, hasPermission, type BackendSession } from "../api";
import { canAccessRoute } from "../authorization";
import { navPaths } from "../routing";
import { notificationDestination } from "../ui-state";
import { displayTitle, workflowKey } from "./workflow-utils";

type Notification = { id: string; type: string; title: string; message: string; resourceType?: string | null; resourceId?: string | null; readAt?: string | null; createdAt: string };
type NotificationMeta = { unread: number; total?: number; page?: number; limit?: number; totalPages?: number };

function canViewDestination(session: BackendSession, destination: ReturnType<typeof notificationDestination>) {
  if (!destination || !canAccessRoute(session, destination.nav)) return false;
  if (destination.hashPrefix === "leave") return hasAnyPermission(session, "leave.self.read", "leave.team.read", "leave.management.read", "leave.hr.read", "leave.audit.read", "leave.read_all");
  if (destination.hashPrefix === "service-request") return hasAnyPermission(session, "service_request.self.read", "service_request.hr.read", "service_request.read_all");
  return hasAnyPermission(session, "payroll.self.read_payslip", "payroll.payslip.read_all");
}

function useNotifications(session: BackendSession, notify: (message: string) => void, limit: number, page = 1, active = true) {
  const client = useQueryClient(); const navigate = useNavigate(); const canRead = hasPermission(session, "notification.self.read");
  const query = useQuery({ queryKey: [...workflowKey(session, "notifications"), page, limit], queryFn: () => apiPage<Notification, NotificationMeta>(`/notifications?page=${page}&limit=${limit}`), enabled: canRead, refetchInterval: active ? 30_000 : 60_000 });
  const refresh = () => client.invalidateQueries({ queryKey: workflowKey(session, "notifications") });
  const markRead = useMutation({ mutationFn: (id: string) => apiRequest(`/notifications/${id}/read`, { method: "POST", csrfToken: session.csrfToken }), onSuccess: refresh });
  const markAllRead = useMutation({ mutationFn: () => apiRequest("/notifications/read-all", { method: "POST", csrfToken: session.csrfToken }), onSuccess: async () => { await refresh(); notify("Notifications marked as read."); } });
  async function view(item: Notification) { const destination = notificationDestination(item.resourceType); if (!destination || !item.resourceId || !canViewDestination(session, destination)) return false; if (!item.readAt && hasPermission(session, "notification.self.manage")) { try { await markRead.mutateAsync(item.id); } catch (error) { notify(error instanceof Error ? error.message : "Notification could not be marked as read."); } } void navigate({ to: navPaths[destination.nav], hash: `${destination.hashPrefix}-${item.resourceId}` }); return true; }
  return { canRead, query, markRead, markAllRead, view };
}

function NotificationsList({ items, session, markRead, view, compact = false }: { items: Notification[]; session: BackendSession; markRead: ReturnType<typeof useNotifications>["markRead"]; view: (item: Notification) => Promise<boolean>; compact?: boolean }) {
  return <div className={`notification-list${compact ? " compact" : ""}`}>{items.map(item => { const destination = notificationDestination(item.resourceType); const canView = Boolean(item.resourceId && canViewDestination(session, destination)); return <article className={`notification-item ${item.readAt ? "read" : "unread"}`} key={item.id}><div className="notification-copy"><strong>{item.title}</strong><span>{item.message}</span><small>{displayTitle(item.type)} · {new Date(item.createdAt).toLocaleString()}</small></div><div className="notification-actions">{!item.readAt && hasPermission(session, "notification.self.manage") && <button type="button" disabled={markRead.isPending} onClick={() => markRead.mutate(item.id)}>Mark read</button>}{canView && <button type="button" className="primary" onClick={() => void view(item)}>View</button>}</div></article>; })}{!items.length && <div className="empty compact">No notifications.</div>}</div>;
}

export function NotificationsPanel({ session, notify }: { session: BackendSession; notify: (message: string) => void }) {
  const [open, setOpen] = useState(false); const [closing, setClosing] = useState(false); const triggerRef = useRef<HTMLButtonElement>(null); const popoverRef = useRef<HTMLDivElement>(null); const closeTimerRef = useRef<number | null>(null); const data = useNotifications(session, notify, 30, 1, open);
  const dismiss = (returnFocus = false) => { if (!open || closing || closeTimerRef.current !== null) return; const finish = () => { closeTimerRef.current = null; setOpen(false); setClosing(false); if (returnFocus) triggerRef.current?.focus(); }; if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) finish(); else { setClosing(true); closeTimerRef.current = window.setTimeout(finish, 100); } };
  useEffect(() => { if (!open) return; popoverRef.current?.querySelector<HTMLButtonElement>("button")?.focus() ?? popoverRef.current?.focus(); const closeOnOutsidePointer = (event: PointerEvent) => { const target = event.target as Node; if (!popoverRef.current?.contains(target) && !triggerRef.current?.contains(target)) dismiss(); }; document.addEventListener("pointerdown", closeOnOutsidePointer); return () => { document.removeEventListener("pointerdown", closeOnOutsidePointer); if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current); }; }, [open]);
  if (!data.canRead) return null; const unread = data.query.data?.meta?.unread ?? 0; const notifications = data.query.data?.data ?? [];
  return <div className="notifications-menu"><button ref={triggerRef} className="icon-button notification-trigger" type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-controls="notifications-popover" aria-haspopup="dialog" aria-expanded={open} onClick={() => open ? dismiss() : setOpen(true)}><Bell size={18} />{unread > 0 && <span>{unread > 99 ? "99+" : unread}</span>}</button>{open && <div id="notifications-popover" ref={popoverRef} className={`notifications-popover${closing ? " is-closing" : ""}`} role="dialog" aria-labelledby="notifications-title" tabIndex={-1} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); dismiss(true); } }}><div className="panel-head"><div><h3 id="notifications-title">Notifications</h3><span>{unread} unread</span></div>{unread > 0 && hasPermission(session, "notification.self.manage") && <button disabled={data.markAllRead.isPending} onClick={() => data.markAllRead.mutate()}><CheckCheck size={14} /> Read all</button>}</div>{data.query.isPending ? <p className="muted">Loading notifications…</p> : data.query.isError ? <p className="sync-alert">{data.query.error.message}</p> : <NotificationsList compact items={notifications} session={session} markRead={data.markRead} view={async item => { const moved = await data.view(item); if (moved) dismiss(); return moved; }} />}</div>}</div>;
}

export function NotificationsPage({ session, notify }: { session: BackendSession; notify: (message: string) => void }) {
  const [page, setPage] = useState(1); const data = useNotifications(session, notify, 25, page); if (!data.canRead) return null; const unread = data.query.data?.meta?.unread ?? 0; const meta = data.query.data?.meta;
  return <div className="experience-page"><section className="feature-heading"><div><span className="eyebrow">Workspace · Notifications</span><h2>Your notifications</h2><p>Assignments, approvals, schedule changes and published HR documents.</p></div>{unread > 0 && hasPermission(session, "notification.self.manage") && <button className="primary" disabled={data.markAllRead.isPending} onClick={() => data.markAllRead.mutate()}><CheckCheck size={16} /> Mark all read</button>}</section><section className="panel"><div className="panel-head"><div><h3>Inbox</h3><span>{unread} unread</span></div></div>{data.query.isPending ? <p className="muted">Loading notifications…</p> : data.query.isError ? <p className="sync-alert">{data.query.error.message}</p> : <NotificationsList items={data.query.data?.data ?? []} session={session} markRead={data.markRead} view={data.view} />}</section>{(meta?.totalPages ?? 1) > 1 && <nav className="pagination" aria-label="Notification pages"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page} of {meta?.totalPages ?? 1}</span><button disabled={page >= (meta?.totalPages ?? 1)} onClick={() => setPage(value => value + 1)}>Next</button></nav>}</div>;
}
