import { notFound, redirect } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { TelaContagem } from '@/components/inventario-proprio/TelaContagem'
import { carregarInventario, carregarItensContagem } from '../../dados'

export default async function ContarPage({ params }: { params: Promise<{ id: string }> }) {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Inventarios - Criar'))) notFound()
  const id = Number((await params).id)
  if (!Number.isFinite(id)) notFound()
  const inv = await carregarInventario(lojaId, id)
  if (!inv) notFound()
  const podeRevisar = await requirePermissao(lojaId, 'Inventarios - Editar')
  if (inv.status !== 'aberto') redirect(podeRevisar ? `/inventario-proprio/${id}/revisar` : '/inventario-proprio')
  const itens = await carregarItensContagem(lojaId, id)
  return (
    <div>
      <PageHeader voltarHref="/inventario-proprio" title={inv.descricao || `Contagem #${inv.id}`} description={`${inv.local} · ${inv.tipo === 'ciclica' ? `cíclica, curva ${inv.classe}` : 'geral'}`} />
      <TelaContagem inventarioId={id} local={inv.local} descricao={inv.descricao} itens={itens.map(({ contadoEm: _c, ...i }) => i)} podeRevisar={podeRevisar} />
    </div>
  )
}
