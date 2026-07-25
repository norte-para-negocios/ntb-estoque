// lib/failover/health-monitor.ts
// Monitor de saude do Supabase real, rodando em processo (setInterval),
// iniciado uma vez pelo instrumentation.ts quando o servidor sobe.
//
// Estado fica em globalThis (nao em variavel de modulo solta) -- achado
// real em producao (2026-07-25, Task 4 da Fase 2 do failover): o Next.js
// compila Server Actions/rotas em chunks separados do chunk usado por
// instrumentation.ts, e cada chunk pode acabar com sua PROPRIA copia deste
// modulo (variavel de modulo `let status` isolada por copia). Resultado:
// instrumentation.ts atualizava o status pra 'down' corretamente (log
// aparecia), mas Server Actions como `login` (via lib/supabase/server.ts)
// liam uma copia diferente do modulo, sempre travada em 'up' -- o app
// continuava tentando o Supabase real (bloqueado) e o login quebrava de
// verdade durante a "queda", em vez de trocar pro standby. globalThis e
// compartilhado entre TODAS as copias do modulo no mesmo processo Node,
// entao resolve isso (mesmo padrao usado pra evitar multiplas instancias
// de client do Prisma em apps Next.js).
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

interface FailoverState {
  status: Status
  falhasConsecutivas: number
  sucessosConsecutivos: number
  intervalId: ReturnType<typeof setInterval> | null
}

const globalForFailover = globalThis as unknown as { __ntbFailoverState?: FailoverState }

function getState(): FailoverState {
  if (!globalForFailover.__ntbFailoverState) {
    globalForFailover.__ntbFailoverState = {
      status: 'up',
      falhasConsecutivas: 0,
      sucessosConsecutivos: 0,
      intervalId: null,
    }
  }
  return globalForFailover.__ntbFailoverState
}

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
  const s = getState()
  const saudavel = await checarSupabaseReal()

  if (saudavel) {
    s.falhasConsecutivas = 0
    s.sucessosConsecutivos++
    if (s.status === 'down' && s.sucessosConsecutivos >= SUCESSOS_PARA_VOLTAR) {
      s.status = 'up'
      console.log('[failover] Supabase real recuperado -- voltando a usar como principal')
    }
  } else {
    s.sucessosConsecutivos = 0
    s.falhasConsecutivas++
    if (s.status === 'up' && s.falhasConsecutivas >= FALHAS_PARA_CAIR) {
      s.status = 'down'
      console.log('[failover] Supabase real inacessivel -- trocando para o stack self-hosted do Contabo')
    }
  }
}

export function iniciarMonitorDeSaude() {
  const s = getState()
  if (s.intervalId) return // ja iniciado (evita duplicar em hot-reload/re-import)
  s.intervalId = setInterval(tick, INTERVALO_MS)
  void tick() // primeira checagem imediata, nao espera o primeiro intervalo
}

export function getFailoverStatus(): Status {
  return getState().status
}
