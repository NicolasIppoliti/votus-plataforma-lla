import { Suspense, type ReactNode } from "react";
import { ElectoralContextBar } from "./ElectoralContextBar";

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
        <Suspense><ElectoralContextBar /></Suspense>
        <div className="shell-container app-content" id="main-content" tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>
  );
}
