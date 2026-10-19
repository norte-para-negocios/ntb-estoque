// Produção por produto e matéria-prima consumida no período (matriz N17/N18/N20), a partir da RPC relatorio_ops_periodo
// (migration 211): uma linha por papel × dia × produto. Custo só é somado quando todas as linhas têm custo (loja própria
// ou kardex do Omie); senão fica nulo, nunca um total pela metade.
// Puro, sem imports: node --test lib/relatorios/ops-periodo-puro.test.ts

export type PapelOp = 'produzido' | 'consumido'
export type LinhaOpBruta = { papel: PapelOp; dia: string; n_cod_prod: number; ops: number; qtde: number; custo: number | null }
export type MetaOp = { rotulo: string; codigo: string; familia: string; tipo: string; unidade: string }
export type LinhaOp = { chave: string; rotulo: string; codigo: string; familia: string; tipo: string; unidade: string; ops: number; qtde: number; custo: number | null; dias: number }
export type FiltrosOp = { tipos: string[]; familias: string[]; q: string }

const r2 = (n: number) => Math.round(n * 100) / 100
const r6 = (n: number) => Math.round(n * 1e6) / 1e6
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const metaDe = (meta: Map<number, MetaOp>, cod: number): MetaOp =>
  meta.get(cod) ?? { rotulo: `Produto ${cod}`, codigo: String(cod), familia: 'Sem família', tipo: '', unidade: '' }

/** Linhas cujo produto passa no filtro de tipo, família e busca (vale para os cartões e a série por dia). */
export function filtrarOps(brutas: LinhaOpBruta[], meta: Map<number, MetaOp>, f: FiltrosOp): LinhaOpBruta[] {
  const termo = semAcento(f.q.trim())
  return brutas.filter((b) => {
    const m = metaDe(meta, Number(b.n_cod_prod))
    return (!f.tipos.length || f.tipos.includes(m.tipo || '_')) && (!f.familias.length || f.familias.includes(m.familia))
      && (!termo || semAcento(`${m.rotulo} ${m.codigo}`).includes(termo))
  })
}

/** Uma linha por produto (somando os dias) do papel pedido, filtrada por tipo, família e busca (nome ou código). */
export function agregarOps(brutas: LinhaOpBruta[], meta: Map<number, MetaOp>, papel: PapelOp, f: FiltrosOp): LinhaOp[] {
  const g = new Map<number, { ops: number; qtde: number; custo: number; semCusto: boolean; dias: Set<string> }>()
  for (const b of filtrarOps(brutas, meta, f)) {
    if (b.papel !== papel) continue
    const cod = Number(b.n_cod_prod)
    const x = g.get(cod) ?? { ops: 0, qtde: 0, custo: 0, semCusto: false, dias: new Set<string>() }
    x.ops += Number(b.ops) || 0
    x.qtde += Number(b.qtde) || 0
    if (b.custo == null) x.semCusto = true
    else x.custo += Number(b.custo)
    x.dias.add(b.dia)
    g.set(cod, x)
  }
  return [...g.entries()].map(([cod, x]) => {
    const m = metaDe(meta, cod)
    return { chave: String(cod), rotulo: m.rotulo, codigo: m.codigo, familia: m.familia, tipo: m.tipo, unidade: m.unidade, ops: x.ops, qtde: r6(x.qtde), custo: x.semCusto ? null : r2(x.custo), dias: x.dias.size }
  }).sort((a, b) => b.ops - a.ops || b.qtde - a.qtde || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}

/** Cartões: OPs (ou movimentos) de produção, produtos produzidos, insumos consumidos e custos (nulo se faltar custo). */
export function resumoOps(brutas: LinhaOpBruta[]): { ops: number; produtos: number; insumos: number; custoProduzido: number | null; custoConsumido: number | null } {
  const soma = (p: PapelOp) => {
    const ls = brutas.filter((b) => b.papel === p)
    return ls.length && ls.every((b) => b.custo != null) ? r2(ls.reduce((s, b) => s + Number(b.custo), 0)) : null
  }
  return {
    ops: brutas.filter((b) => b.papel === 'produzido').reduce((s, b) => s + (Number(b.ops) || 0), 0),
    produtos: new Set(brutas.filter((b) => b.papel === 'produzido').map((b) => Number(b.n_cod_prod))).size,
    insumos: new Set(brutas.filter((b) => b.papel === 'consumido').map((b) => Number(b.n_cod_prod))).size,
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
export function serieOps(brutas: LinhaOpBruta[], ini: string, fim: string): { dia: string; ops: number; qtde: number }[] {
  const m = new Map<string, { ops: number; qtde: number }>()
  for (const b of brutas) {
    if (b.papel !== 'produzido') continue
    const x = m.get(b.dia) ?? { ops: 0, qtde: 0 }
    x.ops += Number(b.ops) || 0
    x.qtde += Number(b.qtde) || 0
    m.set(b.dia, x)
  }
  const out: { dia: string; ops: number; qtde: number }[] = []
  for (let d = ini; d <= fim; d = proximoDia(d)) out.push({ dia: d, ops: m.get(d)?.ops ?? 0, qtde: r6(m.get(d)?.qtde ?? 0) })
  return out
}
