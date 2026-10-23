import { carregarItens, type Opcao } from '@/lib/faturamento-itens-loader'
import { carregarItensCompra, carregarNotasCompra } from '@/lib/notas-compras-loader'
import { situacaoBate } from '@/lib/notas-compras'
import type { ItemAbc } from '@/lib/relatorios/curva-abc-puro'
import { createServiceClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { TIPO_NOME } from '@/lib/omie/faturamento'

export type BaseAbc = 'vendas' | 'compras'
export type BaseAbcCarregada = { itens: ItemAbc[]; aviso: string | null; opcoes: { tipos: Opcao[]; familias: Opcao[] } }

type Bruto = { idProduto: number | null; produto: string; codigo?: string; familia: string; tipo: string; tipoCod: string; quant: number; valor: number }

function agrupar(linhas: Bruto[]): ItemAbc[] {
  const m = new Map<string, ItemAbc>()
  for (const l of linhas) {
    const chave = l.idProduto != null ? String(l.idProduto) : `nome:${l.produto}`
    const g = m.get(chave) ?? { chave, rotulo: l.produto, codigo: l.codigo ?? '', familia: l.familia, tipo: l.tipo, tipoCod: l.tipoCod, valor: 0, quant: 0 }
    g.valor += l.valor
    g.quant += l.quant
    m.set(chave, g)
  }
  return [...m.values()].map((g) => ({ ...g, valor: Math.round(g.valor * 100) / 100, quant: Math.round(g.quant * 1e6) / 1e6 }))
}

// Base da Curva ABC. Vendas = mesma leitura do Faturamento (loja Omie: cupons do Contabo; estoque próprio:
// vendas_proprio), situação "válidas". Compras = itens das notas válidas do período, pelo valor que entra no
// estoque (regra do Omie, padrão das telas de Compras). Tipo e família filtram os itens nas duas bases.
export async function carregarBaseAbc(
  lojaId: number, ini: string, fim: string, base: BaseAbc, filtros: { tipos: string[]; familias: string[] },
): Promise<BaseAbcCarregada> {
  if (base === 'vendas') {
    // valor bruto (quantidade × preço), como a Curva ABC do Omie (paridade 20/10/2026, B5); o Faturamento segue líquido
    const r = await carregarItens(lojaId, ini, fim, { tipos: filtros.tipos, familias: filtros.familias, situacao: 'validas', valor: 'bruto' })
    return { itens: agrupar(r.linhas), aviso: r.aviso, opcoes: r.opcoes }
  }
  const [{ notas, erros }, opcoes] = await Promise.all([
    carregarNotasCompra(lojaId, ini, fim, { tipos: [], familias: [], produto: '', local: null, natureza: '', categoria: '' }),
    opcoesDoCadastro(lojaId),
  ])
  const validas = notas.filter((n) => situacaoBate(n, 'VALIDAS'))
  const { itens, erros: errosItens } = await carregarItensCompra(lojaId, validas, { produto: '', local: null })
  const filtrados = itens.filter((i) =>
    (!filtros.tipos.length || filtros.tipos.includes(i.tipoCod || '_')) && (!filtros.familias.length || filtros.familias.includes(i.familia)))
  const todosErros = [...erros, ...errosItens]
  return {
    itens: agrupar(filtrados.map((i) => ({ ...i, valor: i.valorEstoque ?? i.valor }))),
    aviso: todosErros.length ? `Falha ao ler ${todosErros.join(', ')}. Os valores podem estar incompletos.` : null,
    opcoes,
  }
}

// Mesmas opções de tipo/família do Faturamento (valor do tipo = código, '_' = sem tipo; família = nome).
async function opcoesDoCadastro(lojaId: number): Promise<{ tipos: Opcao[]; familias: Opcao[] }> {
  const supabase = createServiceClient()
  const prods = await buscarTodasLinhas<{ tipo_item: string | null; descricao_familia: string | null }>(
    (from, to) => supabase.from('produtos').select('tipo_item, descricao_familia').eq('loja_id', lojaId).order('id').range(from, to),
  )
  const tipos = new Set(prods.map((p) => p.tipo_item ?? ''))
  const fams = new Set(prods.map((p) => p.descricao_familia || 'Sem família'))
  return {
    tipos: [...tipos].sort().map((c) => ({ value: c || '_', label: c ? (TIPO_NOME[c] ?? `Tipo ${c}`) : 'Não classificado' })),
    familias: [...fams].sort((a, b) => a.localeCompare(b, 'pt-BR')).map((f) => ({ value: f, label: f })),
  }
}
