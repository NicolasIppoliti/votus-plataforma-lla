import type { ReactNode } from "react";
import { WorkspaceRequiredState } from "@/components/WorkspaceRequiredState";
import { loadWorkspaceSelection } from "@/lib/workspace/selection";
import { OperationalBriefing } from "../OperationalBriefing";
import { loadPanorama } from "../panorama/load-panorama";

export default async function OperationalBriefingPage(): Promise<ReactNode> {
  const selection = await loadWorkspaceSelection();
  if (selection.status !== "active") return <WorkspaceRequiredState selection={selection} title="Panorama" />;
  return <OperationalBriefing data={await loadPanorama()} />;
}
