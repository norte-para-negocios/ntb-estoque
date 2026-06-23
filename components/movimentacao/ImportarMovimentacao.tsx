'use client'

import { useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'

export function ImportarMovimentacao({ label = 'Importar do Omie' }: { label?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const [pending, start] = useTransition()
  const router = useRouter()

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const fd = new FormData()
    fd.append('arquivo', file)
    start(async () => {
      const r = await fetch('/relatorio-movimentacao/importar', { method: 'POST', body: fd })
      const j = (await r.json().catch(() => ({}))) as { error?: string; linhas?: number; ano?: number }
      if (!r.ok) {
        toast.error('Não importou', { description: j.error ?? 'Falha ao importar' })
        return
      }
      toast.success(`Movimentação importada: ${j.linhas} linhas (${j.ano})`)
      router.refresh()
    })
  }

  return (
    <>
      <button type="button" onClick={() => ref.current?.click()} disabled={pending} className={btnClass('primary')}>
        {pending ? <Spinner /> : <Upload className="size-4" />} {pending ? 'Importando...' : label}
      </button>
      <input ref={ref} type="file" accept=".xlsx" className="hidden" onChange={onFile} />
    </>
  )
}
