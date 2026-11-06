import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FileExclamationPoint } from 'lucide-react'
import { lojasPropriasComPermissao, notasSemConta, PERM } from '@/lib/financeiro/dados'
import { rotuloCategoria } from '@/lib/financeiro/titulos-da-nota-puro'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { dataBR } from '@/components/financeiro/comum'
import { GerarNotaBotao, GerarSelecionadas } from '@/components/financeiro/DecisoesNotaUI'

// Decisão do dono (05/11, migration 360): notas lançadas antes da conta a pagar automática NÃO ganham conta sozinhas. Esta tela
// lista as notas de entrada confirmadas de TODAS as lojas próprias (ODARA inclusive) sem conta, com o valor e as duplicatas
// previstas, para o financeiro decidir. Gerar aqui vale mesmo com a chave lojas.fin_cp_da_nota_ativo desligada (decisão humana).
// Só desenvolvedor (lojasPropriasComPermissao chama exigirDev; rota-mãe /financeiro em ROTAS_SO_DEV).
const FORM = 'notas-sem-conta'

export default async function NotasSemContaPage() {
  const lojas = await lojasPropriasComPermissao(PERM.contasPagar)
  if (!lojas.length) notFound()
  const { notas: todas, semMigration } = await notasSemConta(null)
  const permitidas = new Set(lojas.map((l) => l.id))
  const notas = todas.filter((n) => permitidas.has(n.loja_id))
  const porLoja = lojas.map((l) => ({ ...l, notas: notas.filter((n) => n.loja_id === l.id) })).filter((l) => l.notas.length)
  const total = notas.reduce((a, n) => a + n.valor_total, 0)
  return (
    <div className="space-y-4">
      <PageHeader title="Notas sem conta a pagar" icon={FileExclamationPoint}
        description="Notas de entrada confirmadas nas lojas de estoque próprio que ainda não têm conta a pagar. Nada é gerado sozinho: escolha quais gerar."
        actions={<GerarSelecionadas formId={FORM} total={notas.length} />} />
      {semMigration ? (
        <p className="text-[13px] text-text-muted">Ainda não ativado nesta instalação (migration 360).</p>
      ) : notas.length === 0 ? (
        <EmptyState icon={FileExclamationPoint} title="Nenhuma nota sem conta a pagar" hint="Toda nota confirmada já tem conta a pagar." />
      ) : (
        <>
          <p className="text-[13px] text-text-muted">{notas.length} {notas.length === 1 ? 'nota' : 'notas'} · <Money value={total} /> no total. A categoria vem da família de maior valor da nota; competência = mês da entrada.</p>
          {porLoja.map((l) => (
            <section key={l.id} className="space-y-2">
              <h2 className="text-[15px] font-semibold text-text">{l.nome} <span className="font-normal text-text-muted">· {l.notas.length} {l.notas.length === 1 ? 'nota' : 'notas'}{!l.notas[0].chave_ligada && ' · geração automática desligada'}</span></h2>
              <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface u-card">
                <table className="w-full min-w-[980px] text-[13px]">
                  <thead>
                    <tr className="text-left text-text-muted">
                      <th className="w-8 px-4 py-2.5"><span className="sr-only">Selecionar</span></th>
                      <th className="px-2 py-2.5 font-medium">Nota</th>
                      <th className="px-2 py-2.5 font-medium">Entrada</th>
                      <th className="px-2 py-2.5 text-right font-medium">Valor</th>
                      <th className="px-2 py-2.5 font-medium">Duplicatas previstas</th>
                      <th className="px-2 py-2.5 font-medium">Categoria</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {l.notas.map((n) => (
                      <tr key={n.nota_id} className="border-t border-[var(--border)] align-top">
                        <td className="px-4 py-2"><input type="checkbox" form={FORM} name="nota" value={n.nota_id} aria-label={`Selecionar a nota ${n.numero ?? n.nota_id}`} /></td>
                        <td className="px-2 py-2">
                          <Link href={`/nota-fiscal/${n.nota_id}`} className="font-medium text-text hover:underline">NF {n.numero ?? n.nota_id}</Link>
                          <p className="text-text-muted">{n.fornecedor_nome ?? 'Fornecedor sem nome'} · emissão {dataBR(n.emissao)}{n.status_compra === 'parcial' ? ' · entrada parcial' : ''}</p>
                          {n.ultima_falha && <p className="text-warn">Última falha: {n.ultima_falha}</p>}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">{dataBR(n.data_entrada)}</td>
                        <td className="px-2 py-2 text-right"><Money value={n.valor_total} /></td>
                        <td className="px-2 py-2">
                          {n.parcelas.map((p) => <p key={p.parcela} className="whitespace-nowrap">{p.parcela}/{p.total} · {dataBR(p.vencimento)} · <Money value={p.valor} /></p>)}
                          {n.regra === 'sem_duplicata' && <p className="text-text-muted">sem duplicata: à vista, vence na emissão</p>}
                        </td>
                        <td className="px-2 py-2">
                          {rotuloCategoria(n.categoria_nome)}
                          {n.familia_nome && <p className="text-text-muted">família {n.familia_nome}</p>}
                        </td>
                        <td className="px-4 py-2 text-right"><GerarNotaBotao notaId={n.nota_id} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          <form id={FORM} />
        </>
      )}
    </div>
  )
}
