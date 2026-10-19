// Produção por produto e matéria-prima consumida no período (matriz N17/N18/N20), a partir da RPC relatorio_ops_periodo
// (migration 211), que já devolve uma linha por papel × produto e a série por dia à parte. Custo vem nulo da RPC quando
// alguma OP não tem custo (nunca um total pela metade); aqui o total também fica nulo se faltar em alguma linha.
// Puro, sem imports: node --test lib/relatorios/ops-periodo-puro.test.ts

export type PapelOp = 'produzido' | 'consumido'
export type LinhaOpProduto = { papel: PapelOp; n_cod_prod: number; ops: number; qtde: number; custo: number | null; dias: number }
export type DiaOp = { dia: string; ops: number; qtde: number }
export type MetaOp = { rotulo: string; codigo: string; familia: string; tipo: string; unidade: string }
export type LinhaOp = { chave: string; rotulo: string; codigo: string; familia: string; tipo: string; unidade: string; ops: number; qtde: number; custo: number | null; dias: number }
export type FiltrosOp = { tipos: string[]; familias: string[]; q: string }

const r2 = (n: number) => Math.round(n * 100) / 100
const r6 = (n: number) => Math.round(n * 1e6) / 1e6
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const metaDe = (meta: Map<number, MetaOp>, cod: number): MetaOp =>
  meta.get(cod) ?? { rotulo: `Produto ${cod}`, codigo: String(cod), familia: 'Sem família', tipo: '', unidade: '' }

const passa = (m: MetaOp, f: FiltrosOp, termo: string) =>
  (!f.tipos.length || f.tipos.includes(m.tipo || '_')) && (!f.familias.length || f.familias.includes(m.familia))
  && (!termo || semAcento(`${m.rotulo} ${m.codigo}`).includes(termo))

const temFiltro = (f: FiltrosOp) => f.tipos.length > 0 || f.familias.length > 0 || f.q.trim() !== ''

/** Produtos do cadastro que passam no filtro, para a RPC filtrar no banco (vale para a série por dia); null = sem filtro. */
export function codigosDoFiltro(meta: Map<number, MetaOp>, f: FiltrosOp): number[] | null {
  if (!temFiltro(f)) return null
  const termo = semAcento(f.q.trim())
  return [...meta.entries()].filter(([, m]) => passa(m, f, termo)).map(([c]) => c).sort((a, b) => a - b)
}

/** Linhas cujo produto passa no filtro de tipo, família e busca. */
export function filtrarOps(linhas: LinhaOpProduto[], meta: Map<number, MetaOp>, f: FiltrosOp): LinhaOpProduto[] {
  const termo = semAcento(f.q.trim())
  return linhas.filter((l) => passa(metaDe(meta, Number(l.n_cod_prod)), f, termo))
}

/** Lista do papel pedido, com o cadastro, filtrada; ordem: mais OPs, mais quantidade, nome. */
export function agregarOps(linhas: LinhaOpProduto[], meta: Map<number, MetaOp>, papel: PapelOp, f: FiltrosOp): LinhaOp[] {
  return filtrarOps(linhas, meta, f).filter((l) => l.papel === papel).map((l) => {
    const cod = Number(l.n_cod_prod)
    const m = metaDe(meta, cod)
    return {
      chave: String(cod), rotulo: m.rotulo, codigo: m.codigo, familia: m.familia, tipo: m.tipo, unidade: m.unidade,
      ops: Number(l.ops) || 0, qtde: r6(Number(l.qtde) || 0), custo: l.custo == null ? null : r2(Number(l.custo)), dias: Number(l.dias) || 0,
    }
  }).sort((a, b) => b.ops - a.ops || b.qtde - a.qtde || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}

/** Cartões: OPs (ou movimentos) de produção, produtos produzidos, insumos consumidos e custos (nulo se faltar custo). */
export function resumoOps(linhas: LinhaOpProduto[]): { ops: number; produtos: number; insumos: number; custoProduzido: number | null; custoConsumido: number | null } {
  const soma = (p: PapelOp) => {
    const ls = linhas.filter((l) => l.papel === p)
    return ls.length && ls.every((l) => l.custo != null) ? r2(ls.reduce((s, l) => s + Number(l.custo), 0)) : null
  }
  const prod = linhas.filter((l) => l.papel === 'produzido')
  return {
    ops: prod.reduce((s, l) => s + (Number(l.ops) || 0), 0),
    produtos: new Set(prod.map((l) => Number(l.n_cod_prod))).size,
    insumos: new Set(linhas.filter((l) => l.papel === 'consumido').map((l) => Number(l.n_cod_prod))).size,
    custoProduzido: soma('produzido'),
    custoConsumido: soma('consumido'),
  }
}

const proximoDia = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** OPs e quantidade produzida por dia de `ini` a `fim` (dias sem produção = 0). */
export function serieOps(dias: DiaOp[], ini: string, fim: string): DiaOp[] {
  const m = new Map(dias.map((d) => [String(d.dia).slice(0, 10), d]))
  const out: DiaOp[] = []
  for (let d = ini; d <= fim; d = proximoDia(d)) out.push({ dia: d, ops: Number(m.get(d)?.ops) || 0, qtde: r6(Number(m.get(d)?.qtde) || 0) })
  return out
}
