import { notFound } from 'next/navigation'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { acessoFinanceiro, detalheTitulo, listarCategorias, listarContas, listarFornecedores, PERM } from '@/lib/financeiro/dados'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { Money } from '@/components/ui-kit/Money'
import { BotaoPagar, CancelarTitulo, EstornarPagamento, FormTitulo } from '@/components/financeiro/ContasPagarUI'
import { dataBR, mesBR, SituacaoSelo } from '@/components/financeiro/comum'

// Ficha do título a pagar: dados, pagamentos (com estorno) e histórico de tudo que aconteceu. Nada é apagado.
const ROTULO_EVENTO: Record<string, string> = {
  incluido: 'Incluído', editado: 'Editado', pagamento: 'Pagamento registrado', estorno: 'Pagamento estornado', cancelado: 'Cancelado',
}
const dataHora = (d: string) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })

export default async function TituloPagarPage({ params }: { params: Promise<{ id: string }> }) {
  const { lojaId, podePagar } = await acessoFinanceiro(PERM.contasPagar)
  const { id } = await params
  if (!/^\d+$/.test(id)) notFound()
  const hoje = hojeBahiaISO()
  const d = await detalheTitulo(lojaId, Number(id), hoje)
  if (!d) notFound()
  const t = d.titulo
  const [fornecedores, categorias, { contas }] = await Promise.all([listarFornecedores(lojaId), listarCategorias(lojaId), listarContas(lojaId)])
  const contasAtivas = contas.filter((c) => c.ativa).map((c) => ({ id: c.id, nome: c.nome }))
  const aberto = t.status === 'aberto' || t.status === 'parcial'

  return (
    <div className="space-y-4">
      <PageHeader title={`Conta a pagar nº ${t.numero}`} voltarHref="/financeiro/contas-pagar"
        description={`${t.fornecedor_nome}${t.documento ? ` · doc ${t.documento}` : ''}`} />

      <section className="space-y-3 rounded-[var(--r-lg)] bg-surface p-4 text-[13px] u-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SituacaoSelo situacao={t.situacao} />
          <span className="flex flex-wrap items-center gap-4">
            {(t.status === 'aberto' || t.status === 'parcial' || t.status === 'pago') && (
              <FormTitulo titulo={{ id: t.id, fornecedor_id: t.fornecedor_id, documento: t.documento, valor: t.valor, valor_quitado: t.valor_quitado, data_emissao: t.data_emissao, data_vencimento: t.data_vencimento, data_competencia: t.data_competencia, categoria_id: t.categoria_id, observacao: t.observacao, status: t.status }}
                fornecedores={fornecedores} categorias={categorias.filter((c) => c.tipo === 'despesa' && (c.ativa || c.id === t.categoria_id)).map((c) => ({ id: c.id, nome: c.nome }))} hoje={hoje}>Editar</FormTitulo>
            )}
            {podePagar && aberto && <BotaoPagar tituloId={t.id} rotuloTitulo={`${t.fornecedor_nome} · nº ${t.numero}`} restante={t.restante} contas={contasAtivas} hoje={hoje}>Registrar pagamento</BotaoPagar>}
            {t.status === 'aberto' && <CancelarTitulo id={t.id} />}
          </span>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Valor', <Money key="v" value={t.valor} />], ['Já pago (do título)', <Money key="q" value={t.valor_quitado} />],
            ['Falta pagar', <Money key="r" value={t.restante} />], ['Vencimento', dataBR(t.data_vencimento)],
            ['Competência', mesBR(t.data_competencia)], ['Emissão', dataBR(t.data_emissao)], ['Categoria', t.categoria_nome ?? '—'],
            ['Origem', t.origem_tipo === 'manual' ? 'Lançado à mão' : t.origem_tipo],
          ].map(([rot, val]) => (
            <div key={String(rot)}><dt className="text-[12px] text-text-muted">{rot}</dt><dd className="mt-0.5 text-[15px] text-text">{val}</dd></div>
          ))}
        </dl>
        {t.observacao && <p className="text-text-muted">Obs.: {t.observacao}</p>}
        {t.status === 'cancelado' && <p className="text-text-muted">Cancelado em {dataHora(t.cancelado_em ?? '')}{t.cancelado_por_nome ? ` por ${t.cancelado_por_nome}` : ''}: {t.motivo_cancelamento}</p>}
        {t.status === 'parcial' && <p className="text-text-muted">Para cancelar, estorne antes os pagamentos abaixo.</p>}
      </section>

      <section className="space-y-2 rounded-[var(--r-lg)] bg-surface p-4 text-[13px] u-card">
        <h2 className="text-[15px] font-semibold text-text">Pagamentos</h2>
        {d.pagamentos.length === 0 ? <p className="text-text-muted">Nenhum pagamento registrado.</p> : (
          <ul className="divide-y divide-[var(--border)]">
            {d.pagamentos.map((p) => (
              <li key={p.id} className="space-y-1 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={p.estornado_em ? 'text-text-muted line-through' : 'text-text'}>
                    {dataBR(p.data_pagamento)} · <Money value={p.valor_pago} /> · {p.conta_nome}{p.forma ? ` · ${p.forma}` : ''}
                  </span>
                  {podePagar && !p.estornado_em && <EstornarPagamento id={p.id} />}
                </div>
                <p className="text-text-muted">
                  Quitou <Money value={p.valor_principal} />{p.juros > 0 && <> + juros <Money value={p.juros} /></>}{p.desconto > 0 && <> − desconto <Money value={p.desconto} /></>}
                  {p.criado_por_nome ? ` · por ${p.criado_por_nome}` : ''}{p.observacao ? ` · ${p.observacao}` : ''}
                </p>
                {p.estornado_em && <p className="text-warn">Estornado em {dataHora(p.estornado_em)}{p.estornado_por_nome ? ` por ${p.estornado_por_nome}` : ''}: {p.motivo_estorno}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-[var(--r-lg)] bg-surface p-4 text-[13px] u-card">
        <h2 className="text-[15px] font-semibold text-text">Histórico</h2>
        <ul className="space-y-1 text-text-muted">
          {[...d.eventos].reverse().map((e, i) => (
            <li key={i}>{dataHora(e.created_at)} · <span className="text-text">{ROTULO_EVENTO[e.tipo] ?? e.tipo}</span>{e.user_nome ? ` · ${e.user_nome}` : ''}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
