import { loadProvinceReferenceGeometry } from "@/lib/workspace/province-reference-geometry";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const feature = await loadProvinceReferenceGeometry();
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  if (!feature) return Response.json({ status: "withheld" }, { status: 503, headers });
  return Response.json(feature, { headers });
}
