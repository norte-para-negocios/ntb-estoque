// Motor das "frentes" de leitura paginada do Omie por janela de data ("nosso Omie", Fase 1).
// Duas frentes com cursor persistido (espelho_sync_estado.estado):
//  - recente: relê [hoje - (diasRecentes-1), hoje] a cada `intervaloRecenteMin`; se o cron ficou parado,
//    recomeça de `coberto_ate` e anda em janelas de até `janelaMaxDias` (sem esperar o intervalo) até alcançar hoje;
//  - revisao (opcional, `diasRevisao`): 1x a cada `intervaloRevisaoHoras` relê os últimos `diasRevisao` dias já
//    cobertos fora da janela recente (movimento lançado hoje com data antiga; saldo/CMC recalculado pelo Omie);
//  - backfill: depois da 1ª passada recente, desce janela a janela (até `janelaMaxDias`) até `limite`.
// Prioridade: recente > revisao > backfill.
// Dentro da janela, percorre os locais (ordem crescente de código; `null` = recurso sem local) e as páginas.
// D5 (20/10/2026, várias lojas): com `locaisRecenteDias`, a frente recente lê só os locais que tiveram movimento nos
// últimos N dias (`estado.ativos`, marcado por `marcarLocalComMovimento`); revisão e backfill continuam em todos os
// locais e descobrem local novo. Cada local vazio custa 1 chamada ("não existem registros") por janela.
//
// Cobertura "lida" × "conferida" (achado de 20/10/2026 na loja 5: `coberto_ate` = 16/10, mas o kardex de 14–16/10 tinha
// ~1% dos movimentos; as 202–741 OPs concluídas por dia nesses dias, segundo o sync de OPs, não estão no espelho).
// Causa: `recente.coberto_ate` avança quando a janela [ontem, hoje] é lida, e o Omie recebe depois lançamentos com
// data desses dias (reprocessamento do PDV, OP/inventário concluídos depois, recálculo do Omie). Só a revisão diária
// os pega, e ela (a) ficava sem vez (a recente de 30 min levava quase todo o ciclo) e (b) parou no meio da janela
// quando a flag foi desligada em 16/10. Agora:
//  - `conferido_ate`: último dia relido pelo menos 2 dias depois (revisão ou retomada), contíguo desde o início do
//    histórico; os relatórios avisam (ou não usam o kardex, com o espelho desligado) depois dele;
//  - retomada: recente parada há mais de `retomadaHoras` (pausa da guarda, flag desligada) recomeça de
//    `conferido_ate + 1` (no máximo `diasRevisao` para trás), então religar a loja relê o buraco;
//  - cursor parado: janela sem avançar há mais de `cursorMaxHoras` recomeça da página 1 (as páginas do Omie são por
//    posição; continuar da página 40 dias depois pula linhas, e a revisão apagaria o que "não viu").
// Puro, sem imports: node --test lib/estoque/espelho-frentes.test.ts.

export type Cursor = { ini: string; fim: string; local: number | null; pagina: number; iniciado_em?: string; avancado_em?: string }
export type EstadoFrentes = {
  recente: { cursor: Cursor | null; coberto_ate: string | null; concluido_em: string | null; desde: string | null }
  backfill: { cursor: Cursor | null; proximo_fim: string | null; coberto_desde: string | null; concluido: boolean }
  revisao: { cursor: Cursor | null; ate: string | null; concluido_em: string | null }
  /** Local (código) → última data com movimento lido. Só existe depois da 1ª página com movimento. */
  ativos?: Record<string, string>
  /** Último dia relido ≥ 2 dias depois, contíguo desde o início do histórico (ver `conferidoAte`). */
  conferido_ate?: string | null
}
export type ConfigFrentes = {
  diasRecentes: number; janelaMaxDias: number; limite: string; intervaloRecenteMin: number
  diasRevisao?: number; intervaloRevisaoHoras?: number
  /** Frente recente só nos locais com movimento nos últimos N dias (sem lista conhecida: todos). */
  locaisRecenteDias?: number
  /** Recente parada há mais que isso: recomeça de conferido_ate + 1 (padrão 12 h; a madrugada proibida tem 7 h). */
  retomadaHoras?: number
  /** Janela sem avançar há mais que isso (pausa, flag desligada) recomeça da página 1 do primeiro local (padrão 12 h). */
  cursorMaxHoras?: number
}
export type Frente = 'recente' | 'backfill' | 'revisao'

function addDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const menor = (a: string, b: string) => (a < b ? a : b)
const maior = (a: string, b: string) => (a > b ? a : b)
/** Dia (YYYY-MM-DD) na Bahia (UTC−3, sem horário de verão) de um instante ISO. */
export function diaBahia(iso: string): string {
  return new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(0, 10)
}

export function estadoInicial(): EstadoFrentes {
  return {
    recente: { cursor: null, coberto_ate: null, concluido_em: null, desde: null },
    backfill: { cursor: null, proximo_fim: null, coberto_desde: null, concluido: false },
    revisao: { cursor: null, ate: null, concluido_em: null },
  }
}

function lerCursor(c: unknown): Cursor | null {
  if (!c || typeof c !== 'object') return null
  const x = c as Record<string, unknown>
  if (typeof x.ini !== 'string' || typeof x.fim !== 'string') return null
  const out: Cursor = { ini: x.ini, fim: x.fim, local: x.local == null ? null : Number(x.local), pagina: Math.max(1, Number(x.pagina) || 1) }
  if (typeof x.iniciado_em === 'string') out.iniciado_em = x.iniciado_em
  if (typeof x.avancado_em === 'string') out.avancado_em = x.avancado_em
  return out
}
const texto = (v: unknown) => (typeof v === 'string' ? v : null)

/** Estado gravado (jsonb) → estado completo; tolera vazio, nulo e versões sem alguma chave. */
export function lerEstado(bruto: unknown): EstadoFrentes {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, Record<string, unknown> | undefined>
  const r = b.recente ?? {}, k = b.backfill ?? {}, v = b.revisao ?? {}
  const out: EstadoFrentes = {
    recente: { cursor: lerCursor(r.cursor), coberto_ate: texto(r.coberto_ate), concluido_em: texto(r.concluido_em), desde: texto(r.desde) },
    backfill: { cursor: lerCursor(k.cursor), proximo_fim: texto(k.proximo_fim), coberto_desde: texto(k.coberto_desde), concluido: k.concluido === true },
    revisao: { cursor: lerCursor(v.cursor), ate: texto(v.ate), concluido_em: texto(v.concluido_em) },
  }
  const bb = b as Record<string, unknown>
  if (typeof bb.conferido_ate === 'string') out.conferido_ate = bb.conferido_ate
  if (b.ativos && typeof b.ativos === 'object') {
    const ativos: Record<string, string> = {}
    for (const [l, d] of Object.entries(b.ativos)) if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) ativos[l] = d
    out.ativos = ativos
  }
  return out
}

/** Locais que a frente percorre: recente com `locaisRecenteDias` = só os com movimento desde `ref - N`; senão todos. */
export function locaisDaFrente(
  e: EstadoFrentes, cfg: ConfigFrentes, frente: Frente, locais: (number | null)[], ref: string
): (number | null)[] {
  if (frente !== 'recente' || !cfg.locaisRecenteDias || !e.ativos || locais.some((l) => l == null)) return locais
  const corte = addDias(ref, -cfg.locaisRecenteDias)
  const comMov = locais.filter((l) => (e.ativos?.[String(l)] ?? '') >= corte)
  return comMov.length ? comMov : locais
}

/**
 * Último dia conferido: `conferido_ate` gravado; estado antigo (antes de 20/10) = dia da última revisão concluída
 * − diasRecentes (a janela dela ia até ali); sem revisão = véspera do início da frente recente (o que veio antes foi
 * lido pelo backfill, dias depois). Nunca passa de `recente.coberto_ate`.
 */
export function conferidoAte(e: EstadoFrentes, diasRecentes = 2): string | null {
  let c: string | null = e.conferido_ate ?? null
  if (c == null && e.revisao.concluido_em) c = addDias(diaBahia(e.revisao.concluido_em), -diasRecentes)
  if (c == null && e.recente.desde) c = addDias(e.recente.desde, -1)
  if (c != null && e.recente.coberto_ate && c > e.recente.coberto_ate) c = e.recente.coberto_ate
  return c
}

/** Janela [ini, fim] lida inteira a partir de `iniciadoEm`: avança `conferido_ate` se é contígua a ele. */
function conferir(e: EstadoFrentes, cfg: ConfigFrentes, ini: string, fim: string, iniciadoEm: string): string | null {
  const base = conferidoAte(e, cfg.diasRecentes)
  const lim = menor(fim, addDias(diaBahia(iniciadoEm), -2))
  if (base == null || ini > addDias(base, 1)) return base
  return maior(base, lim)
}

/** Registra que o local teve movimento na data (a maior vista); a frente recente passa a lê-lo. */
export function marcarLocalComMovimento(e: EstadoFrentes, local: number | null, data: string | null): EstadoFrentes {
  if (local == null || !data) return e
  const atual = e.ativos?.[String(local)]
  if (atual && atual >= data) return e
  return { ...e, ativos: { ...(e.ativos ?? {}), [String(local)]: data } }
}

function ordenar(locais: (number | null)[]): (number | null)[] {
  if (locais.some((l) => l == null)) return [null]
  return [...new Set(locais as number[])].sort((a, b) => a - b)
}

/** Próxima página a ler (abre janela nova quando é a vez), ou null se não há nada a fazer agora. */
export function proximaLeitura(
  e: EstadoFrentes, cfg: ConfigFrentes, hoje: string, agoraMs: number, locais: (number | null)[]
): { frente: Frente; cursor: Cursor; estado: EstadoFrentes } | null {
  const ord = ordenar(locais)
  if (!ord.length) return null
  const iniciado_em = new Date(agoraMs).toISOString()
  const ordRecente = ordenar(locaisDaFrente(e, cfg, 'recente', locais, hoje))
  // Cursor parado (cron pausado/flag desligada no meio da janela): relê a janela desde a página 1.
  const velho = (c: Cursor) => {
    const ultimo = c.avancado_em ?? c.iniciado_em
    return !!ultimo && agoraMs - Date.parse(ultimo) > (cfg.cursorMaxHoras ?? 12) * 3_600_000
  }
  const reabrir = (c: Cursor, f: Frente): Cursor => ({ ini: c.ini, fim: c.fim, local: (f === 'recente' ? ordRecente : ord)[0], pagina: 1, iniciado_em })
  const r = e.recente
  if (r.cursor) {
    if (!velho(r.cursor)) return { frente: 'recente', cursor: r.cursor, estado: e }
    const cursor = reabrir(r.cursor, 'recente')
    return { frente: 'recente', cursor, estado: { ...e, recente: { ...r, cursor } } }
  }
  const atrasado = r.coberto_ate == null || r.coberto_ate < hoje
  const venceu = r.concluido_em == null || agoraMs - Date.parse(r.concluido_em) >= cfg.intervaloRecenteMin * 60_000
  if (atrasado || venceu) {
    const padrao = addDias(hoje, -(cfg.diasRecentes - 1))
    let ini = r.coberto_ate ? menor(padrao, r.coberto_ate) : padrao
    // Retomada depois de parada longa: relê desde o último dia conferido (o que foi lido "no dia" pode ter mudado).
    const parada = !!r.concluido_em && agoraMs - Date.parse(r.concluido_em) > (cfg.retomadaHoras ?? 12) * 3_600_000
    const conf = conferidoAte(e, cfg.diasRecentes)
    if (parada && conf && cfg.diasRevisao) {
      const desdeConf = maior(maior(addDias(conf, 1), addDias(hoje, -cfg.diasRevisao)), cfg.limite)
      ini = menor(ini, desdeConf)
    }
    const cursor: Cursor = { ini, fim: menor(hoje, addDias(ini, cfg.janelaMaxDias - 1)), local: ordRecente[0], pagina: 1, iniciado_em }
    return { frente: 'recente', cursor, estado: { ...e, recente: { ...r, cursor } } }
  }
  const v = e.revisao
  if (v.cursor) {
    if (!velho(v.cursor)) return { frente: 'revisao', cursor: v.cursor, estado: e }
    const cursor = reabrir(v.cursor, 'revisao')
    return { frente: 'revisao', cursor, estado: { ...e, revisao: { ...v, cursor } } }
  }
  const desde = historicoDesde(e)
  const venceuRevisao = v.concluido_em == null || agoraMs - Date.parse(v.concluido_em) >= (cfg.intervaloRevisaoHoras ?? 24) * 3_600_000
  if (cfg.diasRevisao && r.coberto_ate && desde && venceuRevisao) {
    const ini = maior(maior(addDias(hoje, -cfg.diasRevisao), cfg.limite), desde)
    const ate = addDias(hoje, -cfg.diasRecentes)
    if (ini <= ate) {
      const cursor: Cursor = { ini, fim: menor(ate, addDias(ini, cfg.janelaMaxDias - 1)), local: ord[0], pagina: 1, iniciado_em }
      return { frente: 'revisao', cursor, estado: { ...e, revisao: { ...v, cursor, ate } } }
    }
  }
  const k = e.backfill
  if (k.concluido) return null
  if (k.cursor) {
    if (!velho(k.cursor)) return { frente: 'backfill', cursor: k.cursor, estado: e }
    const cursor = reabrir(k.cursor, 'backfill')
    return { frente: 'backfill', cursor, estado: { ...e, backfill: { ...k, cursor } } }
  }
  if (k.proximo_fim == null || k.proximo_fim < cfg.limite) return null
  const cursor: Cursor = {
    ini: maior(addDias(k.proximo_fim, -(cfg.janelaMaxDias - 1)), cfg.limite), fim: k.proximo_fim, local: ord[0], pagina: 1, iniciado_em,
  }
  return { frente: 'backfill', cursor, estado: { ...e, backfill: { ...k, cursor } } }
}

/** Avança o cursor depois de gravar a página lida (`totalPaginas` 0 = local sem movimento na janela). */
export function aposLeitura(
  e: EstadoFrentes, frente: Frente, totalPaginas: number, locais: (number | null)[], cfg: ConfigFrentes, agoraISO: string
): EstadoFrentes {
  const cursor = e[frente].cursor
  if (!cursor) return e
  let prox: Cursor | null = null
  if (cursor.pagina < totalPaginas) prox = { ...cursor, pagina: cursor.pagina + 1, avancado_em: agoraISO }
  else if (cursor.local != null) {
    const seguinte = ordenar(locaisDaFrente(e, cfg, frente, locais, cursor.fim)).find((l) => l != null && l > (cursor.local as number))
    if (seguinte != null) prox = { ...cursor, local: seguinte, pagina: 1, avancado_em: agoraISO }
  }
  if (prox) return { ...e, [frente]: { ...e[frente], cursor: prox } }

  if (frente === 'revisao') {
    const ate = e.revisao.ate ?? cursor.fim
    if (cursor.fim < ate) {
      const ini = addDias(cursor.fim, 1)
      const ord = ordenar(locais)
      const seguinte: Cursor = { ini, fim: menor(ate, addDias(ini, cfg.janelaMaxDias - 1)), local: ord[0] ?? null, pagina: 1, iniciado_em: agoraISO }
      return { ...e, revisao: { ...e.revisao, cursor: seguinte }, conferido_ate: conferir(e, cfg, cursor.ini, cursor.fim, cursor.iniciado_em ?? agoraISO) }
    }
    return { ...e, revisao: { cursor: null, ate: null, concluido_em: agoraISO }, conferido_ate: conferir(e, cfg, cursor.ini, cursor.fim, cursor.iniciado_em ?? agoraISO) }
  }

  if (frente === 'recente') {
    const k = { ...e.backfill }
    if (k.proximo_fim == null && !k.concluido) {
      k.proximo_fim = addDias(cursor.ini, -1)
      if (k.proximo_fim < cfg.limite) k.concluido = true
    }
    const comDesde = { ...e, recente: { ...e.recente, desde: e.recente.desde ?? cursor.ini } }
    return {
      ...e,
      recente: { cursor: null, coberto_ate: cursor.fim, concluido_em: agoraISO, desde: e.recente.desde ?? cursor.ini },
      backfill: k,
      conferido_ate: conferir(comDesde, cfg, cursor.ini, cursor.fim, cursor.iniciado_em ?? agoraISO),
    }
  }
  return {
    ...e,
    backfill: { cursor: null, proximo_fim: addDias(cursor.ini, -1), coberto_desde: cursor.ini, concluido: cursor.ini <= cfg.limite },
  }
}

/** Desde quando o histórico está completo (a tela mostra "histórico disponível desde dd/mm"). */
export function historicoDesde(e: EstadoFrentes): string | null {
  return e.backfill.coberto_desde ?? e.recente.desde
}

/** A janela de `antes` terminou (todas as páginas de todos os locais) com esta leitura. */
export function janelaFechada(frente: Frente, antes: Cursor, depois: EstadoFrentes): boolean {
  const c = depois[frente].cursor
  return !c || c.ini !== antes.ini || c.fim !== antes.fim
}

// ---- Cobertura do kardex para os relatórios (D5, 20/10/2026) ----------------------------------------------------
export type CoberturaKardex = {
  /** Início do histórico completo. */
  desde: string
  /** Fim que o relatório pode usar: espelho ligado = o lido; desligado = só o conferido (nada vai reler o resto). */
  ate: string
  lidoAte: string
  conferidoAte: string | null
  ligado: boolean
}

export function coberturaDoEstado(e: EstadoFrentes, ligado: boolean, diasRecentes = 2): CoberturaKardex | null {
  const desde = historicoDesde(e)
  const lidoAte = e.recente.coberto_ate
  if (!desde || !lidoAte) return null
  const conf = conferidoAte(e, diasRecentes)
  const ate = ligado ? lidoAte : conf
  if (!ate || desde > ate) return null
  return { desde, ate, lidoAte, conferidoAte: conf, ligado }
}

const br = (iso: string) => iso.split('-').reverse().join('/')

/**
 * Aviso para relatório que usa o kardex do Omie até `fim` (null = nada a avisar). Diz por que o kardex não chega lá
 * (espelho desligado, leitura parada) ou que o trecho final ainda não foi relido (pode faltar lançamento com data
 * retroativa: reprocessamento do PDV, OP concluída depois).
 */
export function avisoCoberturaKardex(c: CoberturaKardex | null, fim: string): string | null {
  if (!c) return null
  if (fim > c.ate) {
    if (!c.ligado) {
      return `O espelho do kardex do Omie está desligado nesta loja: o kardex conferido vai só até ${br(c.ate)}`
        + (c.lidoAte > c.ate ? ` (de ${br(addDias(c.ate, 1))} a ${br(c.lidoAte)} foi lido incompleto e não é usado).` : '.')
    }
    return `O kardex do Omie desta loja está lido só até ${br(c.ate)} (leitura atrasada ou pausada pela proteção contra bloqueio do Omie).`
  }
  if (c.conferidoAte && fim > c.conferidoAte) {
    return `De ${br(addDias(c.conferidoAte, 1))} a ${br(fim)} o kardex foi lido mas ainda não foi relido pela revisão diária: lançamentos feitos depois com data desses dias (reprocessamento do PDV, OP concluída com data antiga) podem faltar.`
  }
  return null
}
