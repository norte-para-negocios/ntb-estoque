'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui-kit/Spinner'
import { Plus, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { createInventario } from '@/lib/actions/inventario'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'

type Local = { codigo_local_estoque: number; descricao: string }

export function NovoInventario({
  locais,
  familias,
}: {
  locais: Local[]
  familias: string[]
}) {
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<string>('')
  const hojeBahia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const [data, setData] = useState(hojeBahia)
  const [tiposSel, setTiposSel] = useState<string[]>([])
  const [familiasSel, setFamiliasSel] = useState<string[]>([])
  const [mostrarFiltros, setMostrarFiltros] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function toggleTipo(v: string) {
    setTiposSel((prev) => (prev.includes(v) ? prev.filter((t) => t !== v) : [...prev, v]))
  }

  function toggleFamilia(v: string) {
    setFamiliasSel((prev) => (prev.includes(v) ? prev.filter((f) => f !== v) : [...prev, v]))
  }

  function criar() {
    if (!local) {
      toast.error('Selecione um local de estoque')
      return
    }
    startTransition(async () => {
      const filtros =
        tiposSel.length || familiasSel.length
          ? { tipos: tiposSel, familias: familiasSel }
          : undefined
      const inv = await createInventario(Number(local), data, filtros)
      if (inv && 'error' in inv) {
        toast.error(inv.error)
        return
      }
      if (inv?.id) {
        toast.success('Inventário criado')
        setOpen(false)
        router.push(`/inventario/${inv.id}/contagem`)
      }
    })
  }

  const totalFiltros = tiposSel.length + familiasSel.length

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" /> Novo inventário
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo inventário</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Local de estoque</Label>
            <Select value={local} onValueChange={(val) => setLocal((val as string) ?? '')}>
              <SelectTrigger>
                <SelectValue>
                  {(v) =>
                    locais.find((l) => String(l.codigo_local_estoque) === v)?.descricao ??
                    'Selecione o local'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {locais.map((l) => (
                  <SelectItem key={l.codigo_local_estoque} value={String(l.codigo_local_estoque)}>
                    {l.descricao}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Data</Label>
            <input
              type="date"
              value={data}
              max={hojeBahia}
              onChange={(e) => setData(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-brand"
            />
            <p className="text-[11px] text-text-muted">
              Costuma-se considerar o dia anterior (D-1) quando a contagem é feita de manhã.
            </p>
          </div>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setMostrarFiltros((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium text-text hover:text-brand"
            >
              {mostrarFiltros ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              Pré-popular com produtos
              {totalFiltros > 0 && (
                <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand">
                  {totalFiltros}
                </span>
              )}
            </button>
            {mostrarFiltros && (
              <div className="space-y-3 rounded-md border border-border bg-surface-subtle p-3">
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                    Tipo de produto
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {PRODUTO_TIPO_ITEM.map((t) => (
                      <label key={t.value} className="flex cursor-pointer items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          className="accent-brand"
                          checked={tiposSel.includes(t.value)}
                          onChange={() => toggleTipo(t.value)}
                        />
                        <span className="text-text-muted">{t.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                {familias.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                      Família
                    </p>
                    <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                      {familias.map((f) => (
                        <label key={f} className="flex cursor-pointer items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            className="accent-brand"
                            checked={familiasSel.includes(f)}
                            onChange={() => toggleFamilia(f)}
                          />
                          <span className="text-text-muted">{f}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-text-muted">
                  {totalFiltros > 0
                    ? 'Apenas produtos dos tipos/famílias selecionados serão incluídos.'
                    : 'Selecione tipos ou famílias para incluir produtos automaticamente.'}
                </p>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={criar} disabled={pending}>
            {pending && <Spinner />}
            {pending ? 'Criando...' : 'Criar e contar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
