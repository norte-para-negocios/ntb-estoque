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
//
// Roda como root (systemd User=root) num servidor dedicado (nao
// compartilhado/sandboxed) -- por isso pode chamar `docker start/stop`
// diretamente pra controlar a stack de failover self-hosted. Nenhum dado de
// entrada de usuario chega nesses comandos (lista de containers e fixa,
// passada como array pro execFile -- nunca concatenada numa string de shell).
//
// Achado real (2026-07-31): existia um script separado (cron a cada 5min,
// scripts/failover-supabase-watch.sh, removido) pra ligar/desligar a stack
// Docker do standby self-hosted -- mas ele so percebia a queda depois de
// ate 15min, enquanto este monitor troca a ROTA do app em ~15s. Resultado:
// o app trocava pro standby quase na hora, mas o standby podia continuar
// desligado por minutos -- apagao real apesar de ter failover. Unificado
// aqui: quem detecta a troca de estado tambem liga/desliga os containers,
// no mesmo instante.
//
// Design corrigido apos 2 rodadas de revisao independente (2026-07-31) --
// a 1a versao unificada confiava numa flag booleana (`standbyConfirmado`)
// pra saber se os containers estavam de pe, setada uma vez no sucesso do
// `docker start`/`stop`. Duas rodadas de revisao acharam que isso podia
// ficar desatualizado (container cai depois de subir, comando falha sem
// retry) e reabrir o mesmo buraco que essa unificacao tentava fechar. Design
// final: NUNCA confia numa flag -- toda vez que status='down', pergunta de
// novo pro Docker se o standby esta MESMO rodando (nao so "mandei o comando
// uma vez") e corrige se nao estiver; mesma logica espelhada pro lado 'up'
// (corrige containers orfaos que ficaram rodando por um `stop` que falhou).
// Isso torna o sistema autocorretivo a cada tick (5s) em vez de depender de
// uma unica tentativa ter dado certo.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const INTERVALO_MS = 5000
const TIMEOUT_MS = 8000
const DOCKER_TIMEOUT_MS = 90_000 // boot completo dos containers mediu ~40-60s

// PAUSA PRE-CORTE (2026-07-31): o Contabo virou o banco principal de fato
// (corte real, ver docs/superpowers/plans/2026-07-31-migracao-contabo-primario.md
// Task 5). A partir de agora TODOS os containers do stack self-hosted
// precisam ficar sempre ligados (sao a producao, nao mais um standby de
// emergencia) -- por isso a lista abaixo nao e mais "liga/desliga sob
// demanda", e sim so a lista do que garantirStackSempreLigada() confere a
// cada tick. O desligamento condicional (que existia aqui antes do corte)
// foi removido -- nao ha mais standby pra desligar quando "tudo normaliza".
// Este arquivo inteiro sera apagado pela Task 6, dias depois deste corte,
// quando o Supabase cloud ja estiver confirmado estavel como rede de
// seguranca (ver docs/superpowers/plans/2026-07-31-migracao-contabo-primario.md).
const CONTAINERS_FAILOVER = [
  'supabase-kong',
  'supabase-pooler',
  'supabase-storage',
  'supabase-edge-functions',
  'realtime-dev.supabase-realtime',
  'supabase-meta',
  'supabase-auth',
  'supabase-rest',
  'supabase-db',
  'supabase-studio',
  'supabase-imgproxy',
]

type Status = 'up' | 'down'

interface FailoverState {
  status: Status
  falhasConsecutivas: number
  sucessosConsecutivos: number
  dockerComandoEmAndamento: boolean // guarda contra varreduras de garantirStackSempreLigada() sobrepostas
  emExecucao: boolean // guarda contra tick() sobreposto (TIMEOUT_MS == INTERVALO_MS)
  iniciado: boolean // guarda iniciarMonitorDeSaude() ser chamado 2x antes do setup async terminar
  intervalId: ReturnType<typeof setInterval> | null
}

const globalForFailover = globalThis as unknown as { __ntbFailoverState?: FailoverState }

function getState(): FailoverState {
  if (!globalForFailover.__ntbFailoverState) {
    globalForFailover.__ntbFailoverState = {
      status: 'up',
      falhasConsecutivas: 0,
      sucessosConsecutivos: 0,
      dockerComandoEmAndamento: false,
      emExecucao: false,
      iniciado: false,
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

// Pos-corte (2026-07-31): garante que TODOS os containers do stack
// self-hosted fiquem sempre rodando -- sao a producao agora, nao mais um
// standby liga/desliga sob demanda. Confere um por um (docker inspect),
// so chama `docker start` no que estiver realmente parado. Nunca cacheia
// numa flag -- mesma filosofia autocorretiva do design anterior.
async function garantirStackSempreLigada() {
  const s = getState()
  if (s.dockerComandoEmAndamento) return
  s.dockerComandoEmAndamento = true
  try {
    for (const container of CONTAINERS_FAILOVER) {
      try {
        const { stdout } = await execFileAsync(
          'docker',
          ['inspect', '-f', '{{.State.Running}}', container],
          { timeout: DOCKER_TIMEOUT_MS }
        )
        if (stdout.trim() === 'true') continue
      } catch {
        // container nao existe ou docker nao respondeu -- tenta o start mesmo assim
      }
      try {
        await execFileAsync('docker', ['start', container], { timeout: DOCKER_TIMEOUT_MS })
        console.log('[failover] container da producao estava parado, religado:', container)
      } catch (e) {
        console.error('[failover] falha ao religar container da producao (verifica de novo no proximo tick):', container, e instanceof Error ? e.message : e)
      }
    }
  } finally {
    s.dockerComandoEmAndamento = false
  }
}

async function tick() {
  const s = getState()
  if (s.emExecucao) return // tick anterior ainda rodando (TIMEOUT_MS == INTERVALO_MS, pode sobrepor)
  s.emExecucao = true
  try {
    void garantirStackSempreLigada()
    const saudavel = await checarSupabaseReal()
    // Status so serve pra log/observabilidade agora -- nenhuma acao de
    // Docker depende mais dele (ver garantirStackSempreLigada acima).
    if (saudavel) {
      s.falhasConsecutivas = 0
      s.sucessosConsecutivos++
    } else {
      s.sucessosConsecutivos = 0
      s.falhasConsecutivas++
    }
  } finally {
    s.emExecucao = false
  }
}

export function iniciarMonitorDeSaude() {
  const s = getState()
  if (s.iniciado) return // ja iniciado (evita duplicar em hot-reload/re-import ou chamada dupla)
  s.iniciado = true
  void (async () => {
    // Primeiro tick ja chama garantirStackSempreLigada() -- religa qualquer
    // container que nao esteja de pe no boot, sem precisar de um passo
    // separado de sincronizacao (o corte tornou isso simples: nao existe
    // mais "standby vs principal" pra decidir, so "esta tudo ligado?").
    await tick()
    s.intervalId = setInterval(tick, INTERVALO_MS)
  })()
}

export function getFailoverStatus(): Status {
  return getState().status
}
