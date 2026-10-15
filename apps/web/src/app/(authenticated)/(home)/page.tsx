import type { ReactNode } from "react";
import type { ElectoralContextSearchParams } from "@/lib/context/url";
import { OperationalBriefing } from "../OperationalBriefing";
import { loadPanorama } from "../panorama/load-panorama";

export default async function OperationalBriefingPage({ searchParams }: { searchParams?: Promise<ElectoralContextSearchParams> } = {}): Promise<ReactNode> {
  return <OperationalBriefing data={await loadPanorama(await searchParams ?? {})} />;
}
