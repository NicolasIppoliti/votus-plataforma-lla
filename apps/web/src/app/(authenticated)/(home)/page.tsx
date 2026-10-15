import { profileServerSpan } from "@/lib/workspace/profile-server";
import type { ReactNode } from "react";
import { WorkspaceRequiredState } from "@/components/WorkspaceRequiredState";
import { loadWorkspaceSelection } from "@/lib/workspace/selection";
import type { ElectoralContextSearchParams } from "@/lib/context/url";
import { OperationalBriefing } from "../OperationalBriefing";
import { loadPanorama } from "../panorama/load-panorama";

export default async function OperationalBriefingPage({ searchParams }: { searchParams?: Promise<ElectoralContextSearchParams> } = {}): Promise<ReactNode> {
  const selection = await loadWorkspaceSelection();
  if (selection.status !== "active") return <WorkspaceRequiredState selection={selection} title="Panorama" />;
  return profileServerSpan("page.panorama", async () => <OperationalBriefing data={await loadPanorama()} contextSearchParams={await searchParams ?? {}} />);
}
