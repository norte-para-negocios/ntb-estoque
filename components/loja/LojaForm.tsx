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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { criarLoja, editarLoja, type LojaInput } from '@/lib/actions/loja'

export type LojaExistente = {
  id: number
  cnpj: string | null
  nome: string | null
  nome_fantasia: string | null
  cep: string | null
  uf: string | null
  cidade: string | null
  bairro: string | null
  logradouro: string | null
  numero: string | null
  omie_app_key: string | null
  omie_app_secret: string | null
  ativo: boolean | null
}

function vazio(): LojaInput {
  return {
    cnpj: '',
    nome: '',
    nome_fantasia: '',
    cep: '',
    uf: '',
    cidade: '',
    bairro: '',
    logradouro: '',
    numero: '',
    omie_app_key: '',
    omie_app_secret: '',
    ativo: true,
  }
}

function fromLoja(l: LojaExistente): LojaInput {
  return {
    cnpj: l.cnpj ?? '',
    nome: l.nome ?? '',
    nome_fantasia: l.nome_fantasia ?? '',
    cep: l.cep ?? '',
    uf: l.uf ?? '',
    cidade: l.cidade ?? '',
    bairro: l.bairro ?? '',
    logradouro: l.logradouro ?? '',
    numero: l.numero ?? '',
    omie_app_key: l.omie_app_key ?? '',
    omie_app_secret: l.omie_app_secret ?? '',
    ativo: l.ativo ?? true,
  }
}

export function LojaForm({ loja }: { loja?: LojaExistente }) {
  const editando = !!loja
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<LojaInput>(loja ? fromLoja(loja) : vazio())
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function set<K extends keyof LojaInput>(campo: K, valor: LojaInput[K]) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  function salvar() {
    if (!form.cnpj.trim() || !form.nome.trim()) {
      toast.error('Preencha CNPJ e nome')
      return
    }
    startTransition(async () => {
      const res = editando ? await editarLoja(loja!.id, form) : await criarLoja(form)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success(editando ? 'Loja atualizada' : 'Loja criada')
      setOpen(false)
      if (!editando) setForm(vazio())
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          editando ? (
            <Button variant="outline" size="sm">
              <Pencil className="size-4" /> Editar
            </Button>
          ) : (
            <Button>
              <Plus className="size-4" /> Nova loja
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editando ? 'Editar loja' : 'Nova loja'}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>CNPJ</Label>
            <Input value={form.cnpj} onChange={(e) => set('cnpj', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={form.nome} onChange={(e) => set('nome', e.target.value)} />
          </div>
          <div className="space-y-2 col-span-2">
            <Label>Nome fantasia</Label>
            <Input
              value={form.nome_fantasia}
              onChange={(e) => set('nome_fantasia', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>CEP</Label>
            <Input value={form.cep} onChange={(e) => set('cep', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>UF</Label>
            <Input value={form.uf} maxLength={2} onChange={(e) => set('uf', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Cidade</Label>
            <Input value={form.cidade} onChange={(e) => set('cidade', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Bairro</Label>
            <Input value={form.bairro} onChange={(e) => set('bairro', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Logradouro</Label>
            <Input value={form.logradouro} onChange={(e) => set('logradouro', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Número</Label>
            <Input value={form.numero} onChange={(e) => set('numero', e.target.value)} />
          </div>
          <div className="space-y-2 col-span-2">
            <Label>Omie App Key</Label>
            <Input
              value={form.omie_app_key}
              onChange={(e) => set('omie_app_key', e.target.value)}
              placeholder="Deixe vazio para loja fora do Omie"
            />
          </div>
          <div className="space-y-2 col-span-2">
            <Label>Omie App Secret</Label>
            <Input
              value={form.omie_app_secret}
              onChange={(e) => set('omie_app_secret', e.target.value)}
              placeholder="Deixe vazio para loja fora do Omie"
            />
          </div>
          <label className="flex items-center gap-2 text-sm col-span-2">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={(e) => set('ativo', e.target.checked)}
            />
            Loja ativa
          </label>
        </div>
        <DialogFooter>
          <Button onClick={salvar} disabled={pending}>
            {pending ? 'Salvando...' : editando ? 'Salvar' : 'Criar loja'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
