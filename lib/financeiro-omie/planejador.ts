// Financeiro A0: planejador PURO da carga/conferência pela API do Omie, por loja (cursor em espelho_sync_estado,
// frente 'financeiro'). Cada ciclo do cron pede a próxima ação, executa (1 chamada ao Omie, ou só banco) e grava o
// estado. Ordem de prioridade:
//   1. cadastros vencidos: categorias (24 h, paginado), DRE (24 h), contas correntes (12 h; ao terminar enfileira os saldos);
//   2. títulos "recentes" (ListarMovimentos CPCR por data de ALTERAÇÃO, ontem+hoje, a cada `intervaloRecenteMin`);
//   3. baixas "recentes" (ListarMovimentos BX por data de alteração, idem);
//   4. depois de uma varredura de abertos completa: buscar no banco os abertos que não apareceram (sem chamada) e
//      conferi-los um a um (ListarMovimentos nCodTitulo; até `maxConferirPorCiclo`);
//   5. saldos das contas (ListarExtrato só saldo, 1 conta por chamada);
//   6. varredura de abertos (ListarMovimentos CPCR cStatus EMABERTO, todas as páginas, a cada 24 h): pega os
//      abertos antigos (antes de 01/07) e corrige status/valor em aberto que mudou sem aviso;
//   7. backfill dos títulos e depois das baixas: janelas de alteração descendo até 2026-07-01.
// O motor de janelas é o do kardex (lib/estoque/espelho-frentes.ts), com um "local" só (null) e sem revisão: pela data
// de alteração todo título mexido cai na janela de hoje, então não há lançamento retroativo a reler.
// Sem imports além de arquivos puros: node --test lib/financeiro-omie/planejador.test.ts.
// @ts-expect-error: o import com extensão .ts é exigido pelo node --test (type stripping); o tsc do Next não o aceita
import { aposFalha, aposLeitura, estadoInicial, lerEstado, proximaLeitura, type ConfigFrentes, type Cursor, type EstadoFrentes, type Frente } from '../estoque/espelho-frentes.ts'

export const CFG_FIN: ConfigFrentes = { diasRecentes: 2, janelaMaxDias: 15, limite: '2026-07-01', intervaloRecenteMin: 180 }
export const LOCAIS_FIN: (number | null)[] = [null]

export const INTERVALO_CATEGORIAS_H = 24
export const INTERVALO_DRE_H = 24
export const INTERVALO_CONTAS_H = 12
export const INTERVALO_ABERTOS_H = 24
/** Varredura de abertos parada no meio há mais que isso recomeça da página 1 (as páginas são por posição). */
export const ABERTOS_MAX_H = 12
export const MAX_PENDENTES_CONFERIR = 300
export const MAX_CONFERIR_POR_CICLO = 5

export type Pendente = { c: number; n: 'P' | 'R' }
export type EstadoFin = {
  titulos: EstadoFrentes
  baixas: EstadoFrentes
  cadastros: {
    categorias_pagina: number | null; categorias_iniciado_em: string | null; categorias_em: string | null
    dre_em: string | null
    contas_pagina: number | null; contas_iniciado_em: string | null; contas_em: string | null
  }
  abertos: {
    pagina: number | null; iniciado_em: string | null; avancado_em: string | null; concluido_em: string | null
    /** Varredura completa terminou e ainda falta buscar no banco os que não apareceram nela. */
    buscar_sumidos_desde: string | null
  }
  conferir: { pendentes: Pendente[] }
  saldos: { pendentes: number[]; iniciado_em: string | null }
}

export type Acao =
  | { tipo: 'categorias'; pagina: number }
  | { tipo: 'dre' }
  | { tipo: 'contas'; pagina: number }
  | { tipo: 'titulos' | 'baixas'; frente: Frente; cursor: Cursor; estado: EstadoFrentes }
  | { tipo: 'buscar-sumidos'; desde: string }
  | { tipo: 'conferir'; pendente: Pendente }
  | { tipo: 'saldo'; conta: number }
  | { tipo: 'abertos'; pagina: number; iniciado_em: string }

/** Ação que chama o Omie (todas menos buscar-sumidos, que só lê o banco). */
export const chamaOmie = (a: Acao) => a.tipo !== 'buscar-sumidos'

const texto = (v: unknown) => (typeof v === 'string' ? v : null)
const pag = (v: unknown) => (Number.isInteger(v) && (v as number) >= 1 ? (v as number) : null)
const o = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

export function estadoFinInicial(): EstadoFin {
  return {
    titulos: estadoInicial(), baixas: estadoInicial(),
    cadastros: { categorias_pagina: null, categorias_iniciado_em: null, categorias_em: null, dre_em: null, contas_pagina: null, contas_iniciado_em: null, contas_em: null },
    abertos: { pagina: null, iniciado_em: null, avancado_em: null, concluido_em: null, buscar_sumidos_desde: null },
    conferir: { pendentes: [] },
    saldos: { pendentes: [], iniciado_em: null },
  }
}

/** Estado gravado (jsonb) → estado completo; tolera vazio e versões antigas. */
export function lerEstadoFin(bruto: unknown): EstadoFin {
  const b = o(bruto), c = o(b.cadastros), a = o(b.abertos), f = o(b.conferir), s = o(b.saldos)
  const pend = Array.isArray(f.pendentes) ? (f.pendentes as unknown[]).map(o)
    .filter((p) => Number.isSafeInteger(p.c) && (p.c as number) > 0 && (p.n === 'P' || p.n === 'R'))
    .map((p) => ({ c: p.c as number, n: p.n as 'P' | 'R' })) : []
  return {
    titulos: lerEstado(b.titulos), baixas: lerEstado(b.baixas),
    cadastros: {
      categorias_pagina: pag(c.categorias_pagina), categorias_iniciado_em: texto(c.categorias_iniciado_em), categorias_em: texto(c.categorias_em),
      dre_em: texto(c.dre_em),
      contas_pagina: pag(c.contas_pagina), contas_iniciado_em: texto(c.contas_iniciado_em), contas_em: texto(c.contas_em),
    },
    abertos: {
      pagina: pag(a.pagina), iniciado_em: texto(a.iniciado_em), avancado_em: texto(a.avancado_em), concluido_em: texto(a.concluido_em),
      buscar_sumidos_desde: texto(a.buscar_sumidos_desde),
    },
    conferir: { pendentes: pend.slice(0, MAX_PENDENTES_CONFERIR) },
    saldos: {
      pendentes: Array.isArray(s.pendentes) ? (s.pendentes as unknown[]).filter((n): n is number => Number.isSafeInteger(n) && (n as number) > 0) : [],
      iniciado_em: texto(s.iniciado_em),
    },
  }
}

const venceu = (em: string | null, horas: number, agoraMs: number) => em == null || agoraMs - Date.parse(em) >= horas * 3_600_000

export type ContadoresCiclo = { conferidos: number }

/** Próxima ação para a loja (null = nada a fazer agora). Não muda o estado: quem muda é o apos* da ação. */
export function proximaAcao(e: EstadoFin, hoje: string, agoraMs: number, ciclo: ContadoresCiclo = { conferidos: 0 }): Acao | null {
  const agoraISO = new Date(agoraMs).toISOString()
  const c = e.cadastros
  if (c.categorias_pagina != null || venceu(c.categorias_em, INTERVALO_CATEGORIAS_H, agoraMs)) return { tipo: 'categorias', pagina: c.categorias_pagina ?? 1 }
  if (venceu(c.dre_em, INTERVALO_DRE_H, agoraMs)) return { tipo: 'dre' }
  if (c.contas_pagina != null || venceu(c.contas_em, INTERVALO_CONTAS_H, agoraMs)) return { tipo: 'contas', pagina: c.contas_pagina ?? 1 }

  const t = proximaLeitura(e.titulos, CFG_FIN, hoje, agoraMs, LOCAIS_FIN)
  if (t && t.frente === 'recente') return { tipo: 'titulos', ...t }
  const b = proximaLeitura(e.baixas, CFG_FIN, hoje, agoraMs, LOCAIS_FIN)
  if (b && b.frente === 'recente') return { tipo: 'baixas', ...b }

  if (e.abertos.buscar_sumidos_desde) return { tipo: 'buscar-sumidos', desde: e.abertos.buscar_sumidos_desde }
  if (e.conferir.pendentes.length && ciclo.conferidos < MAX_CONFERIR_POR_CICLO) return { tipo: 'conferir', pendente: e.conferir.pendentes[0] }
  if (e.saldos.pendentes.length) return { tipo: 'saldo', conta: e.saldos.pendentes[0] }

  const a = e.abertos
  const parada = a.pagina != null && !!(a.avancado_em ?? a.iniciado_em) && agoraMs - Date.parse((a.avancado_em ?? a.iniciado_em) as string) > ABERTOS_MAX_H * 3_600_000
  if (a.pagina != null && a.iniciado_em && !parada) return { tipo: 'abertos', pagina: a.pagina, iniciado_em: a.iniciado_em }
  if (parada || venceu(a.concluido_em, INTERVALO_ABERTOS_H, agoraMs)) return { tipo: 'abertos', pagina: 1, iniciado_em: agoraISO }

  if (t) return { tipo: 'titulos', ...t }
  if (b) return { tipo: 'baixas', ...b }
  return null
}

/** Total de páginas de uma resposta paginada (0 = vazia). */
const proxPagina = (pagina: number, total: number): number | null => (pagina < total ? pagina + 1 : null)

/** Estado depois de executar a ação com sucesso. `total` = total de páginas da resposta; `contas` = contas ativas lidas. */
export function aposAcao(
  e: EstadoFin, a: Acao, agoraISO: string,
  r: { total?: number; contasAtivas?: number[]; sumidos?: Pendente[] } = {},
): EstadoFin {
  const total = Math.max(0, Math.floor(r.total ?? 0))
  switch (a.tipo) {
    case 'categorias': {
      const prox = proxPagina(a.pagina, total)
      return { ...e, cadastros: { ...e.cadastros, categorias_pagina: prox, categorias_iniciado_em: prox ? e.cadastros.categorias_iniciado_em ?? agoraISO : null, categorias_em: prox ? e.cadastros.categorias_em : agoraISO } }
    }
    case 'dre':
      return { ...e, cadastros: { ...e.cadastros, dre_em: agoraISO } }
    case 'contas': {
      const prox = proxPagina(a.pagina, total)
      const saldos = r.contasAtivas ? [...new Set([...e.saldos.pendentes, ...r.contasAtivas])] : e.saldos.pendentes
      return {
        ...e,
        cadastros: { ...e.cadastros, contas_pagina: prox, contas_iniciado_em: prox ? e.cadastros.contas_iniciado_em ?? agoraISO : null, contas_em: prox ? e.cadastros.contas_em : agoraISO },
        saldos: { pendentes: saldos, iniciado_em: e.saldos.iniciado_em ?? agoraISO },
      }
    }
    case 'titulos':
    case 'baixas':
      return { ...e, [a.tipo]: aposLeitura(a.estado, a.frente, total, LOCAIS_FIN, CFG_FIN, agoraISO) }
    case 'buscar-sumidos': {
      const ja = new Set(e.conferir.pendentes.map((p) => p.c))
      const novos = (r.sumidos ?? []).filter((p) => !ja.has(p.c))
      return { ...e, abertos: { ...e.abertos, buscar_sumidos_desde: null }, conferir: { pendentes: [...e.conferir.pendentes, ...novos].slice(0, MAX_PENDENTES_CONFERIR) } }
    }
    case 'conferir':
      return { ...e, conferir: { pendentes: e.conferir.pendentes.filter((p) => p.c !== a.pendente.c) } }
    case 'saldo': {
      const pendentes = e.saldos.pendentes.filter((c) => c !== a.conta)
      return { ...e, saldos: { pendentes, iniciado_em: pendentes.length ? e.saldos.iniciado_em : null } }
    }
    case 'abertos': {
      const prox = proxPagina(a.pagina, total)
      if (prox) return { ...e, abertos: { ...e.abertos, pagina: prox, iniciado_em: a.iniciado_em, avancado_em: agoraISO } }
      // Varredura completa: agora dá para saber quem sumiu dos abertos (pago/excluído sem aviso).
      return { ...e, abertos: { pagina: null, iniciado_em: null, avancado_em: null, concluido_em: agoraISO, buscar_sumidos_desde: a.iniciado_em } }
    }
  }
}

/**
 * Erro do Omie (que não é de limite) na ação: não fica repetindo o mesmo item. Janela do motor: conta a falha (3ª
 * seguida pula a página). Conferir/saldo: tira o item da fila (volta na próxima varredura). Página de cadastro ou de
 * abertos: fica na mesma página (a guarda do ciclo espera cada vez mais antes de tentar de novo, com teto).
 */
export function aposErro(e: EstadoFin, a: Acao, erro: string, agoraISO: string, transitorio: boolean): EstadoFin {
  if (a.tipo === 'titulos' || a.tipo === 'baixas') return { ...e, [a.tipo]: aposFalha(a.estado, a.frente, erro, agoraISO, { transitorio }) }
  if (transitorio) return e
  if (a.tipo === 'conferir' || a.tipo === 'saldo') return aposAcao(e, a, agoraISO)
  return e
}

/** Resumo para a tela/log: até onde o histórico está lido. */
export function coberturaFin(e: EstadoFin): { titulosDesde: string | null; baixasDesde: string | null; lidoAte: string | null; abertosEm: string | null } {
  const desde = (x: EstadoFrentes) => x.backfill.coberto_desde ?? x.recente.desde
  const ate = [e.titulos.recente.coberto_ate, e.baixas.recente.coberto_ate].filter((x): x is string => !!x).sort()[0] ?? null
  return { titulosDesde: desde(e.titulos), baixasDesde: desde(e.baixas), lidoAte: ate, abertosEm: e.abertos.concluido_em }
}
