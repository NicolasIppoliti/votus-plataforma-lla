import type { ReactNode } from "react";
import { OperationalBriefing } from "../OperationalBriefing";
import { loadPanorama } from "../panorama/load-panorama";

export default async function OperationalBriefingPage(): Promise<ReactNode> {
  return <OperationalBriefing data={await loadPanorama()} />;
}
