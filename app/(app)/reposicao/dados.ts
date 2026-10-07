import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'

export type LinhaReposicao = {
  codigoLocal: number; local: string; codigoProduto: number; codigo: string; descricao: string; unidade: string
  codigoFamilia: number | null; familia: string; saldo: number; minimo: number; falta: number; cmc: number; ultimoCusto: number | null; valorEstimado: number
}

type Row = {
  codigo_local_estoque: number; codigo_produto: number; codigo: string | null; descricao: string | null; unidade: string | null
  codigo_familia: number | null; familia: string | null; saldo: number; minimo: number; falta: number; cmc: number | null; ultimo_custo: number | null; valor_estimado: number | null
}

export async function carregarReposicao(lojaId: number): Promise<{ linhas: LinhaReposicao[]; locais: { codigoLocal: number; descricao: string }[]; familias: { codigo: number; nome: string }[] }> {
  const supabase = await createClient()
  const [rows, locaisRes] = await Promise.all([
    buscarTodasLinhas<Row>((from, to) =>
      supabase.from('sugestao_compra').select('codigo_local_estoque, codigo_produto, codigo, descricao, unidade, codigo_familia, familia, saldo, minimo, falta, cmc, ultimo_custo, valor_estimado')
        .eq('loja_id', lojaId).order('familia').order('codigo_produto').order('codigo_local_estoque').range(from, to)),
    supabase.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId).order('descricao'),
  ])
  const locais = (locaisRes.data ?? []).map((l) => ({ codigoLocal: Number(l.codigo_local_estoque), descricao: l.descricao ?? String(l.codigo_local_estoque) }))
  const nome = new Map(locais.map((l) => [l.codigoLocal, l.descricao]))
  const linhas = rows.map((r) => ({
    codigoLocal: Number(r.codigo_local_estoque), local: nome.get(Number(r.codigo_local_estoque)) ?? String(r.codigo_local_estoque),
    codigoProduto: Number(r.codigo_produto), codigo: r.codigo ?? String(r.codigo_produto), descricao: r.descricao ?? '(sem descrição)', unidade: r.unidade ?? 'UN',
    codigoFamilia: r.codigo_familia == null ? null : Number(r.codigo_familia), familia: r.familia ?? 'Sem família',
    saldo: Number(r.saldo), minimo: Number(r.minimo), falta: Number(r.falta), cmc: Number(r.cmc ?? 0),
    ultimoCusto: r.ultimo_custo == null ? null : Number(r.ultimo_custo), valorEstimado: Number(r.valor_estimado ?? 0),
  }))
  const familias = [...new Map(linhas.map((l) => [l.codigoFamilia ?? 0, { codigo: l.codigoFamilia ?? 0, nome: l.familia }])).values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  return { linhas, locais, familias }
}

export type FiltroReposicao = { q?: string; familia?: string; local?: string }

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function filtrarReposicao(linhas: LinhaReposicao[], f: FiltroReposicao): LinhaReposicao[] {
  const q = semAcento(f.q?.trim() ?? '')
  return linhas.filter((l) =>
    (!q || semAcento(l.descricao).includes(q) || semAcento(l.codigo).includes(q)) &&
    (!f.familia || String(l.codigoFamilia ?? 0) === f.familia) &&
    (!f.local || String(l.codigoLocal) === f.local))
}
