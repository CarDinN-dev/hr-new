import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type DialogProps = {
  children: ReactNode;
  onClose: () => void;
  title?: string;
  description?: string;
  wide?: boolean;
};

const DialogCloseGuardContext = createContext<((guard: (() => boolean) | null) => void) | null>(null);

export function useDialogCloseGuard(guard: () => boolean) {
  const setCloseGuard = useContext(DialogCloseGuardContext);
  useEffect(() => {
    if (!setCloseGuard) return;
    setCloseGuard(guard);
    return () => setCloseGuard(null);
  }, [guard, setCloseGuard]);
}

export function Dialog({ children, onClose, title, description, wide = false }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
  const closeGuardRef = useRef<(() => boolean) | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [closing, setClosing] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || title) return;
    const heading = dialog.querySelector<HTMLElement>("h1, h2, h3");
    if (!heading) return;
    heading.id ||= titleId;
    dialog.setAttribute("aria-labelledby", heading.id);
  }, [title, titleId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      if (dialog.open) dialog.close();
      document.body.style.overflow = overflow;
      const returnFocus = returnFocusRef.current;
      window.setTimeout(() => {
        const target = returnFocus?.isConnected ? returnFocus : document.querySelector<HTMLElement>(".content button.primary, .content a[href], .content button") ?? document.querySelector<HTMLElement>("main button");
        target?.focus({ preventScroll: true });
      }, 0);
    };
  }, []);

  const setCloseGuard = useCallback((guard: (() => boolean) | null) => { closeGuardRef.current = guard; }, []);

  function requestClose() {
    if (closing || (closeGuardRef.current && !closeGuardRef.current())) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return onClose();
    setClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, 130);
  }

  return createPortal(
    <DialogCloseGuardContext.Provider value={setCloseGuard}>
      <dialog
        ref={dialogRef}
        className={`modal-dialog${wide ? " modal-dialog-wide" : ""}${closing ? " is-closing" : ""}`}
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        onCancel={event => { event.preventDefault(); requestClose(); }}
        onMouseDown={event => { if (event.target === event.currentTarget) requestClose(); }}
      >
        <div className={`modal${wide ? " modal-wide" : ""}`}>
          <button className="modal-close" type="button" onClick={requestClose} aria-label="Close dialog"><X size={18} /></button>
          {title && <h2 id={titleId}>{title}</h2>}
          {description && <p id={descriptionId}>{description}</p>}
          {children}
        </div>
      </dialog>
    </DialogCloseGuardContext.Provider>,
    document.body
  );
}
