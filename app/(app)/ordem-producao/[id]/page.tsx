import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { complementarOrdensProducao } from '@/lib/historico-contabo'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { isOpConcluida, opStatus, type OpStatus } from '@/lib/op-status'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { FUNDO_CLASSE, type CorToken } from '@/lib/status-cor'
import { InventariosRelacionadosOP } from '@/components/ordem-producao/InventariosRelacionadosOP'
import { NotaFiscalVinculadaOP } from '@/components/ordem-producao/NotaFiscalVinculadaOP'
import { HistoricoSyncOP } from '@/components/ordem-producao/HistoricoSyncOP'
import { HistoricoEdicoesOP } from '@/components/ordem-producao/HistoricoEdicoesOP'
import { DetalheOPProprio } from '@/components/ordem-producao/DetalheOPProprio'
import { detalheOPProprio } from '@/lib/estoque/op-proprio'
import { urlVendaNoVendas } from '@/lib/estoque/link-vendas'

const STATUS_INFO: Record<OpStatus, { label: string; token: CorToken }> = {
  concluida: { label: 'Concluída', token: 'ok' },
  prevista: { label: 'Prevista', token: 'info' },
  atrasada: { label: 'Atrasada', token: 'err' },
  pendente: { label: 'Pendente', token: 'warn' },
}

function fmtDataBR(d: string | null | undefined): string | null {
  if (!d) return null
  const m = d.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px] text-text">{children}</dd>
    </div>
  )
}

export default async function OrdemProducaoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) notFound()

  const { id } = await params
  const supabase = await createClient()
  const { data: lojaModo } = await supabase.from('lojas').select('modo_estoque').eq('id', lojaId).maybeSingle()
  const proprio = lojaModo?.modo_estoque === 'proprio'

  // errosConsulta: mesmo padrao de errosConsulta/banner ja estabelecido nas
  // Tasks 12-16 desta auditoria (AGENTS.md) -- acumula falha de query num
  // array em vez de deixar a pagina renderizar dado incompleto em silencio
  // (achado real: nenhuma das 4 consultas desta pagina checava `error`,
  // reintroduzindo a MESMA classe de bug que aquelas tasks passaram o dia
  // fechando, num arquivo novo).
  const errosConsulta: string[] = []
  function logErro(rotulo: string) {
    return (error: { message: string } | null) => {
      if (!error) return
      errosConsulta.push(rotulo)
      console.error(`ordem-producao/[id]: consulta "${rotulo}" falhou -- dado pode estar incompleto`, error.message)
    }
  }

  const { data: opSupabase, error: opErro } = await supabase
    .from('ordens_producao')
    .select(
      'id, loja_id, identificacao_n_cod_op, identificacao_c_num_op, num_ordem, identificacao_n_cod_produto, identificacao_n_qtde, identificacao_codigo_local_estoque, identificacao_d_dt_previsao, validade, quantidade, concluida, dt_conclusao_real, conclusao_status, conclusao_erro_msg, conclusao_tentativas, conclusao_ultima_tentativa_em, conclusao_qtde_desejada, conclusao_data_desejada, full_object'
    )
    .eq('id', id)
    .eq('loja_id', lojaId)
    .maybeSingle()

  // Mesmo padrao de app/(app)/nota-fiscal/[id]/page.tsx: se nao achou no
  // Supabase quente, tenta o Contabo (historico completo) antes de dar 404.
  // opFonte importa pro HistoricoSyncOP abaixo: os campos conclusao_* (Task 1
  // desta auditoria) so existem na tabela `ordens_producao` do Supabase --
  // confirmado ao vivo (`\d ordens_producao` no Postgres `ntb_frio` do
  // Contabo) que essas 6 colunas NUNCA foram migradas pro banco frio. Uma OP
  // vinda do fallback frio mostraria "sem pendencia" mesmo quando o dado
  // simplesmente nao existe ali -- precisa de uma mensagem diferente.
  let opFonte: 'quente' | 'frio' = 'quente'
  let op = opSupabase
  if (!op) {
    const frias = await complementarOrdensProducao([], { lojaId, id: Number(id) })
    op = frias[0] ?? null
    opFonte = 'frio'
  }

  if (!op) {
    // opErro real (falha transitoria de banco/rede) e diferente de "OP nao
    // existe" -- nao confundir os dois com um 404 enganoso.
    if (opErro) {
      return (
        <p className="rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[13px] text-text-muted shadow-[var(--shadow-sm)]">
          <span aria-hidden className="mr-1.5 inline-block size-2 rounded-full bg-err align-[1px]" />
          Não foi possível consultar esta ordem de produção agora (falha de banco/rede: {opErro.message}). Tente
          recarregar a página.
        </p>
      )
    }
    notFound()
  }

  // Colunas do estoque proprio (migration 136): lidas a parte e so em loja proprio, para o modo Omie nao depender delas.
  type ExtraProprio = {
    local_destino: number | null; criada_por: string | null; concluida_por_nome: string | null; revertida_em: string | null
    revertida_por: string | null; custo_total: number | null; custo_unitario: number | null; venda_ref: string | null; dt_inclusao: string | null
  }
  const { data: extraProprio } = proprio
    ? await supabase.from('ordens_producao')
        .select('local_destino, criada_por, concluida_por_nome, revertida_em, revertida_por, custo_total, custo_unitario, venda_ref, dt_inclusao')
        .eq('id', op.id).eq('loja_id', lojaId).maybeSingle<ExtraProprio>()
    : { data: null as ExtraProprio | null }

  const [{ data: produto, error: produtoErro }, { data: local, error: localErro }] = await Promise.all([
    op.identificacao_n_cod_produto
      ? supabase
          .from('produtos')
          .select('descricao, unidade')
          .eq('loja_id', lojaId)
          .eq('codigo_produto', op.identificacao_n_cod_produto)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    op.identificacao_codigo_local_estoque
      ? supabase
          .from('local_estoques')
          .select('descricao')
          .eq('loja_id', lojaId)
          .eq('codigo_local_estoque', op.identificacao_codigo_local_estoque)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  logErro('produto')(produtoErro)
  logErro('local de estoque')(localErro)
  const localDestinoCod = extraProprio?.local_destino ?? null
  const { data: localDestino } = proprio && localDestinoCod
    ? await supabase.from('local_estoques').select('descricao').eq('loja_id', lojaId).eq('codigo_local_estoque', localDestinoCod).maybeSingle()
    : { data: null }

  // Ingredientes: mesmo padrao de app/(app)/ordem-producao/page.tsx (le
  // full_object.itensDetalhes, resolve nome/unidade via produtos).
  type ItemDetalhe = { nIdProdutoMalha: number; nQtde: number }
  const itensDetalhes =
    ((op.full_object as { itensDetalhes?: ItemDetalhe[] } | null)?.itensDetalhes) ?? []
  const insumoCodes = [...new Set(itensDetalhes.filter((i) => i.nIdProdutoMalha).map((i) => i.nIdProdutoMalha))]
  const { data: insumoProds, error: insumoProdsErro } = insumoCodes.length
    ? await supabase
        .from('produtos')
        .select('codigo_produto, descricao, unidade')
        .eq('loja_id', lojaId)
        .in('codigo_produto', insumoCodes)
    : { data: [] as { codigo_produto: number; descricao: string; unidade: string }[], error: null }
  logErro('produtos dos insumos')(insumoProdsErro)
  const insumoMap = new Map((insumoProds ?? []).map((p) => [p.codigo_produto, p]))
  const ingredientes = itensDetalhes
    .filter((i) => i.nIdProdutoMalha)
    .map((i) => {
      const p = insumoMap.get(i.nIdProdutoMalha)
      return {
        cod: i.nIdProdutoMalha,
        nome: formatarNomeProduto(p?.descricao) || `#${i.nIdProdutoMalha}`,
        unidade: p?.unidade ?? '',
        qtd: Number(i.nQtde),
      }
    })

  const hojeISO = hojeBahiaISO()
  const concluida = isOpConcluida(op)
  const status = opStatus(op, hojeISO)
  const numOP = op.identificacao_c_num_op || op.num_ordem || `#${op.id}`
  const produtoNome = formatarNomeProduto(produto?.descricao) || `Produto ${op.identificacao_n_cod_produto ?? '-'}`

  // Data de referencia para os cruzamentos aproximados (inventario/NF): conclusao
  // real quando ja concluida, senao a data prevista -- mesma logica ja usada na
  // listagem (ordem-producao/page.tsx) para escolher qual data mostrar.
  const dataReferencia: string | null = op.dt_conclusao_real ?? op.identificacao_d_dt_previsao ?? null

  return (
    <div className="space-y-4">
      <DetailHeader
        href="/ordem-producao"
        title={`OP ${numOP}`}
        breadcrumb={[{ label: 'Ordens de Produção', href: '/ordem-producao' }, { label: `OP ${numOP}` }]}
        meta={
          <div className="space-y-1">
            <p className="text-[15px] text-text-muted">{produtoNome}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-text-muted">
              {(op.dt_conclusao_real || op.identificacao_d_dt_previsao) && (
                <span>
                  {concluida ? 'Concluída' : 'Prevista'}:{' '}
                  <span className="num">{fmtDataBR(op.dt_conclusao_real || op.identificacao_d_dt_previsao)}</span>
                </span>
              )}
              {op.identificacao_n_qtde != null && (
                <span>
                  Qtd: <span className="num font-medium text-text">{Number(op.identificacao_n_qtde).toLocaleString('pt-BR')}</span>{' '}
                  {produto?.unidade ?? ''}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-text">
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${FUNDO_CLASSE[STATUS_INFO[status].token]}`} />
                {STATUS_INFO[status].label}
              </span>
            </div>
          </div>
        }
      />

      {errosConsulta.length > 0 && (
        <p className="flex items-start gap-2 rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[13px] text-text-muted shadow-[var(--shadow-sm)]">
          <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-warn" />
          <span>
          Falha ao consultar: <strong className="text-warn">{[...new Set(errosConsulta)].join(', ')}</strong> — os
          dados abaixo podem estar incompletos.
          </span>
        </p>
      )}

      {/* Dados basicos: replica o que ja existe hoje na linha expandida da lista
          (OrdemProducaoRow.tsx) -- produto, quantidade, ingredientes, validade. */}
      <div className="rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] bg-surface p-5">
        <h2 className="mb-3 text-[17px] font-semibold text-text">Dados básicos</h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo label="Produto">{produtoNome}</Campo>
          <Campo label="Quantidade planejada">
            <span className="num">
              {op.identificacao_n_qtde != null ? Number(op.identificacao_n_qtde).toLocaleString('pt-BR') : '-'}
            </span>{' '}
            {produto?.unidade ?? ''}
          </Campo>
          <Campo label={proprio ? 'Local de consumo' : 'Local de produção'}>
            {local?.descricao ?? (op.identificacao_codigo_local_estoque ? `#${op.identificacao_codigo_local_estoque}` : '-')}
          </Campo>
          {proprio && <Campo label="Local de destino">{localDestino?.descricao ?? local?.descricao ?? '-'}</Campo>}
          <Campo label="Validade"><span className="num">{fmtDataBR(op.validade) ?? '-'}</span></Campo>
          <Campo label="Quantidade de etiqueta"><span className="num">{op.quantidade ?? '-'}</span></Campo>
          <Campo label="Data prevista"><span className="num">{fmtDataBR(op.identificacao_d_dt_previsao) ?? '-'}</span></Campo>
          <Campo label="Data de conclusão"><span className="num">{fmtDataBR(op.dt_conclusao_real) ?? '-'}</span></Campo>
        </dl>
        {ingredientes.length > 0 && (
          <div className="mt-4 border-t border-border/60 pt-3">
            <p className="mb-1.5 text-[13px] font-semibold text-text-muted">Ingredientes</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {ingredientes.map((i) => (
                <span key={i.cod} className="text-[13px] text-text">
                  {i.nome}{' '}
                  <span className="num text-text-muted">
                    {i.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}
                    {i.unidade ? ` ${i.unidade}` : ''}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {proprio && (
        <DetalheOPProprio
          detalhe={await detalheOPProprio(lojaId, op.id)}
          opId={op.id}
          numOP={numOP}
          concluida={concluida}
          podeReverter={await requirePermissao(lojaId, 'Ordens de Producao - Reverter')}
          custoTotal={extraProprio?.custo_total ?? null}
          custoUnitario={extraProprio?.custo_unitario ?? null}
          unidade={produto?.unidade ?? ''}
          criadaPor={extraProprio?.criada_por ?? null}
          criadaEm={extraProprio?.dt_inclusao ?? null}
          concluidaPor={extraProprio?.concluida_por_nome ?? null}
          concluidaEm={concluida ? op.dt_conclusao_real ?? null : null}
          revertidaPor={extraProprio?.revertida_por ?? null}
          revertidaEm={extraProprio?.revertida_em ?? null}
          vendaRef={extraProprio?.venda_ref ?? null}
          vendaUrl={urlVendaNoVendas(extraProprio?.venda_ref ?? null)}
        />
      )}

      {!proprio && <HistoricoSyncOP
        info={{
          fonte: opFonte,
          concluida,
          conclusaoStatus: op.conclusao_status ?? null,
          conclusaoErroMsg: op.conclusao_erro_msg ?? null,
          conclusaoTentativas: op.conclusao_tentativas ?? null,
          conclusaoUltimaTentativaEm: op.conclusao_ultima_tentativa_em ?? null,
          conclusaoQtdeDesejada: op.conclusao_qtde_desejada ?? null,
          conclusaoDataDesejada: op.conclusao_data_desejada ?? null,
        }}
      />}

      <InventariosRelacionadosOP
        lojaId={lojaId}
        produtoCodigoProduto={op.identificacao_n_cod_produto ?? null}
        codigoLocalEstoque={op.identificacao_codigo_local_estoque ?? null}
        dataReferencia={dataReferencia}
      />

      <NotaFiscalVinculadaOP lojaId={lojaId} insumoCodes={insumoCodes} dataReferencia={dataReferencia} />

      <HistoricoEdicoesOP lojaId={lojaId} codigoOmieOP={op.identificacao_n_cod_op ?? null} />
    </div>
  )
}
