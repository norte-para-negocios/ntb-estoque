import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { limiteJanelaQuente } from '@/lib/historico-contabo'
import { buscarItensNFFrio, cfopEntradaDe } from '@/lib/relatorio-frio-nf'
import { descreverCFOP } from '@/lib/cfop'

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

  type Prod = { codigo_produto: number; codigo: string | null; descricao: string | null; tipo_item: string | null; descricao_familia: string | null }
  // PostgREST corta em 1000 linhas por padrão, sem erro -- pagina até trazer
  // tudo (mesmo fix da página; ver comentário lá).
  const todos: Prod[] = []
  for (let p = 0; ; p++) {
    const { data } = await supabase
      .from('produtos')
      .select('codigo_produto, codigo, descricao, tipo_item, descricao_familia')
      .eq('loja_id', lojaId)
      .order('codigo_produto')
      .range(p * 1000, p * 1000 + 999)
    if (!data?.length) break
    todos.push(...(data as Prod[]))
    if (data.length < 1000) break
  }

  if (bloco === 'sem-familia') {
    // Sugestão do cliente (Ramon): CFOP de entrada mais frequente ajuda a
    // decidir a classificação sem família cadastrada — mesma lógica da página.
    const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
    const ini12m = `${Number(hojeISO.slice(0, 4)) - 1}${hojeISO.slice(4, 10)}`
    const corte = limiteJanelaQuente()
    const { data: quentesCfop } = await supabase
      .from('nota_fiscal_items')
      .select('n_id_produto, c_cfop, full_object, notas_fiscais!inner(deleted_at, d_emissao_nfe)')
      .eq('loja_id', lojaId)
      .is('notas_fiscais.deleted_at', null)
      .gte('notas_fiscais.d_emissao_nfe', corte)
      .limit(50000)
    const corteExcl = new Date(Date.parse(corte) - 86400000).toISOString().slice(0, 10)
    const friosCfop = await buscarItensNFFrio({ lojaId, dataInicio: ini12m, dataFinal: corteExcl })
    const cfopPorProduto = new Map<number, Map<string, number>>()
    const somar = (codProd: number | null, cfop: string | null) => {
      if (codProd == null || !cfop) return
      const contagem = cfopPorProduto.get(codProd) ?? new Map<string, number>()
      contagem.set(cfop, (contagem.get(cfop) ?? 0) + 1)
      cfopPorProduto.set(codProd, contagem)
    }
    for (const r of (quentesCfop ?? []) as { n_id_produto: number | null; c_cfop: string | null; full_object: Record<string, unknown> | null }[]) {
      const cfop = (r.full_object as { itensAjustes?: { cCFOPEntrada?: string } } | null)?.itensAjustes?.cCFOPEntrada ?? r.c_cfop
      somar(r.n_id_produto, cfop)
    }
    for (const it of friosCfop) somar(it.n_id_produto, cfopEntradaDe(it) ?? it.c_cfop)
    const cfopMaisComum = (codProd: number): string | null => {
      const contagem = cfopPorProduto.get(codProd)
      if (!contagem) return null
      return [...contagem.entries()].sort((a, b) => b[1] - a[1])[0][0]
    }
    return csv([
      ['codigo', 'descricao', 'tipo', 'cfop_entrada', 'cfop_categoria'],
      ...todos.filter((p) => !p.descricao_familia).map((p) => {
        const cfop = cfopMaisComum(Number(p.codigo_produto))
        const info = cfop ? descreverCFOP(cfop) : null
        return [String(p.codigo ?? p.codigo_produto), p.descricao ?? '', p.tipo_item ?? '', info?.codigo ?? '', info?.desc ?? '']
      }),
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
    const k = JSON.stringify([it.c_descricao_produto ?? '', it.c_codigo_produto ?? ''])
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
