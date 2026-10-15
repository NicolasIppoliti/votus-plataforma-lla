import { Suspense, type ReactNode } from "react";
import { SourceDisclaimer } from "@/components/SourceDisclaimer";
import "./page-container.css";
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
        <footer className="shell-container app-footer">
          <div className="source-disclaimer"><SourceDisclaimer /></div>
        </footer>
      </div>
    </div>
  );
}
