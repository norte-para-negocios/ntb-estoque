'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Check, RefreshCw, KeyRound, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { gerarCodigoLoja, removerCodigoLoja } from '@/lib/actions/onboarding-loja'

// Codigo de onboarding da loja (4.5): admin gera/regenera/remove; o funcionario
// usa esse codigo no cadastro para ja entrar vinculado a esta loja.
export function CodigoOnboarding({
  lojaId,
  codigo,
}: {
  lojaId: number
  codigo: string | null
}) {
  const [copiado, setCopiado] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function copiar() {
    if (!codigo) return
    navigator.clipboard.writeText(codigo)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  function gerar() {
    startTransition(async () => {
      const res = await gerarCodigoLoja(lojaId)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success(codigo ? 'Novo código gerado' : 'Código gerado')
      router.refresh()
    })
  }

  function remover() {
    startTransition(async () => {
      const res = await removerCodigoLoja(lojaId)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Código removido')
      router.refresh()
    })
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <KeyRound className="size-4 text-text-muted" />
        <span className="text-[13px] font-medium text-text">Código de onboarding</span>
      </div>
      <p className="mb-2 text-[13px] text-text-muted">
        Quem tiver este código entra no cadastro já vinculado a esta loja (como usuário, sem
        permissões; você ajusta depois). Regenerar invalida o código anterior.
      </p>
      {codigo ? (
        <div className="flex flex-wrap gap-2">
          <input
            value={codigo}
            readOnly
            className="num min-w-[10rem] flex-1 rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-sm font-medium tracking-wider text-text outline-none"
          />
          <button type="button" onClick={copiar} className={`${btnClass('outline')} shrink-0`}>
            {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
          <button
            type="button"
            onClick={gerar}
            disabled={pending}
            className={`${btnClass('outline')} shrink-0`}
          >
            <RefreshCw className="size-4" /> Regenerar
          </button>
          <button
            type="button"
            onClick={remover}
            disabled={pending}
            className={`${btnClass('dangerSoft')} shrink-0`}
          >
            <Trash2 className="size-4" /> Remover
          </button>
        </div>
      ) : (
        <button type="button" onClick={gerar} disabled={pending} className={btnClass('primary')}>
          {pending ? <Spinner /> : <KeyRound className="size-4" />} {pending ? 'Gerando...' : 'Gerar código'}
        </button>
      )}
    </div>
  )
}
