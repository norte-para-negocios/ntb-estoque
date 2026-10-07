import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, FileUp, PenLine, ReceiptText, ShoppingCart, Wallet } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Lista, type Coluna } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { btnClass } from '@/components/ui-kit/Button'
import { Indicador, fmtBRL } from '@/components/estoque-proprio/Apresentacao'
import { StatusCompra } from '@/components/compras-proprio/StatusCompra'
import { carregarCompras, type CompraLinha } from './dados'

export default async function ComprasPage() {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Compras'))) notFound()
  const podeCriar = await requirePermissao(lojaId, 'Compras - Criar')
  const compras = await carregarCompras(lojaId)

  const mes = new Date().toISOString().slice(0, 7)
  const doMes = compras.filter((c) => c.status !== 'cancelada' && (c.emissao ?? c.criadaEm).slice(0, 7) === mes)
  const pendentes = compras.filter((c) => c.nPendentes > 0)

  const colunas: Coluna<CompraLinha>[] = [
    {
      label: 'Fornecedor', primaria: true, flexivel: true,
      render: (c) => (
        <Link href={`/compras/${c.id}`} className="block min-w-0">
          <span className="block truncate font-medium text-text hover:underline">{c.fornecedorNome || 'Fornecedor não informado'}</span>
          <span className="num text-[12px] text-text-muted">{c.numero ? `NF ${c.numero}` : 'sem número'} · {c.origem === 'xml' ? 'XML' : 'manual'}</span>
        </Link>
      ),
    },
    { label: 'Data', render: (c) => <span className="num">{c.emissao ? new Date(c.emissao + 'T12:00:00').toLocaleDateString('pt-BR') : new Date(c.criadaEm).toLocaleDateString('pt-BR')}</span> },
    { label: 'Itens', alinhar: 'right', ocultarMobile: true, render: (c) => <span className="num">{c.nItens}{c.nPendentes ? <span className="text-warn"> · {c.nPendentes} pend.</span> : null}</span> },
    { label: 'Total', alinhar: 'right', render: (c) => <span className={`num ${c.status === 'cancelada' ? 'text-text-muted line-through' : ''}`}>{fmtBRL(c.valorTotal)}</span> },
    { label: 'Situação', render: (c) => <StatusCompra status={c.status} /> },
  ]

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader title="Compras" description="Notas e compras que entram no estoque"
          actions={podeCriar ? (
            <div className="flex flex-wrap gap-2">
              <Link href="/compras/importar" className={btnClass('primary')}><FileUp className="size-4" />Importar XML</Link>
              <Link href="/compras/nova" className={btnClass('outline')}><PenLine className="size-4" />Lançar sem XML</Link>
            </div>
          ) : undefined} />
      </ListaHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Indicador icon={ShoppingCart} rotulo="Compras no mês" valor={String(doMes.length)} dica="lançadas e parciais" />
        <Indicador icon={Wallet} rotulo="Valor no mês" valor={fmtBRL(doMes.reduce((a, c) => a + c.valorTotal, 0))} />
        <Indicador icon={AlertTriangle} rotulo="Com itens sem produto" valor={String(pendentes.length)} tom={pendentes.length ? 'aviso' : undefined} dica="ligue ao produto para entrar no estoque" />
      </div>

      <Lista colunas={colunas} linhas={compras} chaveLinha={(c) => c.id}
        vazio={<EmptyState icon={ReceiptText} title="Nenhuma compra lançada ainda" hint="Importe o XML da nota do fornecedor ou lance uma compra sem nota para dar entrada no estoque." />} />
    </div>
  )
}
