import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex min-h-12 w-full min-w-0 rounded-command-compact! border border-command-muted-ink! bg-command-surface! px-3 py-2.5 text-command-ink! placeholder:text-command-muted-ink disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-command-danger!",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
