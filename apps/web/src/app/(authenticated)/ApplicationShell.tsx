import type { ReactNode } from "react";
import { SourceDisclaimer } from "@/components/SourceDisclaimer";

interface ApplicationShellProps {
  sidebar: ReactNode;
  topbar: ReactNode;
  children: ReactNode;
}

export function ApplicationShell({
  sidebar,
  topbar,
  children,
}: ApplicationShellProps): ReactNode {
  return (
    <div className="app-shell">
      {sidebar}
      <div className="app-shell__workspace">
        {topbar}
        <div className="shell-container app-content" id="main-content" tabIndex={-1}>
          {children}
        </div>
        <footer className="shell-container app-footer">
          <div className="source-disclaimer"><SourceDisclaimer /></div>
        </footer>
      </div>
    </div>
  );
}
