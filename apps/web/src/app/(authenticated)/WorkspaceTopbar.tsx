import type { ReactNode } from "react";
import { ThemeSelector } from "@/components/ThemeSelector";
import { WorkspaceReviewStatus, WorkspaceIdentity } from "./WorkspacePresentation";

interface WorkspaceTopbarProps {
  mobileNavigation: ReactNode;
  accountControls: ReactNode;
}

export function WorkspaceTopbar({
  mobileNavigation,
  accountControls,
}: WorkspaceTopbarProps): ReactNode {
  return (
    <header className="workspace-topbar">
      <div className="shell-container workspace-topbar__inner">
        {mobileNavigation}
        <div className="workspace-topbar__context">
          <WorkspaceIdentity />
          <div className="review-alert" role="status"><WorkspaceReviewStatus /></div>
        </div>
        <div className="workspace-topbar__actions">
          <ThemeSelector />
          <div className="workspace-topbar__controls">{accountControls}</div>
        </div>
      </div>
    </header>
  );
}
