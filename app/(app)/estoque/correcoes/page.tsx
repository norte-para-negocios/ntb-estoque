import { notFound } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { EstoqueAtalhos } from '@/components/estoque-proprio/EstoqueAtalhos'
import { Central } from '@/components/correcoes/Central'
import { carregarCentral } from '@/lib/correcoes/dados'

// Central de correções (14/10/2026): substitui a Saúde do estoque (/estoque/saude redireciona para cá).
export const dynamic = 'force-dynamic'

export default async function CentralCorrecoesPage() {
  const lojaId = await getCurrentLojaId()
  const modo = await modoDaLoja(lojaId)
  if (modo !== 'proprio' && modo !== 'omie') notFound()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) notFound()
  const dados = await carregarCentral(lojaId, modo)
  return (
    <div className="space-y-5">
      <EstoqueAtalhos atual="correcoes" />
      <Central dados={dados} />
    </div>
  )
}
