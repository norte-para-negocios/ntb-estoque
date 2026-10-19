import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { headersDoContexto } from '@/lib/offline/contexto'
import { mandaAutor } from '@/lib/supabase/autor-puro'
import { dentroDeSemAutor } from '@/lib/supabase/sem-autor'

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
  const headers = headersDoContexto()
  return createServerClient(url, key, {
    // Ação vinda do app desktop: o id do intent vai junto para a outbox/rastreio (lib/offline/contexto.ts).
    ...(headers ? { global: { headers } } : {}),
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

// Fase G (histórico de alterações, migration 220): toda ESCRITA do service client feita dentro de uma requisição com
// usuário logado leva o id dele no cabeçalho x-ntb-autor; o gatilho historico_registrar grava quem mudou. O banco só
// aceita o cabeçalho com JWT de service_role (um usuário comum não se passa por outro). Sem cookies (cron, script) ou sem
// sessão: sem cabeçalho, nada muda. Leitura (GET/HEAD) nunca resolve o usuário. Uma consulta ao login por requisição.
const autorPorRequisicao = new WeakMap<object, Promise<string | null>>()

async function autorDaRequisicao(): Promise<string | null> {
  let store: Awaited<ReturnType<typeof cookies>>
  try {
    store = await cookies()
  } catch {
    return null // fora de uma requisição (script, after() já encerrado)
  }
  if (!store.getAll().some((c) => c.name.startsWith('sb-'))) return null
  let p = autorPorRequisicao.get(store)
  if (!p) {
    p = (async () => {
      try {
        const { data } = await (await createClient()).auth.getUser()
        return data.user?.id ?? null
      } catch {
        return null
      }
    })()
    autorPorRequisicao.set(store, p)
  }
  return p
}

const fetchComAutor: typeof fetch = async (input, init) => {
  if (!mandaAutor({ metodo: init?.method, clienteSemAutor: false, contextoSemAutor: dentroDeSemAutor() })) return fetch(input, init)
  const autor = await autorDaRequisicao()
  if (!autor) return fetch(input, init)
  const headers = new Headers(init?.headers)
  headers.set('x-ntb-autor', autor)
  return fetch(input, { ...init, headers })
}

// Client com service_role para operacoes server-side que ignoram RLS
// (syncs Omie, webhook, escritas administrativas). NUNCA expor ao browser.
// `semAutor: true` (lib/omie/*): o que vem do Omie é gravado no histórico como "Sistema", nunca em nome de quem clicou.
export function createServiceClient(opcoes?: { semAutor?: boolean }) {
  const { url, key } = urlEChaveAtuais('service')
  const headers = headersDoContexto()
  return createServerClient(url, key, {
    global: { ...(headers ? { headers } : {}), ...(opcoes?.semAutor ? {} : { fetch: fetchComAutor }) },
    cookies: {
      getAll() {
        return []
      },
      setAll() {},
    },
  })
}
