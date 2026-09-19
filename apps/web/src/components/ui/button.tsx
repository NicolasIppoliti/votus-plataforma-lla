import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import * as Slot from "radix-ui/slot";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-command-compact border px-2.5 py-2 font-semibold disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        solid: "border-command-accent-strong bg-command-accent-strong! text-command-surface! font-bold! hover:bg-command-accent! active:enabled:bg-command-accent-strong! disabled:border-command-muted-ink disabled:bg-command-surface-muted! disabled:text-command-muted-ink! disabled:opacity-100",
        outline: "border-command-accent-strong bg-command-surface text-command-accent-strong",
        ghost: "border-command-surface-muted bg-transparent text-command-surface",
      },
    },
    defaultVariants: { variant: "outline" },
  },
);

function Button({ className, variant, asChild = false, ...props }: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, className }))}
      {...props}
    />
  );
}

export { Button };
