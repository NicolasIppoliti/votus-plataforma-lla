import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Adapted from shadcn radix-nova; domain callers own announcement semantics.
export function Alert({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert" className={cn("relative w-full min-w-0", className)} {...props} />;
}
