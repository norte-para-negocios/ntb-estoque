'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'

export function NotaFiscalFiltros({
  defaults,
}: {
  defaults: { data_inicio: string; data_final: string; num_nfe: string; fornecedor: string }
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const params = new URLSearchParams(searchParams.toString())
    for (const key of ['data_inicio', 'data_final', 'num_nfe', 'fornecedor']) {
      const val = form.get(key) as string
      if (val) params.set(key, val)
      else params.delete(key)
    }
    router.push(`/nota-fiscal?${params.toString()}`)
  }

  return (
    <Card className="p-4">
      <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <div className="space-y-1">
          <Label htmlFor="data_inicio">De</Label>
          <Input id="data_inicio" name="data_inicio" type="date" defaultValue={defaults.data_inicio} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="data_final">Ate</Label>
          <Input id="data_final" name="data_final" type="date" defaultValue={defaults.data_final} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="num_nfe">Numero NFe</Label>
          <Input id="num_nfe" name="num_nfe" defaultValue={defaults.num_nfe} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fornecedor">Fornecedor</Label>
          <Input id="fornecedor" name="fornecedor" defaultValue={defaults.fornecedor} />
        </div>
        <Button type="submit">Filtrar</Button>
      </form>
    </Card>
  )
}
