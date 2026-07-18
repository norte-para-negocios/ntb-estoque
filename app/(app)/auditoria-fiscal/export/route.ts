import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { gerarPlanilha, planilhaResponse, type ColunaExcel } from '@/lib/excel'
import { descreverCFOP } from '@/lib/cfop'
import { limiteJanelaQuente } from '@/lib/historico-contabo'
import { buscarItensNFFrio, filtrarItensAuditoria, agregarAuditoriaCfop } from '@/lib/relatorio-frio-nf'

export const dynamic = 'force-dynamic'

type LinhaCFOP = { cfop_doc: string; cfop_entrada: string; itens: number; valor: number; credita_icms: number; move_estoque: number }

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })

  const { searchParams } = new URL(request.url)
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_inicio') ?? '') ? searchParams.get('data_inicio')! : `${hojeISO.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_final') ?? '') ? searchParams.get('data_final')! : hojeISO
  const produto = searchParams.get('produto') || null
  const familia = searchParams.get('familia') || null
  const fornecedor = searchParams.get('fornecedor') || null
  const localCod = searchParams.get('local') && !Number.isNaN(Number(searchParams.get('local'))) ? Number(searchParams.get('local')) : null

  const supabase = createServiceClient()
  const corte = limiteJanelaQuente()
  const iniRpc = ini < corte ? corte : ini
  const { data } = await supabase.rpc('relatorio_auditoria_fiscal_cfop', {
    p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, p_produto: produto, p_familia: familia, p_fornecedor: fornecedor, p_local: localCod,
  })
  const linhas = (data ?? []) as LinhaCFOP[]

  let icmsPorCfop = new Map<string, number>()
  if (ini < corte) {
    // O Supabase corta em 1000 linhas por padrao (sem erro) -- pagina ate esgotar
    // (achado real: lojas com >1000 produtos perdiam o resto do catalogo aqui).
    const prodMetaRaw: { codigo_produto: number; tipo_item: string | null; descricao_familia: string | null }[] = []
    for (let pg = 0; ; pg++) {
      const from = pg * 1000
      const { data } = await supabase
        .from('produtos')
        .select('codigo_produto, tipo_item, descricao_familia')
        .eq('loja_id', lojaId)
        .range(from, from + 999)
      if (!data?.length) break
      prodMetaRaw.push(...data)
      if (data.length < 1000) break
    }
    const meta = new Map<number, { tipo: string | null; familia: string | null }>()
    for (const p of prodMetaRaw) {
      meta.set(Number(p.codigo_produto), { tipo: p.tipo_item, familia: p.descricao_familia })
    }
    const corteExcl = new Date(Date.parse(corte) - 86400000).toISOString().slice(0, 10)
    const itensFrios = await buscarItensNFFrio({ lojaId, dataInicio: ini, dataFinal: corteExcl })
    const filtrados = filtrarItensAuditoria(itensFrios, { produto, familia, fornecedor, local: localCod }, meta)
    const porChave = new Map(linhas.map((l) => [`${l.cfop_doc}|${l.cfop_entrada ?? ''}`, l]))
    for (const f of agregarAuditoriaCfop(filtrados)) {
      const k = `${f.cfop_doc}|${f.cfop_entrada ?? ''}`
      const existente = porChave.get(k)
      if (existente) {
        existente.itens += f.itens; existente.valor += f.valor
        existente.credita_icms += f.credita_icms; existente.move_estoque += f.move_estoque
      } else {
        linhas.push(f as LinhaCFOP)
        porChave.set(k, f as LinhaCFOP)
      }
    }
  }
  if (!linhas.length) return new Response('Sem notas no período', { status: 404 })

  const { data: itensIcms } = await supabase
    .from('nota_fiscal_items')
    .select('full_object, c_cfop, notas_fiscais!inner(d_emissao_nfe, c_etapa, deleted_at)')
    .eq('loja_id', lojaId)
    .gte('notas_fiscais.d_emissao_nfe', iniRpc)
    .lte('notas_fiscais.d_emissao_nfe', fim)
    .eq('notas_fiscais.c_etapa', '60')
    .is('notas_fiscais.deleted_at', null)
  for (const it of (itensIcms ?? []) as { full_object: { itensAjustes?: { cCFOPEntrada?: string }; itensICMS?: { nValor?: number } }; c_cfop: string | null }[]) {
    const doc = it.c_cfop ?? ''
    const ent = it.full_object?.itensAjustes?.cCFOPEntrada ?? ''
    const k = `${doc}|${ent}`
    icmsPorCfop.set(k, (icmsPorCfop.get(k) ?? 0) + (Number(it.full_object?.itensICMS?.nValor) || 0))
  }

  const totValor = linhas.reduce((s, l) => s + Number(l.valor), 0)
  const colunas: ColunaExcel[] = [
    { key: 'cfop', label: 'CFOP doc → entrada', tipo: 'texto', largura: 18 },
    { key: 'descricao', label: 'O que é (entrada)', tipo: 'texto', largura: 38 },
    { key: 'categoria', label: 'Categoria', tipo: 'texto', largura: 24 },
    { key: 'itens', label: 'Itens', tipo: 'numero', somar: true },
    { key: 'valor', label: 'Valor', tipo: 'moeda', somar: true },
    { key: 'pct', label: '%', tipo: 'texto' },
    { key: 'credita', label: 'Credita ICMS', tipo: 'numero', somar: true },
    { key: 'icms_valor', label: 'ICMS creditado (R$)', tipo: 'moeda', somar: true },
    { key: 'nao_estoca', label: 'Não estoca', tipo: 'numero', somar: true },
  ]
  const rows = linhas.map((l) => {
    const d = descreverCFOP(l.cfop_entrada)
    const kIcms = `${l.cfop_doc}|${l.cfop_entrada ?? ''}`
    return {
      cfop: `${l.cfop_doc} → ${l.cfop_entrada ?? 'sem entrada'}`,
      descricao: d.desc,
      categoria: d.cat,
      itens: Number(l.itens),
      valor: Number(l.valor),
      pct: totValor > 0 ? `${((Number(l.valor) / totValor) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-',
      credita: Number(l.credita_icms),
      icms_valor: Number((icmsPorCfop.get(kIcms) ?? 0).toFixed(2)),
      nao_estoca: Number(l.itens) - Number(l.move_estoque),
    }
  })

  const buffer = await gerarPlanilha(rows, colunas, {
    titulo: 'Auditoria fiscal — compras por CFOP',
    subtitulo: `Período ${ini} a ${fim}${produto ? ` · Produto: ${produto}` : ''}${familia ? ` · Família: ${familia}` : ''}${fornecedor ? ` · Fornecedor: ${fornecedor}` : ''}${localCod !== null ? ` · Local: ${localCod}` : ''}`,
    autoFiltro: true,
  })
  return planilhaResponse('auditoria-fiscal', buffer)
}
