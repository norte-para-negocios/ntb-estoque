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
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { criarAjusteManual } from '@/lib/actions/movimentacoes'

type Local = { codigo_local_estoque: number; descricao: string | null }
type Produto = { id_prod: number; codigo: string; descricao: string }

const TIPOS_AJUSTE: Record<'ENT' | 'SAI', string> = {
  ENT: 'Entrada (sobra / ajuste positivo)',
  SAI: 'Saída (ajuste negativo)',
}

export function NovoAjusteManual({ locais, produto }: { locais: Local[]; produto: Produto }) {
  const [open, setOpen] = useState(false)
  const [tipo, setTipo] = useState<'ENT' | 'SAI'>('SAI')
  const [local, setLocal] = useState('')
  const [quantidade, setQuantidade] = useState('')
  const [motivo, setMotivo] = useState('')
  const hojeBahia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const [data, setData] = useState(hojeBahia)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function criar() {
    const qtd = Number(quantidade.replace(',', '.'))
    if (!local) {
      toast.error('Selecione o local de estoque')
      return
    }
    if (!(qtd > 0)) {
      toast.error('Informe uma quantidade maior que zero')
      return
    }
    if (!motivo.trim()) {
      toast.error('Informe o motivo do ajuste')
      return
    }
    startTransition(async () => {
      const res = await criarAjusteManual({
        idProd: produto.id_prod,
        tipo,
        codigoLocalEstoque: Number(local),
        quantidade: qtd,
        motivo: motivo.trim(),
        data,
      })
      if (res?.error) {
        toast.error(res.error)
        return
      }
      if (res?.status === 'Erro') {
        toast.error(res.erro ?? 'Omie recusou o ajuste')
        return
      }
      if (res?.status === 'Sem CMC') {
        toast.warning('Ajuste gravado, mas o produto ainda não tem custo médio (CMC) fechado no Omie. Reenviar quando tiver.')
      } else {
        toast.success('Ajuste lançado no Omie')
      }
      setOpen(false)
      setQuantidade('')
      setMotivo('')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <Plus className="size-4" /> Novo ajuste
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo ajuste manual</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-[13px] text-text-muted">
            <span className="num">{produto.codigo}</span> {produto.descricao}
          </p>
          <p className="rounded-md border border-border bg-surface/50 px-3 py-2 text-[12px] text-text-muted">
            Só para correção de saldo num local só. Perda/quebra ou transferência entre locais: use a tela de{' '}
            <span className="font-medium text-text">Transferência</span>.
          </p>
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo((v as 'ENT' | 'SAI') ?? 'SAI')}>
              <SelectTrigger>
                <SelectValue>{(v) => TIPOS_AJUSTE[v as 'ENT' | 'SAI'] ?? 'Tipo'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TIPOS_AJUSTE).map(([valor, rotulo]) => (
                  <SelectItem key={valor} value={valor}>
                    {rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Local de estoque</Label>
            <Select value={local} onValueChange={(v) => setLocal((v as string) ?? '')}>
              <SelectTrigger>
                <SelectValue>
                  {(v) => locais.find((l) => String(l.codigo_local_estoque) === v)?.descricao ?? 'Selecione o local'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {locais.map((l) => (
                  <SelectItem key={l.codigo_local_estoque} value={String(l.codigo_local_estoque)}>
                    {l.descricao ?? l.codigo_local_estoque}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Quantidade</Label>
            <input
              type="text"
              inputMode="decimal"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              placeholder="0"
              className="num w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-brand"
            />
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
          </div>
          <div className="space-y-2">
            <Label>Motivo</Label>
            <input
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: contagem física divergente, produto avariado..."
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-brand"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={criar} disabled={pending}>
            {pending && <Spinner />}
            {pending ? 'Lançando...' : 'Lançar ajuste no Omie'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
