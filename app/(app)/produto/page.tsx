import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao, isAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { SyncButton } from '@/components/SyncButton'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import type { CampoFiltro } from '@/components/ui-kit/Filtros'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { Money } from '@/components/ui-kit/Money'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { btnClass } from '@/components/ui-kit/Button'
import { MargemAlvoInput } from '@/components/produtos/MargemAlvoInput'
import { ExcluirProdutoBtn } from '@/components/produtos/ExcluirProdutoBtn'
import { EditarProdutoForm } from '@/components/produtos/EditarProdutoForm'
import { EstruturaProduto } from '@/components/produtos/EstruturaProduto'
import { EstoqueMinimoInput } from '@/components/produtos/EstoqueMinimoInput'
import { buscarFamilias } from '@/lib/actions/produto'
import { Num } from '@/components/ui-kit/Num'
import { formatQtdExata } from '@/lib/num-br'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { corMargem, TEXTO_CLASSE } from '@/lib/status-cor'
import { Package, Download, Plus } from 'lucide-react'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'

const POR_PAGINA = 100

type ProdutoLinha = {
  id: number
  codigo_produto: number | null
  codigo: string | null
  descricao: string | null
  codigo_familia: number | null
  descricao_familia: string | null
  tipo_item: string | null
  unidade: string | null
  ncm: string | null
  valor_unitario: number | null
  estoque_minimo: number | null
  inativo: boolean | null
}

function fmtTimestamp(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })
}

// Margem real = (venda - custo) / venda
function margem(venda: number | null, custo: number | null): number | null {
  if (!venda || !custo) return null
  return (venda - custo) / venda
}

// Preço necessário para atingir a margem alvo
function precoSugerido(custo: number | null, alvo: number): number | null {
  if (!custo || alvo >= 1) return null
  return custo / (1 - alvo)
}

export default async function ProdutoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; familia?: string; tipo?: string; situacao?: string; margem?: string; vista?: string; repor?: string; ord?: string; page?: string; fornecedor?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) notFound()

  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)
  // Dois modos para a tabela nao estourar a largura: precos x compras.
  const vista = params.vista === 'compras' ? 'compras' : 'precos'
  // "So repor": no modo Compras, mostra so os produtos abaixo do minimo (RPC).
  const repor = vista === 'compras' && params.repor === '1'
  const alvoPctRaw = Number(params.margem)
  const alvoPct = alvoPctRaw >= 1 && alvoPctRaw <= 99 ? alvoPctRaw : 50
  const alvo = alvoPct / 100
  const supabase = await createClient()
  // Sync (Atualizar tudo) virou admin-only: so o admin global ve o botao.
  const podeSync = await isAdmin()
  const podeCriar = await requirePermissao(lojaId, 'Produtos - Criar')
  const podeEditar = await requirePermissao(lojaId, 'Produtos - Editar')
  const podeExcluir = await requirePermissao(lojaId, 'Produtos - Excluir')

  // Independentes entre si -> rodam em paralelo para cortar latencia (Produtos
  // era a tela mais lenta). lojaSync, familias e os codigos "a repor" (modo
  // Compras) nao dependem da query principal de produtos.
  // Familias via RPC com DISTINCT no banco: evita o teto de 1000 do PostgREST
  // (que cortava familias do dropdown) e a varredura da tabela inteira a cada render.
  const [{ data: lojaSync }, { data: familiasRows }, reporCodigos, familiasComCodigo, fornecedoresList, fornecedorCodigos] = await Promise.all([
    supabase
      .from('lojas')
      .select('produto_ultima_atualizacao, produto_status')
      .eq('id', lojaId)
      .single(),
    supabase.rpc('familias_da_loja', { p_loja_id: lojaId }),
    repor
      ? supabase.rpc('produtos_repor', { p_loja_id: lojaId }).then(({ data }) => (data ?? []) as number[])
      : Promise.resolve<number[] | null>(null),
    // Familias com codigo+descricao para o select do form de edicao (o RPC acima so traz descricao).
    buscarFamilias(),
    // Fornecedores que a loja ja comprou (dropdown do filtro de sugestao por fornecedor).
    supabase.rpc('compras_fornecedores', { p_loja_id: lojaId }).then(({ data }) => (data ?? []) as { fornecedor: string }[]),
    // Codigos de produto comprados do fornecedor filtrado (so quando ha filtro).
    params.fornecedor
      ? supabase
          .rpc('compras_produtos_do_fornecedor', { p_loja_id: lojaId, p_fornecedor: params.fornecedor })
          .then(({ data }) => ((data ?? []) as { cod: number }[]).map((r) => Number(r.cod)))
      : Promise.resolve<number[] | null>(null),
  ])
  const familiasOpcoes = ((familiasRows ?? []) as { descricao_familia: string }[]).map((r) => ({
    value: r.descricao_familia,
    label: r.descricao_familia,
  }))

  // Ordenacao resolvida no banco (query paginada -> barato). Custo/margem/saldo
  // vem de mapas em memoria DEPOIS da paginacao, entao nao da pra ordenar por eles
  // aqui sem buscar tudo; ficam de fora. Default = descricao A-Z.
  const ord = params.ord ?? ''
  let query = supabase
    .from('produtos')
    .select('id, codigo_produto, codigo, descricao, codigo_familia, descricao_familia, tipo_item, unidade, ncm, valor_unitario, estoque_minimo, inativo')
    .eq('loja_id', lojaId)
  if (ord === 'descricao_za') query = query.order('descricao', { ascending: false })
  else if (ord === 'venda_asc') query = query.order('valor_unitario', { ascending: true, nullsFirst: false }).order('descricao')
  else if (ord === 'venda_desc') query = query.order('valor_unitario', { ascending: false, nullsFirst: false }).order('descricao')
  else query = query.order('descricao') // descricao_az (default)
  query = query.range((page - 1) * POR_PAGINA, page * POR_PAGINA)

  if (params.q) {
    const q = escapeIlikeOr(params.q)
    query = query.or(`descricao.ilike.%${q}%,codigo.ilike.%${q}%`)
  }
  if (params.familia) query = query.eq('descricao_familia', params.familia)
  if (params.tipo) query = query.eq('tipo_item', params.tipo)
  // situacao pela coluna `inativo` (migration 012). default: so ativos
  if (!params.situacao || params.situacao === 'ativos') query = query.eq('inativo', false)
  else if (params.situacao === 'inativos') query = query.eq('inativo', true)

  // Restrição por codigo_produto: "Só repor" (abaixo do mínimo) e/ou Fornecedor
  // (produtos que a loja já comprou daquele fornecedor). Com os dois, interseção.
  let restricaoCods: number[] | null = null
  if (repor) restricaoCods = reporCodigos ?? []
  if (params.fornecedor) {
    const fc = fornecedorCodigos ?? []
    restricaoCods = restricaoCods === null ? fc : restricaoCods.filter((c) => fc.includes(c))
  }
  if (restricaoCods !== null) {
    query = query.in('codigo_produto', restricaoCods.length ? restricaoCods : [-1])
  }

  const { data: produtosRaw } = await query
  const temProxima = (produtosRaw?.length ?? 0) > POR_PAGINA
  const produtos = temProxima ? produtosRaw!.slice(0, POR_PAGINA) : produtosRaw

  // CMC consolidado por produto (registro de maior saldo entre locais)
  const codigos = [...new Set((produtos ?? []).map((p) => p.codigo_produto).filter(Boolean))]
  type PosicaoRow = {
    n_cod_prod: number
    n_cmc: number | null
    n_saldo: number | null
    estoque_minimo: number | null
    data_posicao: string
  }
  // So a foto mais recente: pega a ultima data_posicao da loja e filtra por ela.
  // Sem isso, a consulta cresceria com o historico e bateria no teto de 1000
  // linhas do PostgREST, truncando e subcontando saldo/minimo. Pagina por
  // seguranca (uma loja pode ter muitos locais), igual ao /produto/export.
  const posicoes: PosicaoRow[] = []
  // Minimo do Omie e ESPARSO: so aparece nas fotos CONSOLIDADAS (a foto do dia, e
  // ate algumas fotos intermediarias, vem sem minimo). Por isso ele e buscado a
  // parte (estoque_minimo>0) numa janela ampla, pra achar a foto mais recente que
  // realmente tem o minimo de cada produto -- senao lojas com fotos recentes sem
  // minimo (ex.: Rio Vermelho: 19/06 e 18/06 sem minimo, 16/06 com) zeravam.
  const minimoRows: PosicaoRow[] = []
  async function carregarPosicoes() {
    if (!codigos.length) return
    const { data: ultima } = await supabase
      .from('posicao_estoques')
      .select('data_posicao')
      .eq('loja_id', lojaId)
      .order('data_posicao', { ascending: false })
      .limit(1)
      .maybeSingle()
    const dataPos = ultima?.data_posicao as string | undefined
    if (!dataPos) return
    // Pega as DUAS fotos mais recentes (nao necessariamente dias consecutivos).
    // A foto do dia corrente as vezes vem sem CMC (o Omie so fecha o custo no
    // fim do dia), entao o custo cai pra foto anterior. Calcular "ontem" como
    // dataPos-1 falha quando uma loja ficou um dia sem sync: o slot do dia
    // anterior fica vazio e a foto com CMC cai fora do intervalo. Buscamos a
    // penultima data REAL (maior data < dataPos) para montar o intervalo correto.
    const { data: penultimaRow } = await supabase
      .from('posicao_estoques')
      .select('data_posicao')
      .eq('loja_id', lojaId)
      .lt('data_posicao', dataPos)
      .order('data_posicao', { ascending: false })
      .limit(1)
      .maybeSingle()
    // Se so existe uma foto, usa ela como limite inferior tambem (sem perda).
    const dataInicio = (penultimaRow?.data_posicao as string | undefined) ?? dataPos
    const LOTE = 1000
    for (let off = 0; ; off += LOTE) {
      const { data } = await supabase
        .from('posicao_estoques')
        .select('n_cod_prod, n_cmc, n_saldo, estoque_minimo, data_posicao')
        .eq('loja_id', lojaId)
        .gte('data_posicao', dataInicio)
        .lte('data_posicao', dataPos)
        .in('n_cod_prod', codigos)
        // Desempate por PK: sem ele, paginar (>1000 linhas) ordenando por coluna
        // não-única (n_saldo, com muitos empates em 0) pula/duplica linhas entre
        // páginas e corrompe a SOMA do saldo/CMC. A ordem em si é irrelevante (tudo é somado).
        .order('id', { ascending: true })
        .range(off, off + LOTE - 1)
      if (!data || !data.length) break
      posicoes.push(...(data as PosicaoRow[]))
      if (data.length < LOTE) break
    }
    // Busca DEDICADA do minimo: estoque_minimo>0, janela ampla (ate ~90 dias atras
    // de dataPos), pois o minimo pode estar numa foto consolidada anterior a janela
    // do saldo/CMC. Esparso (poucos produtos tem minimo), entao a consulta e leve.
    const cutoffMin = new Date(new Date(dataPos).getTime() - 90 * 86400000)
      .toISOString()
      .slice(0, 10)
    for (let off = 0; ; off += LOTE) {
      const { data } = await supabase
        .from('posicao_estoques')
        .select('n_cod_prod, n_cmc, n_saldo, estoque_minimo, data_posicao')
        .eq('loja_id', lojaId)
        .gt('estoque_minimo', 0)
        .gte('data_posicao', cutoffMin)
        .in('n_cod_prod', codigos)
        // Desempate por PK (data_posicao não é única) para a paginação não pular linhas;
        // a data mais recente por produto é resolvida depois no minOmieMap, não pela ordem.
        .order('data_posicao', { ascending: false })
        .order('id', { ascending: true })
        .range(off, off + LOTE - 1)
      if (!data || !data.length) break
      minimoRows.push(...(data as PosicaoRow[]))
      if (data.length < LOTE) break
    }
  }

  // Posicoes e previsao de venda so dependem de `codigos` e sao independentes
  // entre si: carregam em paralelo para cortar latencia.
  const [, previsaoRes] = await Promise.all([
    carregarPosicoes(),
    codigos.length
      ? supabase.from('previsao_venda').select('n_cod_prod, qtde').eq('loja_id', lojaId).in('n_cod_prod', codigos)
      : Promise.resolve({ data: [] as { n_cod_prod: number; qtde: number | null }[] }),
  ])
  // Custo = CMC nao-zero da foto MAIS RECENTE que tiver (hoje pode vir sem custo,
  // entao cai pra ontem). Guarda {cmc, data} e mantem o de data maior.
  const cmcMap = new Map<number, { cmc: number; data: string }>()
  for (const pos of posicoes ?? []) {
    if (!pos.n_cmc) continue
    const atual = cmcMap.get(pos.n_cod_prod)
    if (!atual || (pos.data_posicao && pos.data_posicao > atual.data)) {
      cmcMap.set(pos.n_cod_prod, { cmc: Number(pos.n_cmc), data: pos.data_posicao })
    }
  }
  const custoDe = (codProd: number | null): number | null =>
    codProd != null ? cmcMap.get(codProd)?.cmc ?? null : null

  // Estoque atual = soma dos saldos dos locais na data de posicao mais recente de cada produto.
  const dataMaxPorProduto = new Map<number, string>()
  for (const pos of posicoes ?? []) {
    const atual = dataMaxPorProduto.get(pos.n_cod_prod)
    if (!atual || (pos.data_posicao && pos.data_posicao > atual)) {
      dataMaxPorProduto.set(pos.n_cod_prod, pos.data_posicao)
    }
  }
  const saldoMap = new Map<number, number>()
  for (const pos of posicoes ?? []) {
    if (pos.data_posicao === dataMaxPorProduto.get(pos.n_cod_prod)) {
      saldoMap.set(pos.n_cod_prod, (saldoMap.get(pos.n_cod_prod) ?? 0) + Number(pos.n_saldo ?? 0))
    }
  }
  const saldoDe = (codProd: number | null): number | null =>
    codProd != null && saldoMap.has(codProd) ? saldoMap.get(codProd)! : null

  // Estoque minimo do Omie. ATENCAO: a foto do dia corrente as vezes vem SEM
  // minimo (o Omie so consolida a posicao no fim do dia), igual acontece com o
  // CMC. Por isso NAO usamos a foto mais recente em geral (dataMaxPorProduto):
  // usamos, por produto, a foto mais recente que REALMENTE tem minimo, somando
  // os minimos dos locais nessa data. Sem isso, lojas cuja foto de hoje veio sem
  // minimo (ex.: Rio Vermelho) mostravam minimo 0 indevidamente.
  const dataMinPorProduto = new Map<number, string>()
  for (const pos of minimoRows) {
    const atual = dataMinPorProduto.get(pos.n_cod_prod)
    if (!atual || (pos.data_posicao && pos.data_posicao > atual)) {
      dataMinPorProduto.set(pos.n_cod_prod, pos.data_posicao)
    }
  }
  const minOmieMap = new Map<number, number>()
  for (const pos of minimoRows) {
    if (pos.data_posicao === dataMinPorProduto.get(pos.n_cod_prod)) {
      minOmieMap.set(pos.n_cod_prod, (minOmieMap.get(pos.n_cod_prod) ?? 0) + Number(pos.estoque_minimo ?? 0))
    }
  }
  const minOmieDe = (codProd: number | null): number | null =>
    codProd != null && minOmieMap.has(codProd) ? minOmieMap.get(codProd)! : null
  // Minimo efetivo: override manual (produtos.estoque_minimo) tem prioridade; senao o do Omie.
  const minEfetivo = (p: ProdutoLinha): number | null =>
    p.estoque_minimo != null ? Number(p.estoque_minimo) : minOmieDe(p.codigo_produto)

  // Previsao de venda (saidas no mesmo periodo do ano anterior) por produto.
  // Carregada em paralelo com as posicoes (acima).
  const previsoes = previsaoRes.data
  const prevMap = new Map<number, number>()
  for (const pv of previsoes ?? []) prevMap.set(pv.n_cod_prod, Number(pv.qtde ?? 0))
  const prevVendaDe = (codProd: number | null): number | null =>
    codProd != null && prevMap.has(codProd) ? prevMap.get(codProd)! : null

  const exportParams = new URLSearchParams()
  if (params.q) exportParams.set('q', params.q)
  if (params.familia) exportParams.set('familia', params.familia)
  if (params.tipo) exportParams.set('tipo', params.tipo)
  if (params.fornecedor) exportParams.set('fornecedor', params.fornecedor)
  if (params.situacao) exportParams.set('situacao', params.situacao)
  // ord viaja junto para que trocar vista/margem/repor preserve a ordenacao.
  // O export (CSV) ignora o param; sem efeito colateral.
  if (params.ord) exportParams.set('ord', params.ord)

  const margemParams = new URLSearchParams(exportParams.toString())

  const campos: CampoFiltro[] = [
    { tipo: 'texto', nome: 'q', label: 'Nome ou código' },
    { tipo: 'select', nome: 'familia', label: 'Família', opcoes: familiasOpcoes },
    { tipo: 'select', nome: 'tipo', label: 'Tipo', opcoes: PRODUTO_TIPO_ITEM },
    { tipo: 'select', nome: 'fornecedor', label: 'Fornecedor (já comprado)', opcoes: fornecedoresList.map((f) => ({ value: f.fornecedor, label: f.fornecedor })) },
    {
      tipo: 'select',
      nome: 'situacao',
      label: 'Situação',
      opcoes: [
        { value: 'ativos', label: 'Somente ativos' },
        { value: 'inativos', label: 'Somente inativos' },
        { value: 'todos', label: 'Todos' },
      ],
    },
    {
      tipo: 'select',
      nome: 'ord',
      label: 'Ordenar por',
      opcoes: [
        { value: 'descricao_az', label: 'Descrição A-Z' },
        { value: 'descricao_za', label: 'Descrição Z-A' },
        { value: 'venda_desc', label: 'Maior preço de venda' },
        { value: 'venda_asc', label: 'Menor preço de venda' },
      ],
    },
  ]

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Produtos"
          icon={Package}
          actions={
            <>
              <FiltrosGaveta
                basePath="/produto"
                campos={campos}
                defaults={{ q: params.q ?? '', familia: params.familia ?? '', tipo: params.tipo ?? '', fornecedor: params.fornecedor ?? '', situacao: params.situacao ?? 'ativos', ord: params.ord ?? '' }}
                persistirEm="/produto"
              />
              {podeCriar && (
                <Link href="/produto/novo" className={btnClass('primary')}>
                  <Plus className="size-4" /> Novo produto
                </Link>
              )}
              <a href={`/produto/export?${exportParams.toString()}`} className={btnClass('outline')}>
                <Download className="size-4" /> Excel
              </a>
              {podeSync && (
                <SyncButton
                  endpoints={['/api/sync/produtos', '/api/sync/posicao', '/api/sync/previsao-venda']}
                  label="Atualizar tudo"
                />
              )}
            </>
          }
        />
        <ChipsFiltrosAtivos basePath="/produto" campos={campos} naoMostrar={['ord']} persistirEm="/produto" />
      </ListaHeader>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] text-text-muted">
          <span>Atualizado em {fmtTimestamp(lojaSync?.produto_ultima_atualizacao ?? null)}</span>
          <span>·</span>
          <StatusPill status={lojaSync?.produto_status ?? null} />
        </div>
        <div className="flex items-center gap-3">
          {/* Modo da tabela: precos x compras (evita estourar a largura) */}
          <div className="inline-flex rounded-md border border-border bg-surface p-0.5 text-[13px]">
            {(['precos', 'compras'] as const).map((v) => {
              const sp = new URLSearchParams(exportParams.toString())
              if (params.margem) sp.set('margem', params.margem)
              sp.set('vista', v)
              const ativo = v === vista
              return (
                <Link
                  key={v}
                  href={`/produto?${sp.toString()}`}
                  className={`rounded px-3 py-1 font-medium transition-colors ${ativo ? 'bg-brand text-white' : 'text-text-muted hover:text-text'}`}
                >
                  {v === 'precos' ? 'Preços' : 'Compras'}
                </Link>
              )
            })}
          </div>
          {vista === 'precos' && (
            <MargemAlvoInput valor={alvoPct} baseParams={margemParams.toString()} naUrl={!!params.margem} />
          )}
          {vista === 'compras' &&
            (() => {
              const sp = new URLSearchParams(exportParams.toString())
              sp.set('vista', 'compras')
              if (!repor) sp.set('repor', '1')
              return (
                <Link
                  href={`/produto?${sp.toString()}`}
                  className={`rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    repor
                      ? 'border-brand bg-brand text-white'
                      : 'border-border bg-surface text-text-muted hover:text-text'
                  }`}
                >
                  Só repor
                </Link>
              )
            })()}
        </div>
      </div>

      <Lista
        linhas={produtos ?? []}
        chaveLinha={(p) => p.id}
        colunas={[
          {
            label: 'Código',
            larguraDesktop: 'w-24',
            render: (p) => <span className="num text-text-muted">{p.codigo}</span>,
          },
          {
            label: 'Descrição',
            primaria: true,
            flexivel: true,
            render: (p) => <span>{formatarNomeProduto(p.descricao)}</span>,
          },
          ...(vista === 'precos'
            ? [
                {
                  label: 'Custo',
                  alinhar: 'right' as const,
                  larguraDesktop: 'w-28',
                  ocultarMobile: true,
                  render: (p: ProdutoLinha) => {
                    const c = custoDe(p.codigo_produto)
                    return c != null ? <Money value={c} /> : <span className="text-text-muted">-</span>
                  },
                },
                { label: 'Venda', alinhar: 'right' as const, larguraDesktop: 'w-28', render: (p: ProdutoLinha) => <Money value={p.valor_unitario} /> },
                {
                  label: 'Margem',
                  alinhar: 'right' as const,
                  larguraDesktop: 'w-24',
                  ocultarMobile: true,
                  render: (p: ProdutoLinha) => {
                    const m = margem(p.valor_unitario, custoDe(p.codigo_produto))
                    if (m == null) return <span className="text-text-muted">-</span>
                    return (
                      <span className={`num font-medium ${TEXTO_CLASSE[corMargem(m)]}`}>
                        {(m * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%
                      </span>
                    )
                  },
                },
                {
                  label: `Sugerido (${alvoPct}%)`,
                  alinhar: 'right' as const,
                  larguraDesktop: 'w-32',
                  ocultarMobile: true,
                  render: (p: ProdutoLinha) => {
                    // Sem preco de venda nao da sugestao (pedido do fundador 17/06).
                    const s = Number(p.valor_unitario) > 0 ? precoSugerido(custoDe(p.codigo_produto), alvo) : null
                    return s != null ? <span className="text-text-muted"><Money value={s} /></span> : <span className="text-text-muted">-</span>
                  },
                },
              ]
            : [
                {
                  label: 'Mínimo',
                  alinhar: 'right' as const,
                  larguraDesktop: 'w-24',
                  ocultarMobile: true,
                  render: (p: ProdutoLinha) => (
                    <EstoqueMinimoInput
                      produtoId={p.id}
                      valorManual={p.estoque_minimo}
                      valorOmie={minOmieDe(p.codigo_produto)}
                      podeEditar={podeEditar}
                    />
                  ),
                },
                {
                  label: 'Atual',
                  alinhar: 'right' as const,
                  larguraDesktop: 'w-20',
                  render: (p: ProdutoLinha) => {
                    const saldo = saldoDe(p.codigo_produto)
                    if (saldo == null) return <span className="text-text-muted">-</span>
                    const min = minEfetivo(p)
                    // Vermelho quando: passou do minimo (saldo <= min, com min>0) OU saldo
                    // NEGATIVO (sempre errado, mesmo sem minimo definido — Omie traz min=0
                    // como "sem politica"; negativo passou do minimo de qualquer jeito).
                    const baixo = saldo < 0 || (min != null && min > 0 && saldo <= min)
                    // Quantidade EXATA do Omie (sem arredondar): 0,0139203299 aparece inteiro.
                    return <span className={`num ${baixo ? 'font-semibold text-err' : 'text-text'}`}>{formatQtdExata(saldo)}</span>
                  },
                },
                {
                  label: 'Prev. venda',
                  alinhar: 'right' as const,
                  larguraDesktop: 'w-24',
                  ocultarMobile: true,
                  render: (p: ProdutoLinha) => {
                    const pv = prevVendaDe(p.codigo_produto)
                    if (pv == null) return <span className="text-text-muted">-</span>
                    return <span className="num text-text-muted">{formatQtdExata(pv)}</span>
                  },
                },
                {
                  label: 'Comprar',
                  alinhar: 'right' as const,
                  larguraDesktop: 'w-20',
                  render: (p: ProdutoLinha) => {
                    const saldo = saldoDe(p.codigo_produto)
                    const min = minEfetivo(p)
                    // sem minimo (null) ou minimo 0 = nao sugere compra (evita poluir a base nao configurada).
                    if (saldo == null || min == null || min <= 0) return <span className="text-text-muted">-</span>
                    // compra = minimo + previsao de venda - estoque atual
                    const prev = prevVendaDe(p.codigo_produto) ?? 0
                    const comprar = Math.max(0, min + prev - saldo)
                    if (comprar <= 0) return <span className="text-ok">ok</span>
                    return <span className="num font-semibold text-brand">{formatQtdExata(comprar)}</span>
                  },
                },
              ]),
        ]}
        acao={(p) =>
          p.codigo_produto != null ? (
            <div className="flex items-center justify-end gap-1">
              {podeEditar && (
                <EditarProdutoForm
                  produto={{
                    id: p.id,
                    codigo: p.codigo,
                    descricao: p.descricao,
                    codigoFamilia: p.codigo_familia,
                    tipoItem: p.tipo_item,
                    unidade: p.unidade,
                    ncm: p.ncm,
                    valorUnitario: p.valor_unitario,
                    estoqueMinimo: p.estoque_minimo,
                    inativo: !!p.inativo,
                  }}
                  familias={familiasComCodigo}
                />
              )}
              <EstruturaProduto
                codigoProduto={p.codigo_produto}
                descricao={formatarNomeProduto(p.descricao)}
              />
              {podeExcluir && <ExcluirProdutoBtn codigoProduto={p.codigo_produto} />}
            </div>
          ) : null
        }
        vazio={
          <EmptyState
            icon={Package}
            title="Nenhum produto"
            hint="Sincronize com o Omie ou ajuste a busca."
          />
        }
      />

      {(page > 1 || temProxima) && (
        <Paginacao basePath="/produto" page={page} temProxima={temProxima} />
      )}
    </div>
  )
}
