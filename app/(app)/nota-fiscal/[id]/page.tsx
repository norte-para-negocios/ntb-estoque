import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { ItensNotaFiscal, type ItemNF } from '@/components/nota-fiscal/ItensNotaFiscal'
import { btnClass } from '@/components/ui-kit/Button'
import { FileText, Download } from 'lucide-react'
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
import { ConferenciaNF } from '@/components/nota-fiscal/ConferenciaNF'
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
import { refsDaEntrada } from '@/lib/estoque/nf-entrada'
import { HistoricoAlteracoes } from '@/components/historico/HistoricoAlteracoes'

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
    .select('id, c_numero_nfe, c_razao_social, c_nome, c_chave_nfe, d_emissao_nfe, n_valor_nfe, c_etapa, n_id_receb, full_object, origem')
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
      .select('id, nome')
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
  const pedidoDaNota = conferencia?.compra && conferencia.compra.status !== 'cancelada' ? await carregarPedidoDaNota(lojaId, conferencia.compra.id) : null
  // mesma regra da ação vincularNotaAoPedido: 'Compras - Pedidos' e 'Notas Fiscais'
  const podeVincularPedido = !!pedidoDaNota && (await requirePermissao(lojaId, 'Compras - Pedidos')) && (await requirePermissao(lojaId, 'Notas Fiscais'))
  // Fase F [H1] (só estoque próprio): devolução ao fornecedor dos itens que entraram no estoque, sem NF-e
  const devolucoes = conferencia?.compra && ['lancada', 'parcial'].includes(conferencia.compra.status) ? await carregarDevolucoesDaNota(lojaId, conferencia.compra.id) : null
  const podeDevolver = !!devolucoes && (await requirePermissao(lojaId, 'Compras - Devolucao ao fornecedor'))

  function fmtData(d: string | null) {
    if (!d) return null
    const [y, m, dia] = d.slice(0, 10).split('-')
    return `${dia}/${m}/${y}`
  }

  return (
    <div className="space-y-4">
      <DetailHeader
        href="/nota-fiscal"
        title={`NFe ${nf.c_numero_nfe}`}
        breadcrumb={[
          { label: 'Notas Fiscais', href: '/nota-fiscal' },
          { label: `NFe ${nf.c_numero_nfe}` },
        ]}
        meta={
          <div className="space-y-1">
            {(nf.c_razao_social || nf.c_nome) && (
              <p className="text-[15px] text-text-muted">{nf.c_razao_social || nf.c_nome}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-text-muted">
              {nf.d_emissao_nfe && <span>Emissão: <span className="num">{fmtData(nf.d_emissao_nfe)}</span></span>}
              {nf.n_valor_nfe != null && (
                <span>Valor: <span className="num font-medium text-text">{Number(nf.n_valor_nfe).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></span>
              )}
              {statusInfo && (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-text">
                  <span className={`size-2 shrink-0 rounded-full ${FUNDO_CLASSE[statusInfo.tom]}`} aria-hidden />
                  {statusInfo.label} <span className="num font-normal text-text-muted">({nf.c_etapa})</span>
                </span>
              )}
            </div>
            {nf.c_chave_nfe && (
              // Chave de acesso = código: continua em mono, quebrada em grupos de 4
              // só visualmente (spans inline-block, sem espaço real no texto --
              // copiar a chave continua dando os 44 dígitos colados).
              <p className="font-mono text-[12px] leading-relaxed text-text-muted" title="Chave de acesso">
                {(nf.c_chave_nfe.match(/.{1,4}/g) ?? [nf.c_chave_nfe]).map((g: string, i: number) => (
                  <span key={i} className="mr-[0.5em] inline-block">{g}</span>
                ))}
              </p>
            )}
            {nf.n_id_receb && (
              <div className="flex flex-wrap gap-2 pt-1">
                <a
                  href={`/api/nota-fiscal/${nf.id}/xml`}
                  download
                  className={btnClass('outline')}
                  title="Baixar XML da NF-e"
                >
                  <Download className="size-4" /> XML
                </a>
                {!proprio && <a
                  href={`/api/nota-fiscal/${nf.id}/danfe`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={btnClass('outline')}
                  title="Abrir DANFE em PDF"
                >
                  <FileText className="size-4" /> DANFE
                </a>}
              </div>
            )}
            {/* So renderiza os botoes de acao quando a nota veio do Supabase
                "quente" de verdade (nfSupabase, ANTES do fallback pro
                Contabo). A lista mescla ids de duas fontes que nao
                compartilham o mesmo espaco de ids -- um id vindo do Contabo
                pode, por coincidencia, corresponder a uma nota DIFERENTE no
                Supabase. As Server Actions sempre buscam na mesma tabela
                quente por id+loja_id, entao so podem ser chamadas com
                seguranca quando foi essa busca que encontrou a nota. */}
            {nfSupabase && (
              <div className="pt-1">
                <AcoesNF
                  notaId={Number(id)}
                  concluida={concluida}
                  cancelada={cancelada}
                  podeManifestar={podeManifestar && !proprio}
                  podeReverter={podeReverter}
                  podeExcluir={podeExcluir}
                  modoProprio={proprio}
                  temEntrada={!!conferencia?.itens.some((i) => i.lancado) && conferencia.compra?.status !== 'cancelada'}
                />
              </div>
            )}
          </div>
        }
      />
      <DetalhesFiscaisNF fullObject={nf.full_object} semOmie={proprio} />
      {conferencia && (
        <ConferenciaNF notaId={Number(id)} itens={conferencia.itens} status={conferencia.compra?.status ?? 'pendente'} locais={conferencia.locais} localAtual={conferencia.compra?.codigoLocal ?? null}
          podeConferir={podeManifestar} alertas={conferencia.sefaz.alertas} conferidaEm={conferencia.compra?.conferidaEm ?? null} />
      )}
      {pedidoDaNota && conferencia?.compra && <PedidoDaNotaNF compraId={conferencia.compra.id} dados={pedidoDaNota} podeVincular={podeVincularPedido} />}
      {devolucoes && conferencia?.compra && <DevolucaoFornecedorNF compraId={conferencia.compra.id} dados={devolucoes} pode={podeDevolver} />}
      <ItensNotaFiscal notaId={id} itens={(itens ?? []) as ItemNF[]} categorias={categorias ?? []} ligacoes={proprio ? null : { emissao: nf.d_emissao_nfe ?? null, hoje: hojeBahiaISO() }}
        nomesLocais={conferencia ? Object.fromEntries(conferencia.locais.map((l) => [l.codigo, l.descricao])) : undefined} />

      {proprio ? (
        <>
          <EntradasGeradasNF lojaId={lojaId} referencias={refsDaEntrada(nf.c_chave_nfe ?? null, conferencia?.compra?.id ?? null, conferencia?.compra?.estornos ?? 0)} />
          {conferencia?.compra && (
            <FreteCteNF notaId={Number(id)} ctes={conferencia.ctes}
              editavel={podeManifestar && conferencia.compra.status !== 'cancelada' && !conferencia.itens.some((i) => i.lancado)} />
          )}
          {conferencia && nf.c_chave_nfe && podeManifestarSefaz && (
            <ManifestacaoNF notaId={Number(id)} ciencia={{ em: conferencia.documento?.cienciaEm ?? null, cstat: conferencia.documento?.cienciaCstat ?? null }}
              manifestacoes={conferencia.manifestacoes} temEntrada={!!conferencia.itens.some((i) => i.lancado) && conferencia.compra?.status !== 'cancelada'} />
          )}
          {conferencia?.compra && <ObservacaoNF notaId={Number(id)} obs={conferencia.compra.obs} editavel={podeManifestar} />}
          {conferencia && <OrigemSefazNF info={conferencia} />}
          {/* loja própria: histórico de processamento (SEFAZ, conferência, estoque, manifestação) no lugar do HistoricoStatusNF do Omie */}
          <HistoricoProcessamentoNF lojaId={lojaId} chave={nf.c_chave_nfe ?? null} compraId={conferencia?.compra?.id ?? null}
            nomesLocais={conferencia ? Object.fromEntries(conferencia.locais.map((l) => [l.codigo, l.descricao])) : undefined} />
          {conferencia?.compra && <HistoricoAlteracoes lojaId={lojaId} entidade="nota_entrada" ids={[conferencia.compra.id]} />}
        </>
      ) : (
        <>
          <OPsRelacionadasNF lojaId={lojaId} produtoCodes={produtoCodes} dataEmissao={nf.d_emissao_nfe ?? null} />

          <MovimentosDaNota
            lojaId={lojaId}
            numero={nf.c_numero_nfe ?? null}
            emissao={nf.d_emissao_nfe ?? null}
            concluida={concluida}
            itens={itensComLocal.map((i) => ({ n_id_produto: i.n_id_produto, codigo_local_estoque: i.codigo_local_estoque, quantidade: i.quantidade }))}
          />

          <HistoricoStatusNF lojaId={lojaId} nIdReceb={nf.n_id_receb ?? null} numeroNFe={nf.c_numero_nfe ?? null} />
        </>
      )}
    </div>
  )
}
