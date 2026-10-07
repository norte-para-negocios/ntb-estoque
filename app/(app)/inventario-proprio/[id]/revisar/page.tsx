import { notFound } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { RevisarContagem } from '@/components/inventario-proprio/RevisarContagem'
import { carregarInventario, carregarVariancia, limiteMotivo } from '../../dados'

export default async function RevisarPage({ params }: { params: Promise<{ id: string }> }) {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  // Só quem fecha a contagem vê o saldo do sistema (a tela de contagem nunca mostra).
  if (!(await requirePermissao(lojaId, 'Inventarios - Editar'))) notFound()
  const id = Number((await params).id)
  if (!Number.isFinite(id)) notFound()
  const inv = await carregarInventario(lojaId, id)
  if (!inv) notFound()
  const [linhas, limite] = await Promise.all([carregarVariancia(lojaId, id), limiteMotivo(lojaId)])
  const status = inv.status === 'aberto' ? 'Revisão antes de fechar' : inv.status === 'fechado' ? 'Contagem fechada' : 'Contagem cancelada'
  return (
    <div className="space-y-4">
      <PageHeader voltarHref="/inventario-proprio" title={inv.descricao || `Contagem #${inv.id}`} description={`${status} · ${inv.local}`} />
      <RevisarContagem inventarioId={id} linhas={linhas} fechado={inv.status !== 'aberto'} limite={limite} />
    </div>
  )
}
