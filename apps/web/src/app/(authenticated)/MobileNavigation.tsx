"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { MenuIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetClose } from "@/components/ui/sheet";

const drawerId = "mobile-navigation-drawer";

interface MobileNavigationProps {
  sidebar: ReactNode;
}

export function MobileNavigation({ sidebar }: MobileNavigationProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 64rem)");
    function closeOnDesktop() {
      if (desktop.matches) setIsOpen(false);
    }
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  function handleNavigationClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("a[href]")) {
      setIsOpen(false);
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild aria-controls={drawerId}>
        <Button ref={triggerRef} className="mobile-navigation__trigger" type="button">
          <MenuIcon size={16} aria-hidden="true" />
          <span>Abrir navegación</span>
        </Button>
      </SheetTrigger>
      <SheetContent
        id={drawerId}
        aria-labelledby="mobile-navigation-title"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          closeButtonRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (triggerRef.current?.checkVisibility()) return;
          // The mobile opener is hidden after a breakpoint change. Return to
          // the existing desktop account path instead of stranding focus.
          event.preventDefault();
          document.querySelector<HTMLElement>(".app-shell > .situation-sidebar .workspace-account summary")?.focus();
        }}
        onEscapeKeyDown={(event) => {
          // Radix listens in document capture; let the existing disclosure's
          // bubble handler consume its own Escape before dismissing the Sheet.
          if (event.target instanceof Element && event.target.closest(".workspace-account[open]")) {
            event.preventDefault();
          }
        }}
        onFocusCapture={(event) => {
          // Radix wrap-around intentionally prevents scrolling. Keep the actual
          // focused control visible in this short, internally scrolling drawer.
          event.target.scrollIntoView({ block: "nearest" });
        }}
      >
        <div className="mobile-navigation__header">
          <SheetTitle asChild id="mobile-navigation-title">
            <p>Navegación principal</p>
          </SheetTitle>
          <SheetClose ref={closeButtonRef} type="button">Cerrar navegación</SheetClose>
        </div>
        <div onClick={handleNavigationClick}>{sidebar}</div>
      </SheetContent>
    </Sheet>
  );
}
