import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// TableRegion owns overflow; these primitives render semantic table elements only.
export function Table({ className, ...props }: ComponentProps<"table">) {
  return <table data-slot="table" className={cn(className)} {...props} />;
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn(className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={cn(className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr data-slot="table-row" className={cn(className)} {...props} />;
}

export function TableHead({ className, scope, ...props }: ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      scope={scope}
      className={cn(
        // Preserve body-cell appearance against legacy unlayered th defaults.
        scope === "row" && "bg-transparent! [font-size:inherit]! font-normal",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td data-slot="table-cell" className={cn(className)} {...props} />;
}

export function TableCaption({ className, ...props }: ComponentProps<"caption">) {
  return <caption data-slot="table-caption" className={cn(className)} {...props} />;
}
