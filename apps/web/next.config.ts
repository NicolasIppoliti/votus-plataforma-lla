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
    "/municipal": ["../../archive-manifest.json", "../../archive/geography/cne-pba-sections.*.geojson"],
    "/api/geography/buenos-aires": [
      "../../archive-manifest.json",
      "../../archive/geography/ign-buenos-aires-province.314600f9b681841b9f35c27fac030c835de6a95cbf4a0c4256a39df6c069f723.geojson",
    ],
  },
  experimental: {
    testProxy: e2eTestProxyEnabled,
  },
};

export default nextConfig;
