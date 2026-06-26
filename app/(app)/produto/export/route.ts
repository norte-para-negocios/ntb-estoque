import { NextResponse } from 'next/server'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { labelTipoItem } from '@/lib/constants-omie'
import { gerarPlanilha, planilhaResponse } from '@/lib/excel'

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const params = {
    q: searchParams.get('q') || undefined,
    familia: searchParams.get('familia') || undefined,
    tipo: searchParams.get('tipo') || undefined,
    situacao: searchParams.get('situacao') || undefined,
    fornecedor: searchParams.get('fornecedor') || undefined,
  }

  // Filtro por fornecedor: códigos que a loja já comprou daquele fornecedor (NF).
  let codigosFornecedor: number[] | null = null
  if (params.fornecedor) {
    const { data } = await supabase.rpc('compras_produtos_do_fornecedor', {
      p_loja_id: lojaId,
      p_fornecedor: params.fornecedor,
    })
    codigosFornecedor = ((data ?? []) as { cod: number }[]).map((r) => Number(r.cod))
  }

  // Paginação interna para não truncar a exportação (PostgREST limita 1000 linhas).
  const PAGE_SIZE = 1000
  type Produto = {
    codigo: string | null
    codigo_produto: number | null
    descricao: string | null
    descricao_familia: string | null
    tipo_item: string | null
    unidade: string | null
    valor_unitario: number | null
    estoque_minimo: number | null
  }
  const produtos: Produto[] = []

  function buildQuery(from: number, to: number) {
    let q = supabase
      .from('produtos')
      .select('codigo, codigo_produto, descricao, descricao_familia, tipo_item, unidade, valor_unitario, estoque_minimo')
      .eq('loja_id', lojaId)
      .order('descricao')
      .range(from, to)

    if (params.q) {
      const term = escapeIlikeOr(params.q)
      q = q.or(`descricao.ilike.%${term}%,codigo.ilike.%${term}%`)
    }
    if (params.familia) q = q.eq('descricao_familia', params.familia)
    if (params.tipo) q = q.eq('tipo_item', params.tipo)
    if (codigosFornecedor !== null) q = q.in('codigo_produto', codigosFornecedor.length ? codigosFornecedor : [-1])
    if (!params.situacao || params.situacao === 'ativos') q = q.eq('inativo', false)
    else if (params.situacao === 'inativos') q = q.eq('inativo', true)

    return q
  }

  for (let pagina = 0; ; pagina++) {
    const from = pagina * PAGE_SIZE
    const { data: bloco } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (!bloco?.length) break
    produtos.push(...(bloco as Produto[]))
    if (bloco.length < PAGE_SIZE) break
  }

  // Buscar CMC e saldo das 2 fotos mais recentes (igual à lógica da tela de Produtos).
  const codigos = produtos.map((p) => p.codigo_produto).filter((c): c is number => c != null)
  const cmcMap = new Map<number, number>()
  const saldoMap = new Map<number, number>()

  if (codigos.length > 0) {
    const { data: ultima } = await supabase
      .from('posicao_estoques')
      .select('data_posicao')
      .eq('loja_id', lojaId)
      .order('data_posicao', { ascending: false })
      .limit(1)
      .maybeSingle()
    const dataPos = ultima?.data_posicao as string | undefined

    if (dataPos) {
      const { data: penultimaRow } = await supabase
        .from('posicao_estoques')
        .select('data_posicao')
        .eq('loja_id', lojaId)
        .lt('data_posicao', dataPos)
        .order('data_posicao', { ascending: false })
        .limit(1)
        .maybeSingle()
      const dataInicio = (penultimaRow?.data_posicao as string | undefined) ?? dataPos

      // Busca paginada das posições
      const LOTE = 1000
      const posicoes: { n_cod_prod: number; n_cmc: number | null; n_saldo: number | null; data_posicao: string }[] = []
      for (let off = 0; ; off += LOTE) {
        const { data } = await supabase
          .from('posicao_estoques')
          .select('n_cod_prod, n_cmc, n_saldo, data_posicao')
          .eq('loja_id', lojaId)
          .gte('data_posicao', dataInicio)
          .lte('data_posicao', dataPos)
          .in('n_cod_prod', codigos)
          .order('id', { ascending: true })
          .range(off, off + LOTE - 1)
        if (!data?.length) break
        posicoes.push(...(data as typeof posicoes))
        if (data.length < LOTE) break
      }

      // CMC: mais recente com valor > 0
      const cmcData = new Map<number, string>()
      for (const pos of posicoes) {
        if (!pos.n_cmc) continue
        const atual = cmcData.get(pos.n_cod_prod)
        if (!atual || pos.data_posicao > atual) {
          cmcMap.set(pos.n_cod_prod, Number(pos.n_cmc))
          cmcData.set(pos.n_cod_prod, pos.data_posicao)
        }
      }

      // Saldo: soma de todas as linhas da foto mais recente (locais diferentes)
      for (const pos of posicoes) {
        if (pos.data_posicao !== dataPos) continue
        const ant = saldoMap.get(pos.n_cod_prod) ?? 0
        saldoMap.set(pos.n_cod_prod, ant + Number(pos.n_saldo ?? 0))
      }
    }
  }

  const rows = produtos.map((p) => {
    const cmc = p.codigo_produto != null ? (cmcMap.get(p.codigo_produto) ?? 0) : 0
    const saldo = p.codigo_produto != null ? (saldoMap.get(p.codigo_produto) ?? 0) : 0
    const minimo = p.estoque_minimo ?? 0
    const sugestao = Math.max(0, minimo - saldo)
    const margem =
      cmc > 0 && (p.valor_unitario ?? 0) > 0
        ? parseFloat((((p.valor_unitario! - cmc) / p.valor_unitario!) * 100).toFixed(1))
        : null
    return {
      codigo: p.codigo || '-',
      descricao: formatarNomeProduto(p.descricao) || '-',
      familia: p.descricao_familia || '-',
      tipo: labelTipoItem(p.tipo_item),
      unidade: p.unidade || '-',
      valor: p.valor_unitario ?? 0,
      cmc,
      saldo,
      minimo,
      sugestao,
      margem: margem ?? '',
    }
  })

  const buffer = await gerarPlanilha(
    rows,
    [
      { key: 'codigo', label: 'Código', tipo: 'texto', largura: 12 },
      { key: 'descricao', label: 'Descrição', tipo: 'texto' },
      { key: 'familia', label: 'Família', tipo: 'texto' },
      { key: 'tipo', label: 'Tipo', tipo: 'texto', largura: 18 },
      { key: 'unidade', label: 'Unidade', tipo: 'texto', largura: 10 },
      { key: 'valor', label: 'Preço Venda', tipo: 'moeda', largura: 16 },
      { key: 'cmc', label: 'CMC', tipo: 'moeda', largura: 14 },
      { key: 'saldo', label: 'Saldo Atual', tipo: 'numero', largura: 14 },
      { key: 'minimo', label: 'Mínimo', tipo: 'numero', largura: 12 },
      { key: 'sugestao', label: 'Sugestão Compra', tipo: 'numero', largura: 16 },
      { key: 'margem', label: 'Margem %', tipo: 'numero', largura: 12 },
    ],
    { titulo: 'Produtos' },
  )

  return planilhaResponse('produtos.xlsx', buffer)
}
