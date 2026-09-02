"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

const drawerId = "mobile-navigation-drawer";
const focusableSelector = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

interface MobileNavigationProps {
  sidebar: ReactNode;
}

export function MobileNavigation({ sidebar }: MobileNavigationProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) dialog.showModal();
      closeButtonRef.current?.focus();
      return;
    }

    if (dialog.open) dialog.close();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  function closeDrawer() {
    setIsOpen(false);
  }

  function handleDialogClose() {
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function handleNavigationClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("a[href]")) {
      closeDrawer();
    }
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    const dialog = dialogRef.current;
    if (!dialog?.open || event.key !== "Tab") return;

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(focusableSelector),
    ).filter((element) => !element.matches(":disabled") && element.tabIndex >= 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        className="mobile-navigation__trigger"
        type="button"
        aria-controls={drawerId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => setIsOpen(true)}
      >
        <span aria-hidden="true">☰</span>
        <span>Abrir navegación</span>
      </button>
      <dialog
        ref={dialogRef}
        className="mobile-navigation__dialog"
        id={drawerId}
        aria-labelledby="mobile-navigation-title"
        onCancel={(event) => {
          event.preventDefault();
          closeDrawer();
        }}
        onClose={handleDialogClose}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="mobile-navigation__panel">
          <div className="mobile-navigation__header">
            <p id="mobile-navigation-title">Navegación principal</p>
            <button
              ref={closeButtonRef}
              className="mobile-navigation__close"
              type="button"
              onClick={closeDrawer}
            >
              Cerrar navegación
            </button>
          </div>
          <div onClick={handleNavigationClick}>{sidebar}</div>
        </div>
      </dialog>
    </>
  );
}
