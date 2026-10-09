import type { NextConfig } from "next";

// NTB_DESKTOP=1: build do app desktop (desktop/scripts/build-web.sh) -- servidor standalone num
// diretório separado, sem mexer no .next do servidor de produção.
const desktop = process.env.NTB_DESKTOP === '1'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  ...(desktop ? { output: 'standalone' as const, distDir: '.next-desktop', outputFileTracingRoot: process.cwd() } : {}),
};

export default nextConfig;
