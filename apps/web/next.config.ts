import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // TypeScript 7 (installed here, see package.json) does not yet provide
  // the compiler API Next.js 16 expects by default; this opts into the
  // TypeScript-CLI-based type-check path instead. Dev-server infra
  // requirement discovered while setting up the Phase 9 e2e run — unrelated
  // to access-control logic itself.
  experimental: {
    useTypeScriptCli: true,
  },
};

export default nextConfig;
