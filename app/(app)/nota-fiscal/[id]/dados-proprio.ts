import { createClient } from '@/lib/supabase/server'
import type { ItemConferencia } from '@/components/nota-fiscal/ConferenciaNF'

// Dados da conferência de uma nota em loja de estoque próprio (leitura pela sessão: RLS por loja).

export type ConferenciaCarregada = {
  compra: { id: number; status: string; codigoLocal: number | null; numero: string | null } | null
  itens: ItemConferencia[]
  locais: { codigo: number; descricao: string }[]
  sefaz: { origem: string | null; recebidoEm: string | null; nsu: string | null; completo: boolean; alertas: string[] }
  documento: { cienciaEm: string | null; cienciaCstat: string | null; tipo: string | null } | null
}

export async function carregarConferencia(lojaId: number, notaId: number, fullObject: unknown, chave: string | null): Promise<ConferenciaCarregada> {
  const sb = await createClient()
  const { data: c } = await sb.from('compras_proprio').select('id, status, codigo_local_estoque, numero').eq('loja_id', lojaId).eq('nota_fiscal_id', notaId).maybeSingle()
  const itens: ItemConferencia[] = []
  if (c) {
    const { data: raw } = await sb.from('compras_proprio_itens').select('*').eq('compra_id', c.id).order('linha')
    const linhas = (raw ?? []) as Record<string, unknown>[]
    const codigos = [...new Set(linhas.flatMap((i) => [i.codigo_produto, i.sugestao_codigo_produto]).filter((x): x is number => typeof x === 'number'))]
    const prods = new Map<number, { codigoProduto: number; codigo: string; descricao: string; unidade: string }>()
    if (codigos.length) {
      const { data } = await sb.from('produtos').select('codigo_produto, codigo, descricao, unidade').eq('loja_id', lojaId).in('codigo_produto', codigos)
      for (const p of data ?? []) prods.set(Number(p.codigo_produto), { codigoProduto: Number(p.codigo_produto), codigo: p.codigo, descricao: p.descricao, unidade: p.unidade ?? '' })
    }
    for (const i of linhas) {
      const cp = typeof i.codigo_produto === 'number' ? i.codigo_produto : null
      const sg = typeof i.sugestao_codigo_produto === 'number' ? i.sugestao_codigo_produto : null
      itens.push({
        id: Number(i.id), linha: Number(i.linha), descricao: (i.descricao as string) ?? `Item ${i.linha}`, cProd: (i.c_prod as string) ?? null, unidade: (i.unidade_compra as string) ?? null,
        quantidade: Number(i.quantidade), valorLiquido: Number(i.valor_total) - Number(i.desconto), lancado: !!i.lancado, fator: Number(i.fator) || 1,
        custoUnitarioBase: i.custo_unitario_base == null ? null : Number(i.custo_unitario_base),
        matchOrigem: (i.match_origem as ItemConferencia['matchOrigem']) ?? null, score: i.match_score == null ? null : Number(i.match_score),
        produto: cp != null ? prods.get(cp) ?? null : null, sugestao: cp == null && sg != null ? prods.get(sg) ?? null : null,
      })
    }
  }
  const { data: locaisRaw } = await sb.from('local_estoques').select('codigo_local_estoque, descricao, padrao, inativo').eq('loja_id', lojaId).is('deleted_at', null).order('padrao', { ascending: false }).order('descricao')
  const locais = (locaisRaw ?? []).filter((l) => l.inativo !== 'S' && l.inativo !== true).map((l) => ({ codigo: Number(l.codigo_local_estoque), descricao: l.descricao as string }))
  const fo = (fullObject ?? {}) as { sefaz?: { origem?: string; recebidoEm?: string; nsu?: string; completo?: boolean; alertas?: string[] } }
  let documento: ConferenciaCarregada['documento'] = null
  if (chave) {
    const { data: d } = await sb.from('sefaz_documentos').select('ciencia_em, ciencia_cstat, tipo').eq('loja_id', lojaId).eq('chave', chave).order('id', { ascending: false }).limit(1).maybeSingle()
    if (d) documento = { cienciaEm: d.ciencia_em, cienciaCstat: d.ciencia_cstat, tipo: d.tipo }
  }
  return {
    compra: c ? { id: Number(c.id), status: c.status, codigoLocal: c.codigo_local_estoque != null ? Number(c.codigo_local_estoque) : null, numero: c.numero } : null,
    itens, locais,
    sefaz: { origem: fo.sefaz?.origem ?? null, recebidoEm: fo.sefaz?.recebidoEm ?? null, nsu: fo.sefaz?.nsu ?? null, completo: fo.sefaz?.completo !== false, alertas: fo.sefaz?.alertas ?? [] },
    documento,
  }
}
