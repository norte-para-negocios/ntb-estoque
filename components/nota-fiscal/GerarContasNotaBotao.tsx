'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { gerarContasPagarDaNota } from '@/lib/actions/financeiro'

/** "Gerar agora" (só desenvolvedor): gera à mão a conta a pagar da nota (falha da automática, ou loja com a geração automática desligada). */
export function GerarContasNotaBotao({ notaId }: { notaId: number }) {
  const [pendente, start] = useTransition()
  const router = useRouter()
  return (
    <button type="button" className={btnClass('outline')} disabled={pendente} onClick={() => start(async () => {
      const r = await gerarContasPagarDaNota(notaId)
      if ('error' in r) { toast.error(r.error); return }
      if (r.gerados > 0) toast.success(r.gerados === 1 ? '1 conta a pagar gerada.' : `${r.gerados} contas a pagar geradas.`)
      else toast.info(r.motivo ?? 'Nada a gerar: as parcelas desta nota já têm conta a pagar.')
      router.refresh()
    })}>
      <RefreshCw className="size-4" />{pendente ? 'Gerando…' : 'Gerar agora'}
    </button>
  )
}
