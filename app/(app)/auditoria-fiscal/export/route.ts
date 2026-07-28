import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { gerarPlanilha, planilhaResponse, type ColunaExcel } from '@/lib/excel'
import { descreverCFOP } from '@/lib/cfop'
import { limiteJanelaQuente } from '@/lib/historico-contabo'
import { buscarItensNFFrio, filtrarItensAuditoria, agregarAuditoriaCfop } from '@/lib/relatorio-frio-nf'

export const dynamic = 'force-dynamic'

type LinhaCFOP = { cfop_doc: string; cfop_entrada: string; itens: number; valor: number; credita_icms: number; move_estoque: number; icms_creditado: number }

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })

  const { searchParams } = new URL(request.url)
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_inicio') ?? '') ? searchParams.get('data_inicio')! : `${hojeISO.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_final') ?? '') ? searchParams.get('data_final')! : hojeISO
  const produto = searchParams.get('produto') || null
  const familiasFiltro = (searchParams.get('familia') ?? '').split(',').map((v) => v.trim()).filter(Boolean)
  const fornecedor = searchParams.get('fornecedor') || null
  const localCod = searchParams.get('local') && !Number.isNaN(Number(searchParams.get('local'))) ? Number(searchParams.get('local')) : null

  const supabase = createServiceClient()
  const corte = limiteJanelaQuente()
  const iniRpc = ini < corte ? corte : ini
  const { data } = await supabase.rpc('relatorio_auditoria_fiscal_cfop', {
    p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, p_produto: produto, p_familias: familiasFiltro.length ? familiasFiltro : null, p_fornecedor: fornecedor, p_local: localCod,
  })
  const linhas = (data ?? []) as LinhaCFOP[]

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
        .order('id', { ascending: true })
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
    const filtrados = filtrarItensAuditoria(itensFrios, { produto, familias: familiasFiltro, fornecedor, local: localCod }, meta)
    const porChave = new Map(linhas.map((l) => [`${l.cfop_doc}|${l.cfop_entrada ?? ''}`, l]))
    for (const f of agregarAuditoriaCfop(filtrados)) {
      const k = `${f.cfop_doc}|${f.cfop_entrada ?? ''}`
      const existente = porChave.get(k)
      if (existente) {
        // f.* já vem como number genuíno (agregarAuditoriaCfop soma com +=1/Number()),
        // mas o RPC via PostgREST também retorna number puro pra bigint/numeric --
        // Number(...) aqui é so defensivo (mesmo padrão do page.tsx), não corrige
        // um bug real observado, so blinda contra o driver do Contabo mudar no futuro.
        existente.itens = Number(existente.itens) + f.itens
        existente.valor = Number(existente.valor) + f.valor
        existente.credita_icms = Number(existente.credita_icms) + f.credita_icms
        existente.move_estoque = Number(existente.move_estoque) + f.move_estoque
        existente.icms_creditado = Number(existente.icms_creditado) + f.icms_creditado
      } else {
        linhas.push(f as LinhaCFOP)
        porChave.set(k, f as LinhaCFOP)
      }
    }
  }
  if (!linhas.length) return new Response('Sem notas no período', { status: 404 })

  // "ICMS creditado (R$)" agora vem direto da RPC (coluna icms_creditado,
  // migration 081) -- antes era uma query solta em nota_fiscal_items sem
  // paginacao (corte silencioso de 1000 linhas do PostgREST -- as 6 lojas
  // ativas TEM mais de 1000 itens na janela quente), sem filtro de NF
  // cancelada, sem os filtros de produto/familia/fornecedor/local do resto
  // do relatorio, e sem filtrar por credita_icms (somava ICMS de itens que
  // NAO creditam junto). A RPC ja resolve os 4 problemas de uma vez.

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
    return {
      cfop: `${l.cfop_doc} → ${l.cfop_entrada ?? 'sem entrada'}`,
      descricao: d.desc,
      categoria: d.cat,
      itens: Number(l.itens),
      valor: Number(l.valor),
      pct: totValor > 0 ? `${((Number(l.valor) / totValor) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-',
      credita: Number(l.credita_icms),
      icms_valor: Number(Number(l.icms_creditado ?? 0).toFixed(2)),
      nao_estoca: Number(l.itens) - Number(l.move_estoque),
    }
  })

  const buffer = await gerarPlanilha(rows, colunas, {
    titulo: 'Auditoria fiscal — compras por CFOP',
    subtitulo: `Período ${ini} a ${fim}${produto ? ` · Produto: ${produto}` : ''}${familiasFiltro.length ? ` · Família: ${familiasFiltro.join(', ')}` : ''}${fornecedor ? ` · Fornecedor: ${fornecedor}` : ''}${localCod !== null ? ` · Local: ${localCod}` : ''}`,
    autoFiltro: true,
  })
  return planilhaResponse('auditoria-fiscal', buffer)
}
