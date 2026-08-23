import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { apiPage, apiRequest, hasPermission, type BackendSession } from "../api";
import { displayTitle, workflowKey } from "./workflow-utils";

type Notification = { id: string; type: string; title: string; message: string; resourceType?: string | null; resourceId?: string | null; readAt?: string | null; createdAt: string };
type NotificationMeta = { unread: number };

export function NotificationsPanel({ session, notify }: { session: BackendSession; notify: (message: string) => void }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const canRead = hasPermission(session, "notification.self.read");
  const query = useQuery({ queryKey: workflowKey(session, "notifications"), queryFn: () => apiPage<Notification, NotificationMeta>("/notifications?limit=30"), enabled: canRead, refetchInterval: open ? 30_000 : 60_000 });
  const refresh = () => client.invalidateQueries({ queryKey: workflowKey(session, "notifications") });
  const markRead = useMutation({ mutationFn: (id: string) => apiRequest(`/notifications/${id}/read`, { method: "POST", csrfToken: session.csrfToken }), onSuccess: refresh });
  const markAllRead = useMutation({ mutationFn: () => apiRequest("/notifications/read-all", { method: "POST", csrfToken: session.csrfToken }), onSuccess: async () => { await refresh(); notify("Notifications marked as read."); } });
  const dismiss = (returnFocus = false) => {
    if (!open || closing || closeTimerRef.current !== null) return;
    const finish = () => { closeTimerRef.current = null; setOpen(false); setClosing(false); if (returnFocus) triggerRef.current?.focus(); };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
    else { setClosing(true); closeTimerRef.current = window.setTimeout(finish, 100); }
  };
  useEffect(() => {
    if (!open) return;
    popoverRef.current?.querySelector<HTMLButtonElement>("button")?.focus() ?? popoverRef.current?.focus();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !triggerRef.current?.contains(target)) dismiss();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => { document.removeEventListener("pointerdown", closeOnOutsidePointer); if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current); };
  }, [open]);
  if (!canRead) return null;
  const unread = query.data?.meta?.unread ?? 0;
  const notifications = query.data?.data ?? [];
  return <div className="notifications-menu">
    <button ref={triggerRef} className="icon-button notification-trigger" type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-controls="notifications-popover" aria-haspopup="dialog" aria-expanded={open} onClick={() => open ? dismiss() : setOpen(true)}><Bell size={18} />{unread > 0 && <span>{unread > 99 ? "99+" : unread}</span>}</button>
    {open && <div id="notifications-popover" ref={popoverRef} className={`notifications-popover${closing ? " is-closing" : ""}`} role="dialog" aria-labelledby="notifications-title" tabIndex={-1} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); dismiss(true); } }}><div className="panel-head"><div><h3 id="notifications-title">Notifications</h3><span>{unread} unread</span></div>{unread > 0 && hasPermission(session, "notification.self.manage") && <button disabled={markAllRead.isPending} onClick={() => markAllRead.mutate()}><CheckCheck size={14} /> Read all</button>}</div>{query.isPending ? <p className="muted">Loading notifications…</p> : query.isError ? <p className="sync-alert">{query.error.message}</p> : <div className="notification-list">{notifications.map(item => <button className={item.readAt ? "read" : "unread"} key={item.id} onClick={() => { if (!item.readAt && hasPermission(session, "notification.self.manage")) markRead.mutate(item.id); }}><strong>{item.title}</strong><span>{item.message}</span><small>{displayTitle(item.type)} · {new Date(item.createdAt).toLocaleString()}</small></button>)}{!notifications.length && <div className="empty compact">No notifications.</div>}</div>}</div>}
  </div>;
}
