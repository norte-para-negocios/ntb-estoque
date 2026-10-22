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
import { Combobox } from '@/components/ui-kit/Combobox'
import { Info, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { criarAjusteManual } from '@/lib/actions/movimentacoes'
import { useCriarDaCentral } from '@/lib/use-criar-da-central'

type Local = { codigo_local_estoque: number; descricao: string | null }
type Produto = { id_prod: number; codigo: string; descricao: string }

const TIPOS_AJUSTE: Record<'ENT' | 'SAI', string> = {
  ENT: 'Entrada (sobra / ajuste positivo)',
  SAI: 'Saída (ajuste negativo)',
}

/**
 * Sem `produto`, o formulário pede o produto (`produtos`): é o "+ Ajuste de estoque" do menu novo,
 * que abre direto pela central (`?criar=1`).
 */
export function NovoAjusteManual({ locais, produto: produtoFixo, produtos, proprio = false }: { locais: Local[]; produto?: Produto; produtos?: Produto[]; proprio?: boolean }) {
  const [open, setOpen] = useState(false)
  const [escolhido, setEscolhido] = useState('')
  const produto = produtoFixo ?? produtos?.find((p) => String(p.id_prod) === escolhido) ?? null
  useCriarDaCentral(() => setOpen(true), !produtoFixo)
  const [tipo, setTipo] = useState<'ENT' | 'SAI'>('SAI')
  const [local, setLocal] = useState('')
  const [quantidade, setQuantidade] = useState('')
  const [motivo, setMotivo] = useState('')
  const [custo, setCusto] = useState('')
  const [perda, setPerda] = useState(false)
  const hojeBahia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const [data, setData] = useState(hojeBahia)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function criar() {
    const qtd = Number(quantidade.replace(',', '.'))
    if (!produto) {
      toast.error('Escolha o produto')
      return
    }
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
        // Omie: entrada com custo digitado (vazio = custo médio); saída marcada como perda vai como PER.
        ...(!proprio && tipo === 'ENT' && custo.trim() ? { custoUnitario: Number(custo.replace(',', '.')) } : {}),
        ...(!proprio && tipo === 'SAI' && perda ? { motivoOmie: 'PER' as const } : {}),
      })
      if (res?.error) {
        toast.error(res.error)
        return
      }
      if (res?.status === 'Erro') {
        toast.error(res.erro ?? (proprio ? 'Não foi possível lançar o ajuste' : 'Omie recusou o ajuste'))
        return
      }
      if (res?.status === 'Sem CMC') {
        toast.warning('Ajuste gravado, mas o produto ainda não tem custo médio (CMC) fechado no Omie. Reenviar quando tiver.')
      } else {
        toast.success(proprio ? 'Ajuste lançado no estoque' : 'Ajuste lançado no Omie')
      }
      setOpen(false)
      setQuantidade('')
      setMotivo('')
      setCusto('')
      setPerda(false)
      if (!produtoFixo) setEscolhido('')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <Plus className="size-4" /> {produtoFixo ? 'Novo ajuste' : 'Ajuste de estoque'}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo ajuste manual</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {produtoFixo ? (
            <p className="text-[13px] text-text-muted">
              <span className="num">{produtoFixo.codigo}</span> {produtoFixo.descricao}
            </p>
          ) : (
            <div className="space-y-2">
              <Label>Produto</Label>
              <Combobox
                options={(produtos ?? []).map((p) => ({ value: String(p.id_prod), label: `${p.codigo} · ${p.descricao}` }))}
                value={escolhido}
                onChange={setEscolhido}
                placeholder="Busque pelo nome ou código"
              />
            </div>
          )}
          <p className="flex items-start gap-2.5 rounded-[var(--r-lg)] bg-surface-2 px-4 py-3 text-[13px] text-text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0 text-warn" />
            <span>
            Só para correção de saldo num local só. Perda/quebra ou transferência entre locais: use a tela de{' '}
            <span className="font-medium text-text">Transferência</span>.
            </span>
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
              className="num w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-brand/40 max-sm:text-base"
            />
          </div>
          {!proprio && tipo === 'ENT' && (
            <div className="space-y-2">
              <Label>Custo unitário (opcional, R$)</Label>
              <input
                type="text"
                inputMode="decimal"
                value={custo}
                onChange={(e) => setCusto(e.target.value)}
                placeholder="Vazio = custo médio atual"
                className="num w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-brand/40 max-sm:text-base"
              />
            </div>
          )}
          {!proprio && tipo === 'SAI' && (
            <label className="flex items-center gap-2 text-[13px] text-text">
              <input type="checkbox" checked={perda} onChange={(e) => setPerda(e.target.checked)} />
              É perda ou quebra (vai como perda no Omie)
            </label>
          )}
          <div className="space-y-2">
            <Label>Data</Label>
            <input
              type="date"
              value={data}
              max={hojeBahia}
              onChange={(e) => setData(e.target.value)}
              className="num w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-brand/40 max-sm:text-base"
            />
          </div>
          <div className="space-y-2">
            <Label>Motivo</Label>
            <input
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: contagem física divergente, produto avariado..."
              className="w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-brand/40 max-sm:text-base"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={criar} disabled={pending}>
            {pending && <Spinner />}
            {pending ? 'Lançando...' : proprio ? 'Lançar ajuste' : 'Lançar ajuste no Omie'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
