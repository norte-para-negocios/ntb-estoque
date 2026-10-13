// Motor das "frentes" de leitura paginada do Omie por janela de data ("nosso Omie", Fase 1).
// Duas frentes com cursor persistido (espelho_sync_estado.estado):
//  - recente: relê [hoje - (diasRecentes-1), hoje] a cada `intervaloRecenteMin`; se o cron ficou parado,
//    recomeça de `coberto_ate` e anda em janelas de até `janelaMaxDias` (sem esperar o intervalo) até alcançar hoje;
//  - revisao (opcional, `diasRevisao`): 1x a cada `intervaloRevisaoHoras` relê os últimos `diasRevisao` dias já
//    cobertos fora da janela recente (movimento lançado hoje com data antiga; saldo/CMC recalculado pelo Omie);
//  - backfill: depois da 1ª passada recente, desce janela a janela (até `janelaMaxDias`) até `limite`.
// Prioridade: recente > revisao > backfill.
// Dentro da janela, percorre os locais (ordem crescente de código; `null` = recurso sem local) e as páginas.
// Puro, sem imports: node --test lib/estoque/espelho-frentes.test.ts.

export type Cursor = { ini: string; fim: string; local: number | null; pagina: number; iniciado_em?: string }
export type EstadoFrentes = {
  recente: { cursor: Cursor | null; coberto_ate: string | null; concluido_em: string | null; desde: string | null }
  backfill: { cursor: Cursor | null; proximo_fim: string | null; coberto_desde: string | null; concluido: boolean }
  revisao: { cursor: Cursor | null; ate: string | null; concluido_em: string | null }
}
export type ConfigFrentes = {
  diasRecentes: number; janelaMaxDias: number; limite: string; intervaloRecenteMin: number
  diasRevisao?: number; intervaloRevisaoHoras?: number
}
export type Frente = 'recente' | 'backfill' | 'revisao'

function addDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const menor = (a: string, b: string) => (a < b ? a : b)
const maior = (a: string, b: string) => (a > b ? a : b)

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
  return out
}
const texto = (v: unknown) => (typeof v === 'string' ? v : null)

/** Estado gravado (jsonb) → estado completo; tolera vazio, nulo e versões sem alguma chave. */
export function lerEstado(bruto: unknown): EstadoFrentes {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, Record<string, unknown> | undefined>
  const r = b.recente ?? {}, k = b.backfill ?? {}, v = b.revisao ?? {}
  return {
    recente: { cursor: lerCursor(r.cursor), coberto_ate: texto(r.coberto_ate), concluido_em: texto(r.concluido_em), desde: texto(r.desde) },
    backfill: { cursor: lerCursor(k.cursor), proximo_fim: texto(k.proximo_fim), coberto_desde: texto(k.coberto_desde), concluido: k.concluido === true },
    revisao: { cursor: lerCursor(v.cursor), ate: texto(v.ate), concluido_em: texto(v.concluido_em) },
  }
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
  const r = e.recente
  if (r.cursor) return { frente: 'recente', cursor: r.cursor, estado: e }
  const atrasado = r.coberto_ate == null || r.coberto_ate < hoje
  const venceu = r.concluido_em == null || agoraMs - Date.parse(r.concluido_em) >= cfg.intervaloRecenteMin * 60_000
  if (atrasado || venceu) {
    const padrao = addDias(hoje, -(cfg.diasRecentes - 1))
    const ini = r.coberto_ate ? menor(padrao, r.coberto_ate) : padrao
    const cursor: Cursor = { ini, fim: menor(hoje, addDias(ini, cfg.janelaMaxDias - 1)), local: ord[0], pagina: 1, iniciado_em }
    return { frente: 'recente', cursor, estado: { ...e, recente: { ...r, cursor } } }
  }
  const v = e.revisao
  if (v.cursor) return { frente: 'revisao', cursor: v.cursor, estado: e }
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
  if (k.cursor) return { frente: 'backfill', cursor: k.cursor, estado: e }
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
  if (cursor.pagina < totalPaginas) prox = { ...cursor, pagina: cursor.pagina + 1 }
  else if (cursor.local != null) {
    const seguinte = ordenar(locais).find((l) => l != null && l > (cursor.local as number))
    if (seguinte != null) prox = { ...cursor, local: seguinte, pagina: 1 }
  }
  if (prox) return { ...e, [frente]: { ...e[frente], cursor: prox } }

  if (frente === 'revisao') {
    const ate = e.revisao.ate ?? cursor.fim
    if (cursor.fim < ate) {
      const ini = addDias(cursor.fim, 1)
      const ord = ordenar(locais)
      const seguinte: Cursor = { ini, fim: menor(ate, addDias(ini, cfg.janelaMaxDias - 1)), local: ord[0] ?? null, pagina: 1, iniciado_em: agoraISO }
      return { ...e, revisao: { ...e.revisao, cursor: seguinte } }
    }
    return { ...e, revisao: { cursor: null, ate: null, concluido_em: agoraISO } }
  }

  if (frente === 'recente') {
    const k = { ...e.backfill }
    if (k.proximo_fim == null && !k.concluido) {
      k.proximo_fim = addDias(cursor.ini, -1)
      if (k.proximo_fim < cfg.limite) k.concluido = true
    }
    return {
      ...e,
      recente: { cursor: null, coberto_ate: cursor.fim, concluido_em: agoraISO, desde: e.recente.desde ?? cursor.ini },
      backfill: k,
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
