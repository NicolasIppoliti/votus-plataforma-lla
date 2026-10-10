import type { NextConfig } from "next";
import { resolve } from "node:path";

const e2eTestProxyEnabled = process.env.VOTUS_E2E_TEST_PROXY === "1";

const nextConfig: NextConfig = {
  // `pnpm build` runs the TypeScript 7 CLI before Next. Next resolves the
  // `typescript` package directly, which is the TypeScript 6 API alias needed
  // by typescript-eslint and exposes `tsc6`, not the application `tsc` bin.
  typescript: {
    ignoreBuildErrors: true,
  },
  // Trace above apps/web, but include globs remain relative to the Next.js project root.
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  outputFileTracingIncludes: {
    // Section outline from the archive, plus the pinned Slice 11 artifact read by
    // src/lib/geography/cne-rosales-reference.ts.
    "/municipal": [
      "../../archive-manifest.json",
      "../../archive/geography/cne-pba-sections.*.geojson",
      "./data/geography/cne-rosales-2025-reference.fee7cd013ecd6b646bb58683160b3b4e714e1b7394fc462070f3168cd3b24577.json",
    ],
    "/api/geography/buenos-aires": [
      "../../archive-manifest.json",
      "../../archive/geography/ign-buenos-aires-province.314600f9b681841b9f35c27fac030c835de6a95cbf4a0c4256a39df6c069f723.geojson",
    ],
    // Pinned Slice 10 artifact read by src/lib/scenarios/scenario-artifact.ts.
    "/scenarios": [
      "./data/scenarios/rosales-concejales-2027.0a7c6c0e607f1f0e13534f7d7e1711b011faabaa2a6f6a3d47bc20b6bbcad2b4.json",
    ],
  },
  experimental: {
    testProxy: e2eTestProxyEnabled,
  },
};

export default nextConfig;
