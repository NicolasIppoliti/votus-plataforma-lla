import type { ReactNode } from "react";
import { WorkspaceReviewStatus, WorkspaceIdentity } from "./WorkspacePresentation";

interface WorkspaceTopbarProps {
  mobileNavigation: ReactNode;
}

export function WorkspaceTopbar({
  mobileNavigation,
}: WorkspaceTopbarProps): ReactNode {
  return (
    <header className="workspace-topbar">
      <div className="shell-container workspace-topbar__inner">
        {mobileNavigation}
        <WorkspaceIdentity />
        <div className="review-alert" role="status"><WorkspaceReviewStatus /></div>
      </div>
    </header>
  );
}
