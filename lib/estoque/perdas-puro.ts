// T5.4 (Fase 5): perdas e desperdício com causa, no estoque próprio. Módulo puro (sem imports @/) para `node --test`.
// Fontes no ledger (estoque_movimentos_efetivo):
//   AJUSTE_MANUAL  ajuste da tela de estoque; o motivo digitado (obrigatório) fica em `obs`
//   PERDA          baixa de lote (baixar_lote, 145): obs "Baixa por vencimento · lote … · val. … · <motivo>"
//   INVENTARIO     diferença de contagem (ajuste do item do inventário)
// Só SAÍDAS contam (sobra não é perda); movimento estornado sai. "Ajuste da consultoria …" é correção de dados (não é perda):
// aparece separado e fora do total.

export type CausaPerda = 'vencimento' | 'quebra' | 'desperdicio' | 'inventario' | 'outro' | 'correcao'

export const ROTULO_CAUSA: Record<CausaPerda, string> = {
  vencimento: 'Vencimento',
  quebra: 'Quebra',
  desperdicio: 'Desperdício',
  inventario: 'Diferença de inventário',
  outro: 'Outro motivo',
  correcao: 'Correção de dados (não é perda)',
}

export const ORIGENS_PERDA = ['AJUSTE_MANUAL', 'PERDA', 'INVENTARIO'] as const

export type MovPerda = {
  id: number
  origem: string
  quantidade: number
  obs: string | null
  codigo_produto: number
  codigo_local_estoque: number
  data_ref: string
  custo_unitario: number | null
  cmc_apos: number | null
  user_id: string | null
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function causaDaPerda(m: Pick<MovPerda, 'origem' | 'obs'>): CausaPerda {
  if (m.origem === 'INVENTARIO') return 'inventario'
  const t = semAcento(m.obs ?? '')
  if (m.origem === 'AJUSTE_MANUAL' && (t.startsWith('ajuste da consultoria') || /\bcorre[cç][aã]o de (dados|cadastro)\b/.test(t))) return 'correcao'
  // Baixa de lote: o motivo escolhido na tela é o último trecho depois de " · "; sem palavra-chave, é vencimento.
  const loteVencido = m.origem === 'PERDA' && t.startsWith('baixa por vencimento')
  const motivo = loteVencido ? t.slice(t.lastIndexOf(' · ') + 3) : t
  if (/vencid|venceu|validade/.test(motivo)) return 'vencimento'
  if (/quebr|caiu|derrub|trincad|avaria|danificad/.test(motivo)) return 'quebra'
  if (/desperdi|estrag|descart|queim|azedo|podre|qualidade|sobra de producao/.test(motivo)) return 'desperdicio'
  return loteVencido ? 'vencimento' : 'outro'
}

export type LinhaPerda = {
  id: number
  causa: CausaPerda
  produto: number
  local: number
  data: string
  quantidade: number
  custoUnitario: number
  valor: number
  motivo: string | null
  userId: string | null
}

export type ResultadoPerdas = {
  linhas: LinhaPerda[]
  porCausa: { causa: CausaPerda; valor: number; n: number }[]
  totalPerdas: number
  totalCorrecoes: number
}

const r2 = (v: number) => Math.round(v * 100) / 100

/** `estornados`: ids de movimentos que têm estorno (EST com reverses_id) — saem da lista. */
export function montarPerdas(movs: MovPerda[], estornados: ReadonlySet<number>): ResultadoPerdas {
  const linhas: LinhaPerda[] = []
  for (const m of movs) {
    if (!(m.quantidade < 0) || estornados.has(m.id)) continue
    const custo = m.custo_unitario != null && m.custo_unitario > 0 ? m.custo_unitario : m.cmc_apos != null && m.cmc_apos > 0 ? m.cmc_apos : 0
    const q = -m.quantidade
    linhas.push({
      id: m.id, causa: causaDaPerda(m), produto: m.codigo_produto, local: m.codigo_local_estoque, data: m.data_ref,
      quantidade: q, custoUnitario: custo, valor: r2(q * custo), motivo: m.obs, userId: m.user_id,
    })
  }
  const mapa = new Map<CausaPerda, { causa: CausaPerda; valor: number; n: number }>()
  for (const l of linhas) {
    const c = mapa.get(l.causa) ?? { causa: l.causa, valor: 0, n: 0 }
    c.valor = r2(c.valor + l.valor)
    c.n++
    mapa.set(l.causa, c)
  }
  const porCausa = [...mapa.values()].sort((a, b) => Number(a.causa === 'correcao') - Number(b.causa === 'correcao') || b.valor - a.valor)
  const totalCorrecoes = r2(linhas.filter((l) => l.causa === 'correcao').reduce((s, l) => s + l.valor, 0))
  const totalPerdas = r2(linhas.filter((l) => l.causa !== 'correcao').reduce((s, l) => s + l.valor, 0))
  linhas.sort((a, b) => Number(a.causa === 'correcao') - Number(b.causa === 'correcao') || b.valor - a.valor || b.id - a.id)
  return { linhas, porCausa, totalPerdas, totalCorrecoes }
}
