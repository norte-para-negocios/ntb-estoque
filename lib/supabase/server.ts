import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getFailoverStatus } from '@/lib/failover/health-monitor'

// Credenciais do stack self-hosted do Contabo (Fase 1 do failover) -- o app
// roda no MESMO servidor, entao acessa via loopback (as portas so escutam
// em 127.0.0.1 desde a correcao de seguranca da Fase 1, nunca reabrir pra
// 0.0.0.0). So usadas quando o monitor de saude confirma o Supabase real
// inacessivel (lib/failover/health-monitor.ts).
const STANDBY_URL = 'http://127.0.0.1:8100'
const STANDBY_ANON_KEY = process.env.FAILOVER_STANDBY_ANON_KEY!
const STANDBY_SERVICE_ROLE_KEY = process.env.FAILOVER_STANDBY_SERVICE_ROLE_KEY!

export function urlEChaveAtuais(tipo: 'anon' | 'service') {
  if (getFailoverStatus() === 'down') {
    return {
      url: STANDBY_URL,
      key: tipo === 'anon' ? STANDBY_ANON_KEY : STANDBY_SERVICE_ROLE_KEY,
    }
  }
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key: tipo === 'anon' ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! : process.env.SUPABASE_SERVICE_ROLE_KEY!,
  }
}

export async function createClient() {
  const cookieStore = await cookies()
  const { url, key } = urlEChaveAtuais('anon')
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // chamado de um Server Component — pode ignorar se middleware atualiza a sessao
        }
      },
    },
  })
}

// Client com service_role para operacoes server-side que ignoram RLS
// (syncs Omie, webhook, escritas administrativas). NUNCA expor ao browser.
export function createServiceClient() {
  const { url, key } = urlEChaveAtuais('service')
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return []
      },
      setAll() {},
    },
  })
}
