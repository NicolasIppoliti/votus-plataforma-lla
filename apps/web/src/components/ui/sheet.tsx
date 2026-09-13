"use client";

import type { ComponentProps } from "react";
import * as SheetPrimitive from "radix-ui/dialog";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

function Sheet(props: ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root {...props} />;
}

function SheetTrigger(props: ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetContent({ className, children, ...props }: ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="mobile-navigation__overlay" data-slot="sheet-overlay" />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn("mobile-navigation__sheet", className)}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetTitle(props: ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" {...props} />;
}

function SheetClose({ className, children, ...props }: ComponentProps<"button">) {
  return (
    <SheetPrimitive.Close asChild>
      <Button variant="ghost" className={cn("mobile-navigation__close", className)} {...props}>
        <XIcon size={16} aria-hidden="true" />
        {children}
      </Button>
    </SheetPrimitive.Close>
  );
}

export { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetClose };
