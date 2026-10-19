import type { NextConfig } from "next";
import { cabecalhosSeguranca } from "./lib/seguranca/regras";

// NTB_DESKTOP=1: build do app desktop (desktop/scripts/build-web.sh) -- servidor standalone num
// diretório separado, sem mexer no .next do servidor de produção.
const desktop = process.env.NTB_DESKTOP === '1'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  // Fase H: não anuncia a tecnologia (X-Powered-By) e manda os cabeçalhos de segurança em toda resposta
  // (anti-clickjacking, nosniff, referrer, permissões; HSTS só no servidor web, nunca no desktop em http local).
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: cabecalhosSeguranca({ desktop }) }]
  },
  ...(desktop ? { output: 'standalone' as const, distDir: '.next-desktop', outputFileTracingRoot: process.cwd() } : {}),
};

export default nextConfig;
