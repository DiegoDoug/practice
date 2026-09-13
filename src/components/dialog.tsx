'use client';

import { useCallback, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
};

/**
 * Accessible modal: focus trap, Escape to close, focus restored to the opener,
 * bottom sheet on mobile and centred dialog from 700px up.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Escape is handled at the document level so it still works when the
    // element that had focus has since unmounted (for example the destructive
    // confirmation button disappearing after a restore).
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    // If focus lands outside the dialog for any reason, pull it back in so the
    // trap cannot leak to the page behind the overlay.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (target && panelRef.current && !panelRef.current.contains(target)) {
        panelRef.current.focus();
      }
    };

    document.addEventListener('keydown', onDocumentKeyDown);
    document.addEventListener('focusin', onFocusIn);

    return () => {
      document.removeEventListener('keydown', onDocumentKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      document.body.style.overflow = previousOverflow;
      opener.current?.focus?.();
    };
  }, [open]);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const nodes = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    ).filter((node) => node.offsetParent !== null);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  if (!open) return null;

  return (
    <div
      className="bg-ocean-deep/45 fixed inset-0 z-30 flex items-end justify-center p-0 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="bg-card max-h-[88dvh] w-full max-w-[560px] overflow-auto rounded-t-[20px] p-5 shadow-[0_20px_60px_rgba(47,72,88,0.25)] sm:rounded-[20px]"
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-ocean-deep text-[17px] font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft -mt-1 -mr-1 grid h-11 w-11 shrink-0 place-items-center border transition-colors duration-150"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Close {title}</span>
          </button>
        </div>
        {description ? (
          <p
            id={descriptionId}
            className="text-muted mb-4 text-[13px] leading-relaxed"
          >
            {description}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}
