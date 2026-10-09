import { PageHeader } from '@/components/ui-kit/PageHeader'
import { PainelSincronizacao } from '@/components/desktop/PainelSincronizacao'

export const dynamic = 'force-dynamic'

export default function SincronizacaoPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Sincronização" />
      {process.env.NEXT_PUBLIC_DESKTOP === '1' ? (
        <PainelSincronizacao />
      ) : (
        <p className="text-sm text-text-muted">Esta tela existe só no app Norte Estoque para computador.</p>
      )}
    </div>
  )
}
