'use client'

import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export function BuscaSimples({
  basePath,
  placeholder,
  defaultValue,
}: {
  basePath: string
  placeholder: string
  defaultValue: string
}) {
  const router = useRouter()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const q = (form.get('q') as string) || ''
    router.push(q ? `${basePath}?q=${encodeURIComponent(q)}` : basePath)
  }

  return (
    <Card className="p-4">
      <form onSubmit={onSubmit} className="flex gap-3">
        <Input name="q" defaultValue={defaultValue} placeholder={placeholder} />
        <Button type="submit">Buscar</Button>
      </form>
    </Card>
  )
}
