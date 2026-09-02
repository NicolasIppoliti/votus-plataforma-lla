import type { ReactNode } from "react";
import Link from "next/link";
import { SignOutForm } from "@/components/SignOutForm";
import { WorkspaceSelector } from "@/components/WorkspaceSelector";
import type { WorkspaceSelection } from "@/lib/workspace/selection";

interface WorkspaceTopbarProps {
  selection: WorkspaceSelection;
  unresolvedCount: number | undefined;
  mobileNavigation: ReactNode;
}

export function WorkspaceTopbar({
  selection,
  unresolvedCount,
  mobileNavigation,
}: WorkspaceTopbarProps): ReactNode {
  return (
    <header className="workspace-topbar">
      <div className="shell-container workspace-topbar__inner">
        {mobileNavigation}
        <WorkspaceSelector initialSelection={selection} />
        {unresolvedCount === undefined ? (
          <p className="review-alert" role="status">
            No se pudo verificar el estado de revisión.
          </p>
        ) : null}
        {typeof unresolvedCount === "number" && unresolvedCount > 0 ? (
          <p className="review-alert" role="alert">
            <span className="status-label">Requiere revisión</span>
            <Link href="/review">
              {unresolvedCount} elemento(s) de revisión pendiente(s)
            </Link>
          </p>
        ) : null}
        <SignOutForm />
      </div>
    </header>
  );
}
