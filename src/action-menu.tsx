import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type MenuPosition = { top: number; left: number };

export function ActionMenu({ label = "More actions", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const dismiss = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const gap = 8;
    const edge = 8;
    const triggerBox = trigger.getBoundingClientRect();
    const menuBox = menu.getBoundingClientRect();
    const roomBelow = window.innerHeight - triggerBox.bottom - gap;
    const roomAbove = triggerBox.top - gap;
    const top = roomBelow >= menuBox.height || roomBelow >= roomAbove
      ? Math.min(window.innerHeight - menuBox.height - edge, triggerBox.bottom + gap)
      : Math.max(edge, triggerBox.top - menuBox.height - gap);
    setPosition({
      top: Math.max(edge, top),
      left: Math.max(edge, Math.min(window.innerWidth - menuBox.width - edge, triggerBox.right - menuBox.width)),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    menu?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) dismiss();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); dismiss(true); }
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", closeOnEscape);
    const closeOnResize = () => dismiss();
    window.addEventListener("resize", closeOnResize);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnResize);
      window.removeEventListener("scroll", place, true);
    };
  }, [dismiss, open, place]);

  function focusItem(direction: 1 | -1 | "first" | "last") {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = direction === "first" ? 0 : direction === "last" ? items.length - 1 : (index + direction + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  }

  return <div className="card-actions-menu">
    <button ref={triggerRef} className="card-actions-menu__trigger" type="button" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(value => !value)} onKeyDown={event => {
      if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); }
    }}>{label}</button>
    {open && createPortal(<div id={menuId} ref={menuRef} className="card-actions-menu__items" role="group" aria-label={`${label} menu`} style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }} onClick={() => dismiss()} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); dismiss(true); }
      else if (event.key === "ArrowDown") { event.preventDefault(); focusItem(1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); focusItem(-1); }
      else if (event.key === "Home") { event.preventDefault(); focusItem("first"); }
      else if (event.key === "End") { event.preventDefault(); focusItem("last"); }
    }}>{children}</div>, document.body)}
  </div>;
}
