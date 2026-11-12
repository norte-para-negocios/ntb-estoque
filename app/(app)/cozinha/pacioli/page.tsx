import { notFound } from 'next/navigation'
import { ChefHat } from 'lucide-react'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { exigirDev } from '@/lib/recursos-dev'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { PacioliChat } from '@/components/custo-cardapio/pacioli/PacioliChat'
import { carregarTaxas } from '@/lib/custo-cardapio/carregar'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { pct } from '@/lib/custo-cardapio/formato'

// Norte Cozinha (só dev): Pacioli, o assistente da cozinha. Só lê (fichas, custo médio, preços, estoque); nunca grava.
// A conversa fica só nesta página (nada no banco). Sem ANTHROPIC_API_KEY no servidor a tela abre no modo rápido.
export default async function PacioliPage() {
  await exigirDev()
  if (!(await getAtorGestao()).podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  const modo = await modoDaLoja(lojaId)
  const temEstoque = modo === 'omie' || modo === 'proprio'
  const taxas = temEstoque ? (await carregarTaxas(lojaId)).taxas : null

  return (
    <div className="space-y-4">
      <PageHeader title="Pacioli" icon={ChefHat}
        description="O assistente da cozinha: custo dos pratos, CMV e preço de venda com os números da loja. Ele só consulta, não muda nada." />
      {taxas ? (
        <PacioliChat temChave={!!process.env.ANTHROPIC_API_KEY} meta={pct(taxas.metaCmv, 0)} />
      ) : (
        <EmptyState icon={ChefHat} title="Esta loja não controla estoque" hint="O Pacioli usa as fichas técnicas e o custo dos insumos, que esta loja não tem." />
      )}
    </div>
  )
}
