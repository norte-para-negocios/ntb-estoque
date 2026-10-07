import { notFound } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { Indicador, fmtBRL, fmtQtd } from '@/components/estoque-proprio/Apresentacao'
import { StatusCompra } from '@/components/compras-proprio/StatusCompra'
import { EstornarCompra, MapearPendentes } from '@/components/compras-proprio/DetalheAcoes'
import { Coins, Percent, ReceiptText, Truck } from 'lucide-react'
import { carregarCompra } from '../dados'

export default async function CompraDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Compras'))) notFound()
  const podeCriar = await requirePermissao(lojaId, 'Compras - Criar')
  const { id } = await params
  const compra = Number.isFinite(Number(id)) ? await carregarCompra(lojaId, Number(id)) : null
  if (!compra) notFound()

  const pendentes = compra.itens.filter((i) => !i.lancado && compra.status !== 'cancelada')
  const data = compra.emissao ? new Date(compra.emissao + 'T12:00:00').toLocaleDateString('pt-BR') : new Date(compra.criadaEm).toLocaleDateString('pt-BR')

  return (
    <div className="space-y-5">
      <PageHeader title={compra.fornecedorNome || 'Compra'} voltarHref="/compras"
        description={`${compra.numero ? `NF ${compra.numero}${compra.serie ? ` · série ${compra.serie}` : ''} · ` : ''}${data}${compra.local ? ` · entrou em ${compra.local}` : ''}`}
        actions={podeCriar && compra.status !== 'cancelada' && compra.nItens > compra.nPendentes ? <EstornarCompra compraId={compra.id} numero={compra.numero} /> : undefined} />

      <div className="flex flex-wrap items-center gap-3"><StatusCompra status={compra.status} />{compra.chaveAcesso && <span className="num break-all text-[11px] text-text-muted">{compra.chaveAcesso}</span>}</div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador icon={ReceiptText} rotulo="Produtos" valor={fmtBRL(compra.valorProdutos)} />
        <Indicador icon={Truck} rotulo="Frete e despesas" valor={fmtBRL(compra.valorFrete)} dica="rateado no custo dos itens" />
        <Indicador icon={Percent} rotulo="Desconto da nota" valor={fmtBRL(compra.valorDesconto)} />
        <Indicador icon={Coins} rotulo="Total" valor={fmtBRL(compra.valorTotal)} dica={compra.icmsRecuperavel ? 'ICMS recuperável abatido' : 'custo com valor cheio'} />
      </div>

      {podeCriar && pendentes.length > 0 && <MapearPendentes compraId={compra.id} itens={pendentes.map((i) => ({ linha: i.linha, descricao: i.descricao ?? `Item ${i.linha}`, unidadeCompra: i.unidadeCompra, quantidade: i.quantidade }))} />}

      <section aria-label="Itens">
        <h3 className="mb-2 text-[15px] font-semibold text-text">Itens</h3>
        <ul className="divide-y divide-[var(--border)] rounded-[var(--r-lg)] bg-surface u-card">
          {compra.itens.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-text">{i.descricao ?? i.produto?.descricao ?? `Item ${i.linha}`}</p>
                <p className="num text-[12px] text-text-muted">
                  {fmtQtd(i.quantidade)} {i.unidadeCompra} × {fmtBRL(i.valorUnitario)}
                  {i.produto ? <> → <span className="text-text">{i.produto.codigo} {i.produto.descricao}</span>{i.fator !== 1 ? ` (×${fmtQtd(i.fator)} ${i.produto.unidade})` : ''}</> : ' · sem produto'}
                </p>
              </div>
              <div className="text-right text-[13px]">
                <p className="num font-medium">{fmtBRL(i.valorTotal - i.desconto)}</p>
                <p className="text-text-muted">{compra.status === 'cancelada' ? 'estornado' : i.lancado ? `entrou a ${i.custoUnitarioBase != null ? fmtBRL(i.custoUnitarioBase) : '—'}${i.produto ? `/${i.produto.unidade}` : ''}` : 'pendente'}</p>
              </div>
            </li>
          ))}
        </ul>
        {compra.obs && <p className="mt-2 text-[13px] text-text-muted">Obs.: {compra.obs}</p>}
      </section>
    </div>
  )
}
