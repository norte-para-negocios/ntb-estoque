// OPs abertas do Omie ("nosso Omie" Fase 1, cron sync-ops-abertas): regras puras.
// Sem imports: node --test lib/estoque/ops-abertas-puro.test.ts.

export type OrigemOP = 'vendas' | 'app' | 'script' | 'cupom' | 'manual'

export type OPOmieLista = {
  identificacao: {
    nCodOP: number; cCodIntOP?: string; cNumOP?: string; nCodProduto?: number; dDtPrevisao?: string
    nQtde?: number; codigo_local_estoque?: number
  }
  observacoes?: { cObs?: string }
  outrasInf?: { cConcluida?: string; dInclusao?: string; dAlteracao?: string; uInc?: string; uAlt?: string }
}

/**
 * Quem criou a OP: Norte Vendas (NTBV…), este app (NTB-…), script (OP-/FPI-/SEED-/CORTE-/FAX-),
 * cupom do PDV (obs "Cupom N" ou incluída pelo usuário WEBSERVICE) ou manual (tela do Omie).
 */
export function origemDaOP(o: { cCodIntOP?: string | null; cObs?: string | null; uInc?: string | null }): OrigemOP {
  const cod = (o.cCodIntOP ?? '').trim()
  if (/^NTBV/i.test(cod)) return 'vendas'
  if (/^NTB-/i.test(cod)) return 'app'
  if (/^(OP|FPI|SEED|CORTE|FAX)-/i.test(cod)) return 'script'
  if (/^\s*Cupom \d+/i.test(o.cObs ?? '') || /^WEBSERVICE$/i.test((o.uInc ?? '').trim())) return 'cupom'
  return 'manual'
}

function dataBr(v: string | undefined | null): string | null {
  const m = (v ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}
const textoOuNull = (v: string | undefined | null) => (v && v.trim() ? v.trim() : null)

export type LinhaOPAberta = {
  loja_id: number; num_ordem: string | null; identificacao_n_cod_op: number; identificacao_c_cod_int_op: string | null
  identificacao_c_num_op: string | null; identificacao_n_cod_produto: number | null; identificacao_d_dt_previsao: string | null
  identificacao_n_qtde: number | null; identificacao_codigo_local_estoque: number | null; dt_inclusao: string | null
  dt_ultima_alteracao_omie: string | null; alterado_por_omie: string | null; incluido_por_omie: string | null
  obs_omie: string | null; origem_op: OrigemOP; aberta_omie: true
}

/** Colunas que o cron grava numa OP aberta (nunca `concluida`, `observacao` nem campos de conclusão do app). */
export function linhaOPAberta(op: OPOmieLista, lojaId: number): LinhaOPAberta {
  const id = op.identificacao, o = op.outrasInf ?? {}
  const cObs = op.observacoes?.cObs ?? null
  return {
    loja_id: lojaId,
    num_ordem: textoOuNull(id.cNumOP),
    identificacao_n_cod_op: Number(id.nCodOP),
    identificacao_c_cod_int_op: textoOuNull(id.cCodIntOP)?.slice(0, 20) ?? null,
    identificacao_c_num_op: textoOuNull(id.cNumOP)?.slice(0, 15) ?? null,
    identificacao_n_cod_produto: id.nCodProduto ? Number(id.nCodProduto) : null,
    identificacao_d_dt_previsao: dataBr(id.dDtPrevisao),
    identificacao_n_qtde: id.nQtde == null ? null : Number(id.nQtde),
    identificacao_codigo_local_estoque: id.codigo_local_estoque ? Number(id.codigo_local_estoque) : null,
    dt_inclusao: dataBr(o.dInclusao),
    dt_ultima_alteracao_omie: dataBr(o.dAlteracao),
    alterado_por_omie: textoOuNull(o.uAlt),
    incluido_por_omie: textoOuNull(o.uInc),
    obs_omie: textoOuNull(cObs),
    origem_op: origemDaOP({ cCodIntOP: id.cCodIntOP, cObs, uInc: o.uInc }),
    aberta_omie: true,
  }
}

function igual(a: unknown, b: unknown): boolean {
  if ((a ?? null) === null || (b ?? null) === null) return (a ?? null) === (b ?? null)
  const na = Number(a), nb = Number(b)
  if (typeof a !== 'boolean' && typeof b !== 'boolean' && a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na === nb
  return String(a) === String(b)
}

/** Só regrava a OP se alguma coluna do cron mudou (ordens_producao tem gatilho da outbox do desktop). */
export function opMudou(existente: Record<string, unknown>, nova: LinhaOPAberta): boolean {
  return (Object.keys(nova) as (keyof LinhaOPAberta)[]).some((k) => k !== 'loja_id' && !igual(existente[k], nova[k]))
}

/**
 * OPs locais (ainda tidas como abertas) que não vieram na lista de abertas do Omie: concluídas ou excluídas lá.
 * Lista incompleta (falhou no meio) ou vazia com mais de 10 abertas aqui = falha técnica, não marca nada.
 */
export function opsQueSairamDaLista(locaisAbertas: number[], daLista: Set<number>, listaCompleta: boolean): number[] {
  if (!listaCompleta) return []
  if (daLista.size === 0 && locaisAbertas.length > 10) return []
  return locaisAbertas.filter((n) => !daLista.has(n))
}

/** Ficha gravada na OP ainda não lida (ConsultarOrdemProducao → itensDetalhes). */
export function precisaConsultarItens(row: { full_object: unknown; itens_consultados_em: string | null }): boolean {
  if (row.itens_consultados_em) return false
  const itens = (row.full_object as { itensDetalhes?: unknown[] } | null)?.itensDetalhes
  return !(Array.isArray(itens) && itens.length > 0)
}

/**
 * OP local que deve estar na lista de abertas do Omie: a que o cron já viu aberta (mesmo que o sync-ops já tenha
 * marcado a conclusão: senão aberta_omie ficaria true para sempre) e a nunca vista que não está concluída aqui.
 * Mesma regra do filtro PostgREST FILTRO_CANDIDATAS_SAIDA.
 */
export function candidataASair(row: { aberta_omie: boolean | null; concluida: boolean | null }): boolean {
  return row.aberta_omie === true || (row.aberta_omie == null && row.concluida !== true)
}
export const FILTRO_CANDIDATAS_SAIDA = 'aberta_omie.is.true,and(aberta_omie.is.null,concluida.not.is.true)'

/**
 * A lista do Omie pode deslocar entre páginas enquanto é lida (OP concluída no meio da leitura empurra outras para
 * páginas já lidas). Só marca como fora da lista a OP ausente em DUAS leituras completas seguidas.
 */
export function confirmarSaidas(pendentesAnteriores: number[], candidatosAgora: number[]): { marcar: number[]; pendentes: number[] } {
  const antes = new Set(pendentesAnteriores)
  return { marcar: candidatosAgora.filter((n) => antes.has(n)), pendentes: candidatosAgora.filter((n) => !antes.has(n)) }
}
