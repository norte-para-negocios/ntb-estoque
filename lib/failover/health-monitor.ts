// lib/failover/health-monitor.ts
// Monitor de saude do Supabase real, rodando em processo (setInterval),
// iniciado uma vez pelo instrumentation.ts quando o servidor sobe. Estado
// fica em variavel de modulo -- sem arquivo, sem processo separado, porque
// next start no Contabo e um processo Node persistente (nao serverless).
//
// Cobre DOIS aspectos (o incidente de 2026-07-23 mostrou que um pode estar
// de pe enquanto o outro nao): uma query real via service role (prova que
// o banco responde) E uma checagem do endpoint de saude do Auth (prova que
// login funcionaria). So considera "up" se os dois passarem.

const INTERVALO_MS = 5000
const FALHAS_PARA_CAIR = 3
const SUCESSOS_PARA_VOLTAR = 3
const TIMEOUT_MS = 5000

type Status = 'up' | 'down'

let status: Status = 'up'
let falhasConsecutivas = 0
let sucessosConsecutivos = 0
let intervalId: ReturnType<typeof setInterval> | null = null

async function checarComTimeout(url: string, init?: RequestInit): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal })
    return resp.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function checarSupabaseReal(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceKey) return true // sem config, nao tenta trocar

  const [bancoOk, authOk] = await Promise.all([
    checarComTimeout(`${url}/rest/v1/lojas?select=id&limit=1`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    }),
    checarComTimeout(`${url}/auth/v1/health`, {
      headers: { apikey: anonKey },
    }),
  ])
  return bancoOk && authOk
}

async function tick() {
  const saudavel = await checarSupabaseReal()

  if (saudavel) {
    falhasConsecutivas = 0
    sucessosConsecutivos++
    if (status === 'down' && sucessosConsecutivos >= SUCESSOS_PARA_VOLTAR) {
      status = 'up'
      console.log('[failover] Supabase real recuperado -- voltando a usar como principal')
    }
  } else {
    sucessosConsecutivos = 0
    falhasConsecutivas++
    if (status === 'up' && falhasConsecutivas >= FALHAS_PARA_CAIR) {
      status = 'down'
      console.log('[failover] Supabase real inacessivel -- trocando para o stack self-hosted do Contabo')
    }
  }
}

export function iniciarMonitorDeSaude() {
  if (intervalId) return // ja iniciado (evita duplicar em hot-reload/re-import)
  intervalId = setInterval(tick, INTERVALO_MS)
  void tick() // primeira checagem imediata, nao espera o primeiro intervalo
}

export function getFailoverStatus(): Status {
  return status
}
