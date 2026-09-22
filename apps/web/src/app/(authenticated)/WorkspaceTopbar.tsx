import type { ReactNode } from "react";
import { WorkspaceReviewStatus } from "./WorkspacePresentation";

export function WorkspaceTopbar({ mobileNavigation }: { mobileNavigation: ReactNode }): ReactNode {
  return (
    <header className="workspace-topbar">
      <div className="shell-container workspace-topbar__inner">
        {mobileNavigation}
        <div className="review-alert" role="status"><WorkspaceReviewStatus /></div>
      </div>
    </header>
  );
}
