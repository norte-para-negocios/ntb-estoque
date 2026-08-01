import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// O app roda 100% no stack self-hosted do Contabo desde a migracao de
// 2026-07-31 (NEXT_PUBLIC_SUPABASE_URL aponta pro loopback 127.0.0.1:8100 --
// as portas so escutam em localhost, nunca reabrir pra 0.0.0.0).
//
// O failover que existia aqui (troca automatica pro standby quando o monitor
// de saude via o Supabase cloud fora do ar) foi removido em 2026-08-01: com o
// Contabo virando o PRIMARIO, os dois lados do `if` ja apontavam pro mesmo
// lugar -- codigo morto que so confundia. O cloud tambem deixou de ser um
// fallback real (a replicacao morreu com o slot invalidado, e ele ficou
// ~20 mil OPs atras), entao manter a ilusao de rede de seguranca era pior
// que nao ter nenhuma.
export function urlEChaveAtuais(tipo: 'anon' | 'service') {
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
