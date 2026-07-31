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
// Achado real em producao (2026-07-31, poucas horas apos o deploy da versao
// unificada): com so 3 checagens (15s) pra virar, o Supabase real oscilou
// (provavelmente por lentidao momentanea do PROPRIO servidor Contabo sob
// carga, nao uma queda real -- confirmado testando direto do meu proprio
// computador no mesmo instante: sempre 200/200, rapido) e o monitor ficou
// ligando/desligando os 11 containers repetidas vezes em poucos minutos
// (visto ao vivo no log: start as 18:33:25, stop as 18:33:41, start de novo
// as 18:34:48...). Isso classifica como pior que o problema original: gasta
// CPU restartando Postgres repetidamente, arrisca corromper o standby se
// matar o container no meio de um boot, e ainda ROTEIA requisicoes reais
// (login incluso) pro standby just nesses picos, travando por ate 60s
// esperando um standby que mal comecou a subir. Limiares subidos de 3 pra
// 12 (60s de falha/sucesso sustentado, nao so um blip) + cooldown de acao
// abaixo, especificamente pra parar esse tipo de oscilacao rapida.
const FALHAS_PARA_CAIR = 12
const SUCESSOS_PARA_VOLTAR = 12
const TIMEOUT_MS = 8000
const DOCKER_TIMEOUT_MS = 90_000 // boot completo dos containers mediu ~40-60s
// Trava dura contra oscilacao: mesmo que o status vire de novo rapido, nao
// deixa uma segunda acao de docker (start OU stop) disparar antes desse
// tempo da ultima -- cada start/stop de verdade da stack inteira (Postgres
// incluso) tem custo e risco real, nao e algo pra repetir a cada minuto.
const COOLDOWN_ACAO_MS = 3 * 60 * 1000

// 'supabase-db' NAO esta nesta lista de proposito -- ver
// garantirBancoStandbySempreLigado() logo abaixo pra explicacao completa.
const CONTAINERS_FAILOVER = [
  'supabase-kong',
  'supabase-pooler',
  'supabase-storage',
  'supabase-edge-functions',
  'realtime-dev.supabase-realtime',
  'supabase-meta',
  'supabase-auth',
  'supabase-rest',
  'supabase-studio',
  'supabase-imgproxy',
]
const CONTAINER_REPRESENTATIVO = 'supabase-kong' // usado so pra sondar se o RESTO da stack esta de pe (nao o banco, que fica sempre ligado)

type Status = 'up' | 'down'

interface FailoverState {
  status: Status
  falhasConsecutivas: number
  sucessosConsecutivos: number
  dockerComandoEmAndamento: boolean // guarda contra start/stop sobrepostos (um docker start pode levar ~1min)
  ultimaAcaoDockerEm: number | null // timestamp do ultimo start/stop bem-sucedido -- base do cooldown
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
      ultimaAcaoDockerEm: null,
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

// true se o container representativo do standby estiver rodando agora --
// consultado de novo a cada tick relevante (nunca cacheado numa flag), pra
// nunca depender de uma decisao antiga que pode ter ficado desatualizada.
async function standbyEstaRodando(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['inspect', '-f', '{{.State.Running}}', CONTAINER_REPRESENTATIVO],
      { timeout: DOCKER_TIMEOUT_MS }
    )
    return stdout.trim() === 'true'
  } catch {
    return false // container nao existe, docker nao responde, etc -- trata como "nao rodando"
  }
}

// Achado real em producao (2026-07-31): o 'supabase-db' fazia parte do
// grupo CONTAINERS_FAILOVER acima (ligado/desligado junto com o resto da
// stack, so durante failovers reais). Isso quebra a replicacao logica que
// alimenta esse banco -- o Postgres real (Supabase cloud) mantem um slot de
// replicacao que exige um assinante conectado; se o assinante fica
// desconectado tempo demais (o normal aqui, ja que o container so sobe em
// emergencia), o WAL retido pro slot passa do limite e o Supabase INVALIDA
// o slot (wal_status='lost', invalidation_reason='wal_removed') -- nao da
// pra so reconectar depois, precisa recriar a subscription do zero. Achado
// via scripts/verificar-completude-contabo.mjs (Task 1 da migracao pra
// Contabo como principal): 20 das 41 tabelas replicadas estavam
// divergentes, congeladas num ponto do passado, nao por atraso e sim por
// isso. Correcao: 'supabase-db' fica de fora do grupo liga/desliga e e
// mantido sempre rodando por conta propria (funcao abaixo) -- so o banco,
// nao o resto do stack (Kong/Auth/Storage etc. continuam desligados ate uma
// queda real), custo extra minimo (um Postgres ocioso).
async function garantirBancoStandbySempreLigado() {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['inspect', '-f', '{{.State.Running}}', 'supabase-db'],
      { timeout: DOCKER_TIMEOUT_MS }
    )
    if (stdout.trim() === 'true') return
  } catch {
    // container nao existe ou docker nao respondeu -- tenta o start mesmo
    // assim, deixa o proprio start falhar/logar se for o caso real
  }
  try {
    const { stdout, stderr } = await execFileAsync('docker', ['start', 'supabase-db'], {
      timeout: DOCKER_TIMEOUT_MS,
    })
    console.log('[failover] supabase-db (replica sempre ligada) iniciado:', (stdout || stderr).trim())
  } catch (e) {
    console.error('[failover] falha ao garantir supabase-db ligado (verifica de novo no proximo tick):', e instanceof Error ? e.message : e)
  }
}

// So dispara o docker start se o standby REALMENTE nao estiver rodando (nao
// so "achamos que nao esta"), e nunca sobrepoe outro start/stop em curso.
async function ligarStackFailoverSeNecessario() {
  const s = getState()
  // Trava ANTES de checar a realidade (nao depois) -- achado de revisao
  // independente (2026-07-31): checar-depois-travar deixava um vao entre o
  // `await standbyEstaRodando()` e o `s.dockerComandoEmAndamento = true`
  // onde 2 ticks podiam passar os dois pela checagem antes de qualquer um
  // travar, sobrepondo start/stop de verdade se o `docker inspect` demorasse
  // mais que um tick (5s).
  if (s.dockerComandoEmAndamento) return
  if (s.ultimaAcaoDockerEm !== null && Date.now() - s.ultimaAcaoDockerEm < COOLDOWN_ACAO_MS) return
  s.dockerComandoEmAndamento = true
  try {
    if (await standbyEstaRodando()) return // ja confirmado rodando, nada a fazer
    const { stdout, stderr } = await execFileAsync('docker', ['start', ...CONTAINERS_FAILOVER], {
      timeout: DOCKER_TIMEOUT_MS,
    })
    console.log('[failover] docker start disparado:', (stdout || stderr).trim())
    s.ultimaAcaoDockerEm = Date.now()
  } catch (e) {
    console.error('[failover] falha ao ligar a stack Docker do standby (verifica de novo no proximo tick):', e instanceof Error ? e.message : e)
  } finally {
    s.dockerComandoEmAndamento = false
  }
}

async function desligarStackFailoverSeNecessario() {
  const s = getState()
  if (s.dockerComandoEmAndamento) return
  if (s.ultimaAcaoDockerEm !== null && Date.now() - s.ultimaAcaoDockerEm < COOLDOWN_ACAO_MS) return
  s.dockerComandoEmAndamento = true
  try {
    if (!(await standbyEstaRodando())) return // ja confirmado parado, nada a fazer
    const { stdout, stderr } = await execFileAsync('docker', ['stop', ...CONTAINERS_FAILOVER], {
      timeout: DOCKER_TIMEOUT_MS,
    })
    console.log('[failover] docker stop disparado:', (stdout || stderr).trim())
    s.ultimaAcaoDockerEm = Date.now()
  } catch (e) {
    console.error('[failover] falha ao desligar a stack Docker do standby (verifica de novo no proximo tick):', e instanceof Error ? e.message : e)
  } finally {
    s.dockerComandoEmAndamento = false
  }
}

async function tick() {
  const s = getState()
  if (s.emExecucao) return // tick anterior ainda rodando (TIMEOUT_MS == INTERVALO_MS, pode sobrepor)
  s.emExecucao = true
  try {
    void garantirBancoStandbySempreLigado()
    const saudavel = await checarSupabaseReal()

    if (saudavel) {
      s.falhasConsecutivas = 0
      s.sucessosConsecutivos++
      if (s.status === 'down' && s.sucessosConsecutivos >= SUCESSOS_PARA_VOLTAR) {
        s.status = 'up'
        console.log('[failover] Supabase real recuperado -- voltando a usar como principal')
      }
      if (s.status === 'up') {
        // Autocorretivo: confirma de novo a cada tick que o standby esta
        // mesmo parado (corrige um `docker stop` anterior que falhou).
        void desligarStackFailoverSeNecessario()
      }
    } else {
      s.sucessosConsecutivos = 0
      s.falhasConsecutivas++
      if (s.status === 'up' && s.falhasConsecutivas >= FALHAS_PARA_CAIR) {
        s.status = 'down'
        console.log('[failover] Supabase real inacessivel -- trocando para o stack self-hosted do Contabo')
      }
      if (s.status === 'down') {
        // Autocorretivo: confirma de novo a cada tick que o standby esta
        // mesmo rodando (corrige um `docker start` anterior que falhou ou
        // um container que caiu depois de subir).
        void ligarStackFailoverSeNecessario()
      }
    }
  } finally {
    s.emExecucao = false
  }
}

// Roda uma vez no boot, ANTES do primeiro tick do setInterval: pergunta pro
// Docker (nao assume) se o standby ja esta de pe, e inicializa o status a
// partir da realidade. Fecha o gap de um restart de processo (deploy
// manual, crash) acontecer no meio de uma queda real -- sem isso, o status
// sempre nascia 'up', e o tick() seguinte (que so desliga o standby quando
// status='up') teria desligado um standby que uma queda real ainda precisa.
async function sincronizarComRealidade(): Promise<void> {
  const s = getState()
  if (await standbyEstaRodando()) {
    s.status = 'down'
    console.log('[failover] boot: standby ja estava rodando -- status inicial = down')
  }
  // Se nao esta rodando (ou inconclusivo -- Docker pode nao estar pronto
  // ainda no exato instante do boot), mantem o default 'up'. Nao e um risco
  // permanente: os ticks seguintes reconferem a realidade a cada 5s de
  // qualquer forma (mesma logica autocorretiva acima).
}

export function iniciarMonitorDeSaude() {
  const s = getState()
  if (s.iniciado) return // ja iniciado (evita duplicar em hot-reload/re-import ou chamada dupla)
  s.iniciado = true
  void (async () => {
    await sincronizarComRealidade() // so DEPOIS disso o 1o tick roda, pra nao correr com o boot-sync
    await tick()
    s.intervalId = setInterval(tick, INTERVALO_MS)
  })()
}

export function getFailoverStatus(): Status {
  return getState().status
}
