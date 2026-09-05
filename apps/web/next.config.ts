import type { NextConfig } from "next";

const e2eTestProxyEnabled = process.env.VOTUS_E2E_TEST_PROXY === "1";

const nextConfig: NextConfig = {
  // `pnpm build` runs the TypeScript 7 CLI before Next. Next resolves the
  // `typescript` package directly, which is the TypeScript 6 API alias needed
  // by typescript-eslint and exposes `tsc6`, not the application `tsc` bin.
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    testProxy: e2eTestProxyEnabled,
  },
};

export default nextConfig;
