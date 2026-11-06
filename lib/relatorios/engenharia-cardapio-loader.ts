import { createServiceClient } from '@/lib/supabase/server'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { engenhariaCardapio, type LinhaVendida } from './engenharia-cardapio-puro'

const n = (v: unknown) => Number(v) || 0

// Engenharia de cardápio (tela e Excel): vendas por produto do lucro_proprio + família do cadastro.
export async function carregarEngenharia(lojaId: number, ini: string, fim: string, familiaPedida?: string | null) {
  let erro: string | null = null
  const supabase = createServiceClient()
  const [linhas, prods] = await Promise.all([
    rpcTodos<Record<string, unknown>>(supabase, 'lucro_proprio',
      { p_loja: lojaId, p_ini: ini, p_fim: fim, p_dim: 'produto' }, (e) => { erro = e.message }),
    buscarTodasLinhas<{ descricao: string | null; descricao_familia: string | null }>((from, to) =>
      supabase.from('produtos').select('descricao, descricao_familia').eq('loja_id', lojaId).order('codigo_produto').range(from, to)),
  ])
  // O método compara pratos da mesma categoria (cerveja com cerveja, prato com prato): filtro por família.
  // lucro_proprio devolve a descrição do produto como rótulo; a família vem do cadastro pela mesma descrição.
  const familiaDe = new Map<string, string>()
  for (const x of prods ?? []) if (x.descricao) familiaDe.set(x.descricao, x.descricao_familia?.trim() || 'Sem família')
  const todas = ((linhas ?? []) as Record<string, unknown>[]).map((x): LinhaVendida & { familia: string } => ({
    rotulo: String(x.rotulo ?? ''), quantidade: n(x.quantidade), faturamento: n(x.faturamento), cmv: n(x.cmv),
    itens_sem_baixa: n(x.itens_sem_baixa), itens_sem_custo: n(x.itens_sem_custo),
    familia: familiaDe.get(String(x.rotulo ?? '')) ?? 'Sem família',
  }))
  const familias = [...new Set(todas.map((x) => x.familia))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const familia = familiaPedida && familias.includes(familiaPedida) ? familiaPedida : null
  const r = engenhariaCardapio(todas.filter((x) => !familia || x.familia === familia))
  return { erro: erro as string | null, familias, familia, r }
}
