import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { ehDesenvolvedor } from '@/lib/recursos-dev'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { ItensNotaFiscal, type ItemNF } from '@/components/nota-fiscal/ItensNotaFiscal'
import { btnClass } from '@/components/ui-kit/Button'
import { FileText, Download, Printer } from 'lucide-react'
import { complementarNotasFiscais, complementarNotaFiscalItems } from '@/lib/historico-contabo'
import { statusNF } from '@/lib/nf-status'
import { FUNDO_CLASSE } from '@/lib/status-cor'
import { DetalhesFiscaisNF } from '@/components/nota-fiscal/DetalhesFiscaisNF'
import { AcoesNF } from '@/components/nota-fiscal/AcoesNF'
import { OPsRelacionadasNF } from '@/components/nota-fiscal/OPsRelacionadasNF'
import { MovimentosDaNota } from '@/components/nota-fiscal/MovimentosDaNota'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { HistoricoStatusNF } from '@/components/nota-fiscal/HistoricoStatusNF'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { OrigemSefazNF } from '@/components/nota-fiscal/OrigemSefazNF'
import { EntradasGeradasNF } from '@/components/nota-fiscal/EntradasGeradasNF'
import { ObservacaoNF } from '@/components/nota-fiscal/ObservacaoNF'
import { ManifestacaoNF } from '@/components/nota-fiscal/ManifestacaoNF'
import { FreteCteNF } from '@/components/nota-fiscal/FreteCteNF'
import { HistoricoProcessamentoNF } from '@/components/nota-fiscal/HistoricoProcessamentoNF'
import { carregarConferencia } from './dados-proprio'
import { carregarPedidoDaNota } from './dados-pedido'
import { PedidoDaNotaNF } from '@/components/nota-fiscal/PedidoDaNotaNF'
import { DevolucaoFornecedorNF } from '@/components/nota-fiscal/DevolucaoFornecedorNF'
import { carregarDevolucoesDaNota } from '@/lib/compras/devolucao-loader'
import { nfesDasOrigens } from '@/lib/nfe-saida/loader'
import { tpAmbDaNfe } from '@/lib/nfe-saida/ambiente'
import { refsDaEntrada } from '@/lib/estoque/nf-entrada'
import { HistoricoAlteracoes } from '@/components/historico/HistoricoAlteracoes'
import { AnexosRegistro } from '@/components/anexos/AnexosRegistro'
import { ClassificarNotaNF } from '@/components/nota-fiscal/ClassificarNotaNF'
import { SecoesNota, type SecaoNota } from '@/components/nota-fiscal/SecoesNota'
import { PainelEntrada } from '@/components/nota-fiscal/PainelEntrada'
import { MenuNota } from '@/components/nota-fiscal/MenuNota'
import { ConferenciaNF, PainelEntradaProprio } from '@/components/nota-fiscal/ConferenciaNF'
import { DialogImprimirEtiqueta } from '@/components/etiqueta/DialogImprimirEtiqueta'
import { QuantidadeInput } from '@/components/nota-fiscal/QuantidadeInput'
import { CategoriaContabilSelect } from '@/components/nota-fiscal/CategoriaContabilSelect'
import { fmtCnpj, resumosDaNota, totaisDaNota, totalDoItem } from '@/lib/nota-fiscal/tela-nota'
import { BarraConcluirNF } from '@/components/nota-fiscal/BarraConcluirNF'

export default async function NotaFiscalItensPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) notFound()

  // Permissoes de acao por botao (mesmo padrao de ordem-producao/page.tsx) --
  // as 3 Server Actions chamam a API real da Omie, entao precisam de
  // permissao propria, separada da de so acessar/ver a tela.
  const podeManifestar = await requirePermissao(lojaId, 'Notas Fiscais - Manifestar')
  const podeReverter = await requirePermissao(lojaId, 'Notas Fiscais - Reverter')
  const podeExcluir = await requirePermissao(lojaId, 'Notas Fiscais - Excluir')
  const podeManifestarSefaz = await requirePermissao(lojaId, 'Notas Fiscais - Manifestar na SEFAZ')

  const { id } = await params
  const supabase = await createClient()
  // Loja de estoque proprio: sem Omie (DANFE/eventos/OPs do Omie somem); entram a conferencia com o cadastro e as entradas do estoque.
  const proprio = (await modoDaLoja(lojaId)) === 'proprio'

  const { data: nfSupabase } = await supabase
    .from('notas_fiscais')
    .select('id, c_numero_nfe, c_serie_nfe, c_razao_social, c_nome, c_cnpj_cpf, c_chave_nfe, d_emissao_nfe, n_valor_nfe, c_etapa, n_id_receb, full_object, origem')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .is('deleted_at', null)
    .maybeSingle()

  const nf = nfSupabase ?? (await complementarNotasFiscais([], { lojaId, id: Number(id) }))[0] ?? null

  if (!nf) notFound()

  const [{ data: itensRaw }, { data: categorias }] = await Promise.all([
    supabase
      .from('nota_fiscal_items')
      .select('id, n_id_receb, n_sequencia, n_id_produto, c_codigo_produto, c_descricao_produto, c_cfop, n_qtde_nfe, c_unidade_nfe, n_preco_unit, v_total_item, quantidade, categoria_contabil_id, full_object')
      .eq('nota_fiscal_id', id)
      .eq('loja_id', lojaId)
      .order('n_sequencia'),
    supabase
      .from('categorias_contabeis')
      .select('id, nome, codigo')
      .eq('loja_id', lojaId)
      .eq('ativa', true)
      .order('nome'),
  ])

  const itens = nfSupabase
    ? itensRaw
    : await complementarNotaFiscalItems(itensRaw ?? [], { lojaId, notaFiscalId: Number(id) })

  // Dados derivados pras 3 secoes novas (Task 19): produto da NF -> OPs
  // relacionadas / movimentacoes geradas. n_id_produto e o mesmo espaco de
  // codigo Omie que ordens_producao.full_object.itensDetalhes[].nIdProdutoMalha
  // e movimentos.id_prod (confirmado na Task 17 -- ver task-17-report.md,
  // "Pergunta 2"/"Pergunta 3"). codigo_local_estoque vem de
  // full_object.itensAjustes.codigo_local_estoque, POR ITEM (nao por NF --
  // confirmado ao vivo que cada linha de nota_fiscal_items tem seu proprio
  // full_object.itensAjustes com o local daquele item especifico).
  type ItemComFullObject = { n_id_produto: number | null; c_descricao_produto: string | null; n_qtde_nfe: number | null; full_object: unknown }
  const itensParaCruzamento = (itens ?? []) as unknown as ItemComFullObject[]
  const produtoCodes = [...new Set(itensParaCruzamento.map((i) => i.n_id_produto).filter((v): v is number => v != null))]
  const itensComLocal = itensParaCruzamento
    .filter((i): i is ItemComFullObject & { n_id_produto: number } => i.n_id_produto != null)
    .map((i) => {
      const ajustes = (i.full_object as { itensAjustes?: { codigo_local_estoque?: number | string } } | null)?.itensAjustes
      const localRaw = ajustes?.codigo_local_estoque
      return {
        n_id_produto: i.n_id_produto,
        codigo_local_estoque: localRaw != null ? Number(localRaw) : null,
        descricao: i.c_descricao_produto,
        quantidade: Number(i.n_qtde_nfe) || 0,
      }
    })

  // Mesma fonte unica de status usada no selo abaixo (lib/nf-status.ts):
  // c_etapa === '60' sozinho NAO significa "concluida" de verdade -- uma nota
  // pode estar em c_etapa='60' E cancelada ao mesmo tempo. Os botoes de acao
  // (AcoesNF) usam este calculo, nunca a prop crua c_etapa.
  const statusInfo = nf.c_etapa ? statusNF(nf.c_etapa, nf.full_object) : null
  const concluida = statusInfo?.label === 'Concluída'
  const cancelada = statusInfo?.label === 'Cancelada'
  const conferencia = proprio && nfSupabase ? await carregarConferencia(lojaId, Number(id), nf.full_object, nf.c_chave_nfe ?? null) : null
  // Fase C (só estoque próprio): pedido de compra da nota e conferência pedido × nota × recebido
  // Pedido de compra e devolução ao fornecedor ainda são só de desenvolvedor (lib/recursos-dev.ts)
  const dev = await ehDesenvolvedor()
  const pedidoDaNota = dev && conferencia?.compra && conferencia.compra.status !== 'cancelada' ? await carregarPedidoDaNota(lojaId, conferencia.compra.id) : null
  // mesma regra da ação vincularNotaAoPedido: 'Compras - Pedidos' e 'Notas Fiscais'
  const podeVincularPedido = !!pedidoDaNota && (await requirePermissao(lojaId, 'Compras - Pedidos')) && (await requirePermissao(lojaId, 'Notas Fiscais'))
  // Fase F [H1] (só estoque próprio): devolução ao fornecedor dos itens que entraram no estoque, sem NF-e
  const devolucoes = dev && conferencia?.compra && ['lancada', 'parcial'].includes(conferencia.compra.status) ? await carregarDevolucoesDaNota(lojaId, conferencia.compra.id) : null
  const podeDevolver = !!devolucoes && (await requirePermissao(lojaId, 'Compras - Devolucao ao fornecedor'))
  // Fase F [F1]: NF-e de devolução de cada devolução registrada (sem a migration 260 o painel some)
  const nfesDev = devolucoes?.devolucoes.length ? await nfesDasOrigens(lojaId, 'devolucao', devolucoes.devolucoes.map((d) => d.id)) : null
  const podeNfe = !!nfesDev && (await requirePermissao(lojaId, 'Compras - Emitir NF-e'))

  function fmtData(d: string | null) {
    if (!d) return null
    const [y, m, dia] = d.slice(0, 10).split('-')
    return `${dia}/${m}/${y}`
  }

  const { data: locaisLoja } = conferencia ? { data: null } : await supabase.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId)
  const nomesLocais = conferencia
    ? Object.fromEntries(conferencia.locais.map((l) => [l.codigo, l.descricao]))
    : Object.fromEntries((locaisLoja ?? []).map((l) => [Number(l.codigo_local_estoque), l.descricao as string]))
  const itensNF = (itens ?? []) as ItemNF[]
  // Categoria da nota = a dos itens quando todos coincidem; itens com categorias diferentes viram "várias".
  const idsCategoria = new Set(itensNF.map((i) => i.categoria_contabil_id))
  const categoriaUnica = idsCategoria.size === 1 ? ([...idsCategoria][0] ?? null) : null
  const categoriaMista = idsCategoria.size > 1 && !idsCategoria.has(null)
  // Loja com Omie: a nota já chega com a categoria de compra do Omie (ex.: 2.01.85). Ela vale; não se pede outra.
  const codCategOmie = (nf.full_object as { infoAdicionais?: { cCategCompra?: string } } | null)?.infoAdicionais?.cCategCompra || null
  const categoriaOmie = !proprio && codCategOmie ? { codigo: codCategOmie, nome: (categorias ?? []).find((c) => c.codigo === codCategOmie)?.nome ?? null } : null
  const faltaCategoria = !categoriaOmie && (categorias ?? []).length > 0 && itensNF.some((i) => i.categoria_contabil_id == null)
  const podeCriarCategoria = await requirePermissao(lojaId, 'Categorias Contabeis - Criar')
  const semProdutoOmie = itensNF.filter((i) => i.n_id_produto == null).length
  const faltasOmie = [
    ...(semProdutoOmie > 0 ? [`${semProdutoOmie} ${semProdutoOmie === 1 ? 'item sem produto ligado' : 'itens sem produto ligado'}`] : []),
    ...(faltaCategoria ? ['escolher a categoria da nota'] : []),
  ]
  // Categoria sugerida (loja própria, nota sem categoria): a mais usada nas últimas notas do mesmo fornecedor.
  let sugestaoCategoria: { id: number; nome: string; motivo: string } | null = null
  const cnpjForn = (nf as { c_cnpj_cpf?: string | null }).c_cnpj_cpf ?? null
  if (proprio && faltaCategoria && cnpjForn) {
    const { data: outras } = await supabase.from('notas_fiscais').select('id').eq('loja_id', lojaId).eq('c_cnpj_cpf', cnpjForn).neq('id', Number(id)).is('deleted_at', null).order('id', { ascending: false }).limit(5)
    const ids = (outras ?? []).map((o) => o.id)
    if (ids.length) {
      const { data: cats } = await supabase.from('nota_fiscal_items').select('categoria_contabil_id').eq('loja_id', lojaId).in('nota_fiscal_id', ids).not('categoria_contabil_id', 'is', null).limit(500)
      const conta = new Map<number, number>()
      for (const c of cats ?? []) conta.set(Number(c.categoria_contabil_id), (conta.get(Number(c.categoria_contabil_id)) ?? 0) + 1)
      const [melhor] = [...conta.entries()].sort((a, b) => b[1] - a[1])
      const cat = melhor && (categorias ?? []).find((c) => c.id === melhor[0])
      if (cat) sugestaoCategoria = { id: cat.id, nome: cat.nome, motivo: `É a categoria das últimas notas deste fornecedor (${ids.length === 1 ? '1 nota' : `${ids.length} notas`}).` }
    }
  }

  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const somaItens = itensNF.reduce((a, i) => a + (totalDoItem(i) ?? 0), 0)
  const totais = totaisDaNota(nf.full_object, nf.n_valor_nfe != null ? Number(nf.n_valor_nfe) : null, somaItens)
  const nomeFornecedor = nf.c_razao_social || nf.c_nome || null
  const resumos = resumosDaNota(nf.full_object, nomeFornecedor, proprio)
  const nomesCategoriaOmie = Object.fromEntries((categorias ?? []).filter((c) => c.codigo).map((c) => [c.codigo as string, c.nome]))
  const base = `/nota-fiscal/${id}/imprimir`
  const blocoCategoria = !cancelada ? (
    <ClassificarNotaNF compacto notaId={Number(id)} categorias={categorias ?? []} categoriaAtual={categoriaUnica} mista={categoriaMista} categoriaOmie={categoriaOmie}
      editavel={!!nfSupabase && (proprio ? podeManifestar : podeManifestar && !concluida)} podeCriar={podeCriarCategoria} sugestao={sugestaoCategoria} />
  ) : null

  // Loja própria: etiqueta e categoria de cada item ficam na linha dele (o item da nota casa pela linha = n_sequencia).
  const itemPorLinha = new Map(itensNF.map((i) => [Number((i as { n_sequencia?: number }).n_sequencia ?? 0), i]))
  const extrasProprio = conferencia
    ? Object.fromEntries(conferencia.itens.map((ci) => {
        const it = itemPorLinha.get(ci.linha)
        if (!it) return [ci.linha, null]
        return [ci.linha, (
          <details key={ci.linha} className="text-[13px] [&[open]>summary]:mb-2">
            <summary className="cursor-pointer list-none text-text-muted hover:text-text [&::-webkit-details-marker]:hidden">Etiqueta e categoria deste item ›</summary>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[var(--r-md)] bg-surface-2 p-3">
              {(categorias ?? []).length > 0 && <span className="inline-flex items-center gap-2 text-text-muted">Categoria <CategoriaContabilSelect itemId={it.id} valorInicial={it.categoria_contabil_id} categorias={categorias ?? []} /></span>}
              <span className="inline-flex items-center gap-2 text-text-muted">Qtd para etiqueta <QuantidadeInput itemId={it.id} valorInicial={it.quantidade} /></span>
              <DialogImprimirEtiqueta href={`${base}?itens=${it.id}`} trigger={<button type="button" className={btnClass('outline')}><Printer className="size-4" />Imprimir etiqueta</button>} />
            </div>
          </details>
        )]
      }))
    : undefined

  const pf = (parte: Parameters<typeof DetalhesFiscaisNF>[0]['so']) => <DetalhesFiscaisNF fullObject={nf.full_object} semOmie={proprio} so={parte} />
  const comuns = {
    fornecedor: { id: 'fornecedor', titulo: 'Fornecedor', resumo: resumos.fornecedor, conteudo: pf('fornecedor') },
    transporte: resumos.transporte ? { id: 'transporte', titulo: 'Transporte', resumo: resumos.transporte, conteudo: pf('transporte') } : null,
    impostos: { id: 'impostos', titulo: 'Impostos e totais', resumo: resumos.impostos, conteudo: <>{pf('totais')}{pf('impostos')}{pf('adicionais')}</> },
    parcelas: resumos.parcelas ? { id: 'parcelas', titulo: 'Parcelas', resumo: resumos.parcelas, conteudo: pf('parcelas') } : null,
    situacao: resumos.situacao ? { id: 'situacao', titulo: proprio ? 'Situação' : 'Situação no Omie', resumo: resumos.situacao, conteudo: pf('situacao') } : null,
  }
  const secoes: SecaoNota[] = proprio ? [
        comuns.fornecedor,
        ...(comuns.transporte ? [comuns.transporte] : []),
        { id: 'frete', titulo: 'Frete (CT-e) e entradas', resumo: conferencia?.ctes.length ? `${conferencia.ctes.length} CT-e ligado${conferencia.ctes.length > 1 ? 's' : ''}` : 'Sem CT-e · entradas no estoque geradas por esta nota', conteudo: (
          <>
            {conferencia?.compra && (
              <FreteCteNF notaId={Number(id)} ctes={conferencia.ctes}
                editavel={podeManifestar && conferencia.compra.status !== 'cancelada' && !conferencia.itens.some((i) => i.lancado)} />
            )}
            <EntradasGeradasNF lojaId={lojaId} referencias={refsDaEntrada(nf.c_chave_nfe ?? null, conferencia?.compra?.id ?? null, conferencia?.compra?.estornos ?? 0)} />
          </>
        ) },
        comuns.impostos,
        ...(comuns.parcelas ? [comuns.parcelas] : []),
        { id: 'sefaz', titulo: 'SEFAZ', resumo: conferencia?.documento?.cienciaEm ? 'Ciência da operação enviada · manifestação e origem da nota' : 'Manifestação e origem da nota', conteudo: (
          <>
            {conferencia && nf.c_chave_nfe && podeManifestarSefaz && (
              <ManifestacaoNF notaId={Number(id)} ciencia={{ em: conferencia.documento?.cienciaEm ?? null, cstat: conferencia.documento?.cienciaCstat ?? null }}
                manifestacoes={conferencia.manifestacoes} temEntrada={!!conferencia.itens.some((i) => i.lancado) && conferencia.compra?.status !== 'cancelada'} />
            )}
            {conferencia && <OrigemSefazNF info={conferencia} />}
            {pf('situacao')}
          </>
        ) },
        ...(pedidoDaNota && conferencia?.compra || devolucoes && conferencia?.compra ? [{ id: 'pedido', titulo: 'Pedido e devolução', resumo: pedidoDaNota ? 'Pedido de compra desta nota' : 'Devolver itens ao fornecedor', conteudo: (
          <>
            {pedidoDaNota && conferencia?.compra && <PedidoDaNotaNF compraId={conferencia.compra.id} dados={pedidoDaNota} podeVincular={podeVincularPedido} />}
            {devolucoes && conferencia?.compra && <DevolucaoFornecedorNF compraId={conferencia.compra.id} dados={devolucoes} pode={podeDevolver}
              nfesPorDevolucao={nfesDev ? Object.fromEntries(nfesDev) : null} tpAmb={tpAmbDaNfe()} podeNfe={podeNfe} />}
          </>
        ) }] : []),
        { id: 'historico', titulo: 'Histórico', resumo: 'O que aconteceu com esta nota e quem mexeu', conteudo: (
          <>
            <HistoricoProcessamentoNF lojaId={lojaId} chave={nf.c_chave_nfe ?? null} compraId={conferencia?.compra?.id ?? null} nomesLocais={nomesLocais} />
            {conferencia?.compra && <HistoricoAlteracoes lojaId={lojaId} entidade="nota_entrada" ids={[conferencia.compra.id]} />}
          </>
        ) },
        { id: 'anexos', titulo: 'Anexos e observação', resumo: conferencia?.compra?.obs ? `Observação: ${conferencia.compra.obs}` : 'Arquivos e observação da nota', conteudo: (
          <>
            {conferencia?.compra && <ObservacaoNF notaId={Number(id)} obs={conferencia.compra.obs} editavel={podeManifestar} />}
            <AnexosRegistro lojaId={lojaId} entidade="nota_entrada" entidadeId={Number(id)} />
          </>
        ) },
      ] : [
        comuns.fornecedor,
        ...(comuns.transporte ? [comuns.transporte] : []),
        comuns.impostos,
        ...(comuns.parcelas ? [comuns.parcelas] : []),
        ...(comuns.situacao ? [comuns.situacao] : []),
        { id: 'movimentos', titulo: 'OPs e movimentos', resumo: concluida ? 'Entradas no estoque e OPs ligadas aos produtos' : 'OPs ligadas aos produtos desta nota', conteudo: (
          <>
            <OPsRelacionadasNF lojaId={lojaId} produtoCodes={produtoCodes} dataEmissao={nf.d_emissao_nfe ?? null} />
            <MovimentosDaNota lojaId={lojaId} numero={nf.c_numero_nfe ?? null} emissao={nf.d_emissao_nfe ?? null} concluida={concluida}
              itens={itensComLocal.map((i) => ({ n_id_produto: i.n_id_produto, codigo_local_estoque: i.codigo_local_estoque, quantidade: i.quantidade }))} />
          </>
        ) },
        { id: 'historico', titulo: 'Histórico', resumo: 'Etapas da nota no Omie', conteudo: <HistoricoStatusNF lojaId={lojaId} nIdReceb={nf.n_id_receb ?? null} numeroNFe={nf.c_numero_nfe ?? null} /> },
      ]

  const numero = String(nf.c_numero_nfe ?? '').replace(/^0+(?=\d)/, '')
  const serie = (nf as { c_serie_nfe?: string | null }).c_serie_nfe
  const corChip = statusInfo ? FUNDO_CLASSE[statusInfo.tom] : ''

  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-1 text-[13px] text-text-muted" aria-label="Caminho">
        <Link href="/nota-fiscal" className="inline-flex items-center gap-0.5 hover:text-text"><ChevronLeft className="size-4" />Notas Fiscais</Link>
      </nav>

      <header className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[28px] font-bold leading-tight tracking-[-0.02em] text-text">
            NF nº {numero}
            {serie && <span className="text-[15px] font-medium text-text-muted">série {serie}</span>}
            {statusInfo && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[13px] font-semibold text-text shadow-[var(--shadow-sm)]" title={`Etapa ${nf.c_etapa ?? '?'}`}>
                <span className={`size-2 rounded-full ${corChip}`} aria-hidden />{statusInfo.label.replace(/ \(etapa .*\)$/, '')}
              </span>
            )}
          </h1>
          {nomeFornecedor && (
            <p className="mt-1 text-[15px] font-medium text-text">{nomeFornecedor}{cnpjForn && <span className="font-normal text-text-muted"> · CNPJ <span className="num">{fmtCnpj(cnpjForn)}</span></span>}</p>
          )}
          <p className="mt-0.5 flex flex-wrap gap-x-4 text-[13.5px] text-text-muted">
            {nf.d_emissao_nfe && <span>Emissão <span className="num font-medium text-text">{fmtData(nf.d_emissao_nfe)}</span></span>}
            <span>Valor <span className="num font-medium text-text">{brl(totais.total)}</span></span>
            <span>{itensNF.length} {itensNF.length === 1 ? 'item' : 'itens'}</span>
          </p>
        </div>
        <MenuNota chave={nf.c_chave_nfe ?? null}>
          {nf.n_id_receb && <a href={`/api/nota-fiscal/${nf.id}/xml`} download className={btnClass('ghost')}><Download className="size-4" />Baixar XML</a>}
          {nf.n_id_receb && !proprio && <a href={`/api/nota-fiscal/${nf.id}/danfe`} target="_blank" rel="noopener noreferrer" className={btnClass('ghost')}><FileText className="size-4" />Abrir DANFE</a>}
          {itensNF.length > 0 && <DialogImprimirEtiqueta href={base} trigger={<button type="button" className={btnClass('ghost')}><Printer className="size-4" />Etiquetas de todos os itens</button>} />}
          {/* Só com a nota do banco principal: ids do Contabo podem apontar para outra nota (as ações buscam por id + loja). */}
          {nfSupabase && (
            <AcoesNF
              notaId={Number(id)}
              concluida={concluida}
              cancelada={cancelada}
              podeManifestar={podeManifestar && !proprio}
              podeReverter={podeReverter}
              podeExcluir={podeExcluir}
              modoProprio={proprio}
              temEntrada={!!conferencia?.itens.some((i) => i.lancado) && conferencia.compra?.status !== 'cancelada'}
              semConcluir={!proprio}
            />
          )}
        </MenuNota>
      </header>

      {/* Celular: itens, painel de entrada, mais informações. Computador: painel fixo à direita dos dois. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 lg:col-start-1">
          {proprio && conferencia?.itens.length ? (
            <ConferenciaNF notaId={Number(id)} itens={conferencia.itens} status={conferencia.compra?.status ?? 'pendente'} locais={conferencia.locais}
              podeConferir={podeManifestar} alertas={conferencia.sefaz.alertas} extras={extrasProprio} />
          ) : (
            <ItensNotaFiscal notaId={id} itens={itensNF} categorias={categorias ?? []} ligacoes={proprio ? null : { emissao: nf.d_emissao_nfe ?? null, hoje: hojeBahiaISO() }}
              nomesLocais={nomesLocais} categoriaNota={codCategOmie} nomesCategoriaOmie={nomesCategoriaOmie} />
          )}
        </div>

        {proprio && conferencia?.itens.length ? (
          <PainelEntradaProprio notaId={Number(id)} itens={conferencia.itens} status={conferencia.compra?.status ?? 'pendente'} locais={conferencia.locais} localAtual={conferencia.compra?.codigoLocal ?? null}
            podeConferir={podeManifestar} conferidaEm={conferencia.compra?.conferidaEm ?? null} faltaCategoria={faltaCategoria} categoria={blocoCategoria} totais={totais} />
        ) : (
          <PainelEntrada
            titulo={cancelada ? 'Nota cancelada' : concluida ? 'Entrada feita' : proprio ? 'Entrada no estoque' : 'Concluir no Omie'}
            passos={concluida || cancelada || proprio ? [] : [
              { ok: semProdutoOmie === 0, texto: semProdutoOmie === 0 ? 'Todos os itens com produto no Omie' : `${semProdutoOmie} ${semProdutoOmie === 1 ? 'item sem produto ligado' : 'itens sem produto ligado'} no Omie` },
              { ok: !faltaCategoria, texto: categoriaOmie ? 'Categoria da nota vem do Omie' : faltaCategoria ? 'Escolher a categoria da nota' : 'Categoria da nota escolhida' },
            ]}
            totais={totais}
            rodape={nfSupabase && !proprio ? (
              <BarraConcluirNF notaId={Number(id)} concluida={concluida} cancelada={cancelada} podeConcluir={podeManifestar} pronto={faltasOmie.length === 0}
                resumo={`Conclui o recebimento no Omie: os itens entram no estoque e o Omie cria a conta a pagar de ${brl(totais.total)}.`} />
            ) : null}
          >
            {blocoCategoria}
          </PainelEntrada>
        )}

        <div className="min-w-0 lg:col-start-1">
          <SecoesNota secoes={secoes} />
        </div>
      </div>
    </div>
  )
}
