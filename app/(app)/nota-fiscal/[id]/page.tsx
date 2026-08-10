import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { ItensNotaFiscal, type ItemNF } from '@/components/nota-fiscal/ItensNotaFiscal'
import { btnClass } from '@/components/ui-kit/Button'
import { FileText, Download } from 'lucide-react'
import { complementarNotasFiscais, complementarNotaFiscalItems } from '@/lib/historico-contabo'
import { statusNF } from '@/lib/nf-status'
import { DetalhesFiscaisNF } from '@/components/nota-fiscal/DetalhesFiscaisNF'
import { AcoesNF } from '@/components/nota-fiscal/AcoesNF'
import { OPsRelacionadasNF } from '@/components/nota-fiscal/OPsRelacionadasNF'
import { MovimentacoesGeradasNF } from '@/components/nota-fiscal/MovimentacoesGeradasNF'
import { HistoricoStatusNF } from '@/components/nota-fiscal/HistoricoStatusNF'

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

  const { id } = await params
  const supabase = await createClient()

  const { data: nfSupabase } = await supabase
    .from('notas_fiscais')
    .select('id, c_numero_nfe, c_razao_social, c_nome, c_chave_nfe, d_emissao_nfe, n_valor_nfe, c_etapa, n_id_receb, full_object')
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
  type ItemComFullObject = { n_id_produto: number | null; c_descricao_produto: string | null; full_object: unknown }
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
      }
    })

  // Mesma fonte unica de status usada no selo abaixo (lib/nf-status.ts):
  // c_etapa === '60' sozinho NAO significa "concluida" de verdade -- uma nota
  // pode estar em c_etapa='60' E cancelada ao mesmo tempo. Os botoes de acao
  // (AcoesNF) usam este calculo, nunca a prop crua c_etapa.
  const statusInfo = nf.c_etapa ? statusNF(nf.c_etapa, nf.full_object) : null
  const concluida = statusInfo?.label === 'Concluída'
  const cancelada = statusInfo?.label === 'Cancelada'

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
              <p className="text-[13px] text-text-muted">{nf.c_razao_social || nf.c_nome}</p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-text-muted">
              {nf.d_emissao_nfe && <span>Emissão: <span className="num">{fmtData(nf.d_emissao_nfe)}</span></span>}
              {nf.n_valor_nfe != null && (
                <span>Valor: <span className="num font-medium text-text">{Number(nf.n_valor_nfe).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></span>
              )}
              {statusInfo && (
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusInfo.tom === 'ok' ? 'text-ok bg-ok/10' : statusInfo.tom === 'err' ? 'text-err bg-err/10' : 'text-warn bg-warn/10'}`}
                >
                  {statusInfo.label} <span className="num ml-1 opacity-70">({nf.c_etapa})</span>
                </span>
              )}
            </div>
            {nf.c_chave_nfe && (
              <p className="num text-[11px] text-text-muted break-all">{nf.c_chave_nfe}</p>
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
                <a
                  href={`/api/nota-fiscal/${nf.id}/danfe`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={btnClass('outline')}
                  title="Abrir DANFE em PDF"
                >
                  <FileText className="size-4" /> DANFE
                </a>
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
                  podeManifestar={podeManifestar}
                  podeReverter={podeReverter}
                  podeExcluir={podeExcluir}
                />
              </div>
            )}
          </div>
        }
      />
      <DetalhesFiscaisNF fullObject={nf.full_object} />
      <ItensNotaFiscal notaId={id} itens={(itens ?? []) as ItemNF[]} categorias={categorias ?? []} />

      <OPsRelacionadasNF lojaId={lojaId} produtoCodes={produtoCodes} dataEmissao={nf.d_emissao_nfe ?? null} />

      <MovimentacoesGeradasNF lojaId={lojaId} itens={itensComLocal} dataEmissao={nf.d_emissao_nfe ?? null} />

      <HistoricoStatusNF lojaId={lojaId} nIdReceb={nf.n_id_receb ?? null} numeroNFe={nf.c_numero_nfe ?? null} />
    </div>
  )
}
