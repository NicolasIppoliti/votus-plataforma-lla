import { profileServerSpan } from "@/lib/workspace/profile-server";
import type { ReactNode } from "react";
import type { ElectoralContextSearchParams } from "@/lib/context/url";
import { OperationalBriefing } from "../OperationalBriefing";
import { loadPanorama } from "../panorama/load-panorama";

export default async function OperationalBriefingPage({ searchParams }: { searchParams?: Promise<ElectoralContextSearchParams> } = {}): Promise<ReactNode> {
  return profileServerSpan("page.panorama", async () => {
    const params = await searchParams ?? {};
    return <OperationalBriefing data={await loadPanorama(params)} contextSearchParams={params} />;
  });
}
