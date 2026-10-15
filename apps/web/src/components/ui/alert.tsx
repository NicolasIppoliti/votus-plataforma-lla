import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const roles = {
  error: "alert",
  denied: "alert",
  unavailable: "alert",
  "needs-selection": "status",
  empty: "status",
  caveat: "status",
} as const;

export type AlertVariant = keyof typeof roles;

type AlertProps = Omit<ComponentProps<"div">, "role"> & {
  variant: AlertVariant;
  presentation?: "box" | "inline";
  action?: ReactNode;
};

// Shared, server-renderable announcement and visual treatment for workspace states.
export function Alert({ className, variant, presentation = "box", children, action, "aria-labelledby": labelledBy, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      className={cn("relative min-w-0 workspace-alert", presentation === "inline" ? "workspace-alert--inline" : "w-full", className)}
      {...props}
      role={roles[variant]}
      aria-labelledby={labelledBy}
    >
      {children}
      {action ? <div className="workspace-alert__action">{action}</div> : null}
    </div>
  );
}
