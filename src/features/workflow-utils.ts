import type { BackendSession } from "../api";

export const workflowKey = (session: BackendSession, feature: string, ...parts: unknown[]) =>
  [feature, session.sessionId, session.authorizationVersion, ...parts] as const;

export const idempotencyHeaders = () => ({ "Idempotency-Key": crypto.randomUUID() });

export const displayTitle = (value?: string | null) =>
  (value || "").toLowerCase().replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());

export const displayDate = (value?: string | null) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value))
  : "—";

export const displayMoney = (value: string | number, currency = "QAR") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value));

export function saveDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
