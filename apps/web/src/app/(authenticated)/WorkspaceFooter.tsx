"use client";

import type { ReactNode } from "react";
import type { WorkspaceSelection } from "@/lib/workspace/selection";
import { WorkspaceSelector } from "@/components/WorkspaceSelector";
import { useWorkspaceSwitchStart } from "./WorkspacePresentation";

export function WorkspaceFooter({ selection, children }: {
  selection: WorkspaceSelection;
  children: ReactNode;
}) {
  const onSwitchStart = useWorkspaceSwitchStart();
  return (
    <div className="workspace-footer" role="group" aria-label="Organización y cuenta">
      <WorkspaceSelector initialSelection={selection} onSwitchStart={onSwitchStart} />
      {children}
    </div>
  );
}
