import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { limiteJanelaQuente } from '@/lib/historico-contabo'
import { buscarItensNFFrio } from '@/lib/relatorio-frio-nf'

// CSV simples (;) de cada bloco da tela de pendências: ?bloco=sem-familia |
// sem-tipo | sem-cadastro. Recalcula do zero (mesmas fontes da página).
export async function GET(req: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })
  const bloco = new URL(req.url).searchParams.get('bloco') ?? 'sem-cadastro'
  const supabase = createServiceClient()

  const csv = (linhas: string[][]): Response => {
    const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const corpo = '﻿' + linhas.map((l) => l.map(esc).join(';')).join('\r\n')
    return new Response(corpo, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pendencias-${bloco}.csv"`,
      },
    })
  }

  const { data: prods } = await supabase
    .from('produtos')
    .select('codigo_produto, codigo, descricao, tipo_item, descricao_familia')
    .eq('loja_id', lojaId)
  type Prod = { codigo_produto: number; codigo: string | null; descricao: string | null; tipo_item: string | null; descricao_familia: string | null }
  const todos = (prods ?? []) as Prod[]

  if (bloco === 'sem-familia') {
    return csv([
      ['codigo', 'descricao', 'tipo'],
      ...todos.filter((p) => !p.descricao_familia).map((p) => [String(p.codigo ?? p.codigo_produto), p.descricao ?? '', p.tipo_item ?? '']),
    ])
  }
  if (bloco === 'sem-tipo') {
    return csv([
      ['codigo', 'descricao', 'familia'],
      ...todos.filter((p) => !p.tipo_item).map((p) => [String(p.codigo ?? p.codigo_produto), p.descricao ?? '', p.descricao_familia ?? '']),
    ])
  }
  if (bloco === 'cupom-nao-identificado') {
    const { data } = await supabase
      .from('faturamento_importado')
      .select('mes, valor')
      .eq('loja_id', lojaId)
      .eq('dimensao', 'produto')
      .eq('rotulo', 'Produto não identificado')
      .order('mes', { ascending: false })
      .limit(12)
    return csv([
      ['mes', 'valor'],
      ...(data ?? []).map((r) => [r.mes as string, Number(r.valor).toFixed(2).replace('.', ',')]),
    ])
  }

  // sem-cadastro: itens de NF (12 meses, quente+frio) sem produto no cadastro.
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini12m = `${Number(hojeISO.slice(0, 4)) - 1}${hojeISO.slice(4, 10)}`
  const corte = limiteJanelaQuente()
  type ItemNF = { n_id_produto: number | null; c_descricao_produto: string | null; c_codigo_produto: string | null; n_qtde_nfe: number | null; n_preco_unit: number | null; fornecedor: string | null }
  const { data: quentesRaw } = await supabase
    .from('nota_fiscal_items')
    .select('n_id_produto, c_descricao_produto, c_codigo_produto, n_qtde_nfe, n_preco_unit, notas_fiscais!inner(deleted_at, d_emissao_nfe, c_razao_social, c_nome)')
    .eq('loja_id', lojaId)
    .is('notas_fiscais.deleted_at', null)
    .gte('notas_fiscais.d_emissao_nfe', corte)
    .limit(50000)
  const quentes: ItemNF[] = ((quentesRaw ?? []) as unknown as (ItemNF & { notas_fiscais: { c_razao_social: string | null; c_nome: string | null } })[]).map((r) => ({
    n_id_produto: r.n_id_produto, c_descricao_produto: r.c_descricao_produto, c_codigo_produto: r.c_codigo_produto,
    n_qtde_nfe: r.n_qtde_nfe, n_preco_unit: r.n_preco_unit,
    fornecedor: r.notas_fiscais?.c_razao_social || r.notas_fiscais?.c_nome || null,
  }))
  const corteExcl = new Date(Date.parse(corte) - 86400000).toISOString().slice(0, 10)
  const friosRaw = await buscarItensNFFrio({ lojaId, dataInicio: ini12m, dataFinal: corteExcl })
  const frios: ItemNF[] = friosRaw.map((it) => ({
    n_id_produto: it.n_id_produto, c_descricao_produto: it.c_descricao_produto, c_codigo_produto: it.c_codigo_produto,
    n_qtde_nfe: Number(it.n_qtde_nfe) || 0, n_preco_unit: Number(it.n_preco_unit) || 0, fornecedor: it.nf_fornecedor ?? null,
  }))

  const codigosCadastro = new Set(todos.map((p) => Number(p.codigo_produto)))
  const grupos = new Map<string, { descricao: string; codigo: string; fornecedor: string; ocorrencias: number; valor: number }>()
  for (const it of [...quentes, ...frios]) {
    const cod = it.n_id_produto != null ? Number(it.n_id_produto) : null
    if (cod !== null && codigosCadastro.has(cod)) continue
    const k = `${it.c_descricao_produto ?? ''}|${it.c_codigo_produto ?? ''}`
    const e = grupos.get(k) ?? { descricao: it.c_descricao_produto ?? '', codigo: it.c_codigo_produto ?? '', fornecedor: it.fornecedor ?? '', ocorrencias: 0, valor: 0 }
    e.ocorrencias += 1
    e.valor += (Number(it.n_qtde_nfe) || 0) * (Number(it.n_preco_unit) || 0)
    grupos.set(k, e)
  }
  return csv([
    ['descricao_na_nf', 'codigo_na_nf', 'fornecedor', 'ocorrencias', 'valor'],
    ...[...grupos.values()]
      .sort((a, b) => b.valor - a.valor)
      .map((l) => [l.descricao, l.codigo, l.fornecedor, String(l.ocorrencias), l.valor.toFixed(2).replace('.', ',')]),
  ])
}
