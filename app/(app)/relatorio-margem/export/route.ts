import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { gerarPlanilha, planilhaResponse, type ColunaExcel } from '@/lib/excel'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'

export const dynamic = 'force-dynamic'

type Row = { codigo: string; descricao: string | null; familia: string | null; mes: string; pdv: number | null; cmc: number | null; margem: number | null }
const margemValida = (m: number | null): m is number => m != null && m > -100

// PostgREST corta em 1000 linhas por padrao, sem erro -- espelha a mesma
// paginacao de app/(app)/relatorio-margem/page.tsx (achado real: sem isto,
// `produtos`/`posicao_estoques` truncavam e a exportacao saia incompleta ou
// vazia pras lojas com catalogo/posicao acima de 1000 linhas).
async function buscarTodasLinhas<T>(
  montar: (from: number, to: number) => PromiseLike<{ data: T[] | null }>
): Promise<T[]> {
  const PAGE = 1000
  const todas: T[] = []
  for (let p = 0; ; p++) {
    const { data } = await montar(p * PAGE, p * PAGE + PAGE - 1)
    if (!data?.length) break
    todas.push(...data)
    if (data.length < PAGE) break
  }
  return todas
}

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })

  const { searchParams } = new URL(request.url)
  const busca = (searchParams.get('busca') ?? '').trim().toLowerCase()
  const familiasArr = valoresMulti(searchParams.get('familia') ?? undefined)
  const tiposArr = valoresMulti(searchParams.get('tipo') ?? undefined)
  const localSel = valoresMulti(searchParams.get('local') ?? undefined).map(Number).filter((n) => !Number.isNaN(n))

  const supabase = createServiceClient()

  let rows = await buscarTodasLinhas<Row>((from, to) =>
    supabase
      .from('margem_importada')
      .select('codigo, descricao, familia, mes, pdv, cmc, margem')
      .eq('loja_id', lojaId)
      .order('codigo', { ascending: true })
      .order('mes', { ascending: true })
      .range(from, to)
  )

  // Mesmo achado/fix da tela (app/(app)/relatorio-margem/page.tsx, 2026-07-22):
  // import manual desatualizado (mes mais recente < mes atual) tambem cai pro
  // calculo ao vivo, nao so quando nao ha import nenhum.
  const mesAtualParaChecagemExport = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' }).slice(0, 7)
  const mesImportadoMaisRecenteExport = rows.reduce<string | null>((max, r) => (!max || r.mes > max ? r.mes : max), null)
  if (mesImportadoMaisRecenteExport !== null && mesImportadoMaisRecenteExport < mesAtualParaChecagemExport) rows = []

  // Mesmo fallback "ao vivo" da tela (produtos sem import manual do FAT_DRV, ou
  // import desatualizado acima): preco de venda x CMC da ultima foto de
  // posicao_estoques, tipos 04/00.
  if (!rows.length) {
    const mesAtualISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' }).slice(0, 7)
    const produtosCalc = await buscarTodasLinhas<{
      codigo: string | null
      codigo_produto: number
      descricao: string | null
      descricao_familia: string | null
      valor_unitario: number | null
    }>((from, to) =>
      supabase
        .from('produtos')
        .select('codigo, codigo_produto, descricao, descricao_familia, tipo_item, valor_unitario')
        .eq('loja_id', lojaId)
        .in('tipo_item', ['04', '00'])
        .order('id', { ascending: true })
        .range(from, to)
    )
    const { data: fotoRow } = await supabase
      .from('posicao_estoques')
      .select('data_posicao')
      .eq('loja_id', lojaId)
      .order('data_posicao', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (fotoRow?.data_posicao && produtosCalc.length) {
      const posRows = await buscarTodasLinhas<{ n_cod_prod: number; n_cmc: number }>((from, to) =>
        supabase
          .from('posicao_estoques')
          .select('n_cod_prod, n_cmc')
          .eq('loja_id', lojaId)
          .eq('data_posicao', fotoRow.data_posicao)
          .gt('n_cmc', 0)
          .order('id', { ascending: true })
          .range(from, to)
      )
      const cmcPorCod = new Map<number, number>()
      for (const p of posRows) {
        const atual = cmcPorCod.get(Number(p.n_cod_prod))
        if (atual == null || Number(p.n_cmc) > atual) cmcPorCod.set(Number(p.n_cod_prod), Number(p.n_cmc))
      }
      rows = produtosCalc
        .map((p) => {
          const cmc = cmcPorCod.get(Number(p.codigo_produto)) ?? null
          const pdv = Number(p.valor_unitario) || null
          const margem = pdv && cmc && pdv > 0 && cmc > 0 ? Number((((pdv - cmc) / pdv) * 100).toFixed(1)) : null
          return { codigo: p.codigo ?? String(p.codigo_produto), descricao: p.descricao, familia: p.descricao_familia, mes: mesAtualISO, pdv, cmc, margem }
        })
        .filter((r) => r.cmc != null && r.pdv != null)
    }
  }
  if (!rows.length) return new Response('Sem margem importada', { status: 404 })

  // Margem mais recente por produto.
  const porCod = new Map<string, Row>()
  for (const r of rows) {
    const cur = porCod.get(r.codigo)
    if (!cur || r.mes > cur.mes) porCod.set(r.codigo, r)
  }
  let produtos = [...porCod.values()]

  // Mesmos filtros da tela: tipo de item e local de estoque cruzam por codigo
  // com `produtos` (margem_importada nao tem essas colunas).
  if (tiposArr.length || localSel.length) {
    const produtosRaw = await buscarTodasLinhas<{ codigo: string | null; tipo_item: string | null; codigo_produto: number | null }>((from, to) =>
      supabase
        .from('produtos')
        .select('codigo, tipo_item, codigo_produto')
        .eq('loja_id', lojaId)
        .order('id', { ascending: true })
        .range(from, to)
    )
    const tipoPorCodigo = new Map<string, string | null>()
    for (const p of produtosRaw) {
      if (p.codigo) tipoPorCodigo.set(p.codigo, p.tipo_item)
    }
    let codigosNoLocal: Set<string> | null = null
    if (localSel.length) {
      const pos = await buscarTodasLinhas<{ n_cod_prod: number }>((from, to) =>
        supabase
          .from('posicao_estoques')
          .select('n_cod_prod')
          .eq('loja_id', lojaId)
          .in('codigo_local_estoque', localSel)
          .order('id', { ascending: true })
          .range(from, to)
      )
      const codProds = new Set(pos.map((p) => Number(p.n_cod_prod)))
      codigosNoLocal = new Set(
        produtosRaw
          .filter((p) => p.codigo_produto != null && codProds.has(Number(p.codigo_produto)))
          .map((p) => p.codigo as string)
          .filter(Boolean)
      )
    }
    produtos = produtos.filter((p) => {
      if (tiposArr.length && !tiposArr.includes(tipoPorCodigo.get(p.codigo) ?? '')) return false
      if (codigosNoLocal !== null && !codigosNoLocal.has(p.codigo)) return false
      return true
    })
  }
  if (busca || familiasArr.length) {
    produtos = produtos.filter((p) => {
      if (busca && !(p.descricao ?? '').toLowerCase().includes(busca) && !p.codigo.toLowerCase().includes(busca)) return false
      if (familiasArr.length && !familiasArr.includes(p.familia ?? '')) return false
      return true
    })
  }

  produtos = produtos.sort((a, b) => {
    const ma = margemValida(a.margem) ? Number(a.margem) : 99999
    const mb = margemValida(b.margem) ? Number(b.margem) : 99999
    return ma - mb
  })

  const colunas: ColunaExcel[] = [
    { key: 'familia', label: 'Família', tipo: 'texto', largura: 22 },
    { key: 'codigo', label: 'Código', tipo: 'texto' },
    { key: 'produto', label: 'Produto', tipo: 'texto', largura: 36 },
    { key: 'pdv', label: 'PDV (venda)', tipo: 'moeda' },
    { key: 'cmc', label: 'CMC (custo)', tipo: 'moeda' },
    { key: 'margem', label: 'Margem', tipo: 'texto' },
    { key: 'situacao', label: 'Situação', tipo: 'texto' },
  ]
  const planRows = produtos.map((p) => ({
    familia: p.familia ?? '',
    codigo: p.codigo,
    produto: p.descricao ?? p.codigo,
    pdv: p.pdv ?? 0,
    cmc: p.cmc ?? 0,
    margem: margemValida(p.margem) ? `${Number(p.margem).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-',
    situacao: margemValida(p.margem) ? 'OK' : 'CMC inválido (revisar no Omie)',
  }))

  const buffer = await gerarPlanilha(planRows, colunas, {
    titulo: 'Margem por produto',
    subtitulo: 'Produto acabado / venda PDV — margem do Omie',
    autoFiltro: true,
  })
  return planilhaResponse('margem-por-produto', buffer)
}
