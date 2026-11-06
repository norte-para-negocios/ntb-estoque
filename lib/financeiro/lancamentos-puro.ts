// Regras puras do LANÇAMENTO AVULSO e da TRANSFERÊNCIA entre contas correntes (migration 370). Espelham
// fin_lancamento_avulso_registrar e fin_transferencia_registrar. Dinheiro em centavos; datas YYYY-MM-DD.

export function validarLancamento(l: {
  tipo: 'entrada' | 'saida'; valorCent: number; data: string; hoje: string; categoriaTipo: 'despesa' | 'receita' | null; descricao: string
}): string | null {
  if (l.tipo !== 'entrada' && l.tipo !== 'saida') return 'Escolha entrada ou saída.'
  if (!(l.valorCent > 0)) return 'Informe um valor maior que zero.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l.data)) return 'Informe a data.'
  if (l.data > l.hoje) return 'A data não pode ser futura.'
  if (l.descricao.trim().length < 2) return 'Informe a descrição.'
  if (!l.categoriaTipo) return 'Escolha a categoria (entra na DRE).'
  if (l.tipo === 'saida' && l.categoriaTipo !== 'despesa') return 'Saída precisa de uma categoria de despesa.'
  if (l.tipo === 'entrada' && l.categoriaTipo !== 'receita') return 'Entrada precisa de uma categoria de receita.'
  return null
}

export function validarTransferencia(t: { origemId: number; destinoId: number; valorCent: number; data: string; hoje: string }): string | null {
  if (!(t.origemId > 0)) return 'Escolha a conta de origem.'
  if (!(t.destinoId > 0)) return 'Escolha a conta de destino.'
  if (t.origemId === t.destinoId) return 'Origem e destino não podem ser a mesma conta.'
  if (!(t.valorCent > 0)) return 'Informe um valor maior que zero.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.data)) return 'Informe a data.'
  if (t.data > t.hoje) return 'A data não pode ser futura.'
  return null
}

/** Soma de todas as contas da loja: transferência (e o estorno dela) entra e sai do mesmo valor, não muda o consolidado. */
export const saldoConsolidadoCent = (ls: { tipo: 'entrada' | 'saida'; valorCent: number }[]): number =>
  ls.reduce((s, l) => s + (l.tipo === 'entrada' ? l.valorCent : -l.valorCent), 0)
