import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { carregarFichasAtivas } from '@/lib/estoque/receita-db'
import type { LinhaFichaTela } from '@/lib/estoque/fichas-tela-puro'

// Fichas técnicas da loja nos dois modos (tela /estoque/fichas e o Excel da estrutura em todos os níveis).
// Omie: estrutura_produto_cache (lida do Omie pelo sync-fichas); próprio: fichas ativas do app (quantidade por 1 unidade).

type CacheRow = {
  codigo_produto: number; codigo_produto_insumo: number; descricao_insumo: string | null; quantidade: number; percentual_perda: number | null
  unidade: string | null; codigo_local_estoque?: number | null; local_fonte?: string | null; incluido_por?: string | null
  incluido_em?: string | null; alterado_por?: string | null; alterado_em?: string | null
}

export async function fichasOmie(lojaId: number): Promise<{ linhas: LinhaFichaTela[]; avisos: string[]; lidas: number | null }> {
  const supabase = await createClient()
  const avisos: string[] = []
  let erro = false
  const base = 'id, codigo_produto, codigo_produto_insumo, descricao_insumo, quantidade, percentual_perda, unidade'
  let rows = await buscarTodasLinhas<CacheRow>((from, to) =>
    supabase.from('estrutura_produto_cache').select(`${base}, codigo_local_estoque, local_fonte, incluido_por, incluido_em, alterado_por, alterado_em`)
      .eq('loja_id', lojaId).order('id').range(from, to) as unknown as PromiseLike<{ data: CacheRow[] | null; error: { message: string } | null }>, undefined, () => { erro = true })
  if (erro) {
    avisos.push('Local de consumo e autor ainda não disponíveis (migration 160 pendente).')
    rows = await buscarTodasLinhas<CacheRow>((from, to) =>
      supabase.from('estrutura_produto_cache').select(base).eq('loja_id', lojaId).order('id').range(from, to) as unknown as PromiseLike<{ data: CacheRow[] | null; error: { message: string } | null }>)
  }
  const { count, error } = await supabase.from('estrutura_produto_sync').select('codigo_produto', { count: 'exact', head: true }).eq('loja_id', lojaId)
  return {
    avisos, lidas: error ? null : count ?? 0,
    linhas: rows.map((r) => ({
      produto: Number(r.codigo_produto), insumo: Number(r.codigo_produto_insumo), quantidade: Number(r.quantidade), perda: Number(r.percentual_perda ?? 0),
      unidade: r.unidade, local: r.codigo_local_estoque == null ? null : Number(r.codigo_local_estoque), localFonte: r.local_fonte ?? null,
      alteradoPor: r.alterado_por ?? null, alteradoEm: r.alterado_em ?? null, incluidoPor: r.incluido_por ?? null, incluidoEm: r.incluido_em ?? null,
    })),
  }
}

export async function fichasProprio(lojaId: number): Promise<{ linhas: LinhaFichaTela[]; avisos: string[]; lidas: null }> {
  const supabase = await createClient()
  const fichas = await carregarFichasAtivas(supabase, lojaId)
  const { data } = await supabase.from('fichas_tecnicas').select('id, criada_por, created_at').eq('loja_id', lojaId).eq('ativa', true).order('id').limit(5000)
  const autor = new Map((data ?? []).map((f) => [Number(f.id), { por: f.criada_por as string | null, em: (f.created_at as string).slice(0, 10) }]))
  const linhas = [...fichas.values()].flatMap((f) => f.itens.map((i: { codigoInsumo: number; quantidadeLiquida: number; fatorCorrecao: number; perdaPct: number }) => ({
    produto: f.codigoProduto, insumo: i.codigoInsumo, quantidade: (i.quantidadeLiquida * i.fatorCorrecao) / (f.rendimento || 1), perda: i.perdaPct,
    unidade: null, local: null, localFonte: null, alteradoPor: null, alteradoEm: null,
    incluidoPor: autor.get(f.fichaId)?.por ?? null, incluidoEm: autor.get(f.fichaId)?.em ?? null,
  })))
  return { linhas, avisos: ['No estoque próprio o local de consumo é escolhido na produção, não na ficha. Quantidades por 1 unidade do prato (já com o fator de correção).'], lidas: null }
}

export async function carregarFichasDaLoja(lojaId: number, modo: 'omie' | 'proprio'): Promise<{ linhas: LinhaFichaTela[]; avisos: string[]; lidas: number | null }> {
  return modo === 'omie' ? fichasOmie(lojaId) : fichasProprio(lojaId)
}
