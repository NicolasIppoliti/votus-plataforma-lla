import { profileServerSpan } from "@/lib/workspace/profile-server";
import type { ReactNode } from "react";
import { OperationalBriefing } from "../OperationalBriefing";
import { loadPanorama } from "../panorama/load-panorama";

export default async function OperationalBriefingPage(): Promise<ReactNode> {
  return profileServerSpan("page.panorama", async () => <OperationalBriefing data={await loadPanorama()} />);
}
