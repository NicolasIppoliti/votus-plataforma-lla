import { profileServerSpan } from "@/lib/workspace/profile-server";
import type { ReactNode } from "react";
import type { ElectoralContextSearchParams } from "@/lib/context/url";
import { OperationalBriefing } from "../OperationalBriefing";
import { loadPanorama } from "../panorama/load-panorama";

export default async function OperationalBriefingPage({ searchParams }: { searchParams?: Promise<ElectoralContextSearchParams> } = {}): Promise<ReactNode> {
  return profileServerSpan("page.panorama", async () => <OperationalBriefing data={await loadPanorama()} contextSearchParams={await searchParams ?? {}} />);
}
