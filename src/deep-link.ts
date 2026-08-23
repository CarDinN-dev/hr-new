import { useEffect, useRef, useState } from "react";

function hashRecordId(prefix: string) {
  const hash = decodeURIComponent(window.location.hash.slice(1));
  const marker = `${prefix}-`;
  return hash.startsWith(marker) ? hash.slice(marker.length) : "";
}

export function useHashRecordId(prefix: string) {
  const [recordId, setRecordId] = useState(() => hashRecordId(prefix));
  useEffect(() => {
    const update = () => setRecordId(hashRecordId(prefix));
    window.addEventListener("hashchange", update);
    update();
    return () => window.removeEventListener("hashchange", update);
  }, [prefix]);
  return recordId;
}

export function useDeepLinkFocus(prefix: string, recordId: string, ready: boolean, found: boolean, notify: (message: string) => void) {
  const notifyRef = useRef(notify);
  const handledRef = useRef("");
  notifyRef.current = notify;

  useEffect(() => {
    if (!recordId || !ready) return;
    const key = `${prefix}-${recordId}`;
    if (handledRef.current === key) return;
    handledRef.current = key;
    if (!found) {
      notifyRef.current("This record is no longer available.");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(key);
      if (!target) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center", behavior: "auto" });
      target.classList.add("deep-link-target");
      window.setTimeout(() => target.classList.remove("deep-link-target"), 1600);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [found, prefix, ready, recordId]);
}
