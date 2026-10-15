import type { ReactNode } from "react";
import { WorkspaceIdentity, WorkspaceReviewStatus } from "./WorkspacePresentation";

export function WorkspaceTopbar({ mobileNavigation, organizationControls }: { mobileNavigation: ReactNode; organizationControls: ReactNode }): ReactNode {
  return (
    <header className="workspace-topbar">
      <div className="shell-container workspace-topbar__inner">
        {mobileNavigation}
        <div className="workspace-topbar__mobile-identity"><WorkspaceIdentity /></div>
        <div className="workspace-topbar__controls">{organizationControls}</div>
        <div className="review-alert" role="status"><WorkspaceReviewStatus /></div>
      </div>
    </header>
  );
}
