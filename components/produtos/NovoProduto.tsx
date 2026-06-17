'use client'

import { useEffect, useState, useTransition } from 'react'
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
import { Label } from '@/components/ui/label'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { criarProduto, buscarFamilias } from '@/lib/actions/produto'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-brand'

// Origem da mercadoria (tabela fiscal padrao). 0 = Nacional (caso mais comum).
const ORIGENS = [
  { value: '0', label: '0 - Nacional' },
  { value: '1', label: '1 - Estrangeira (importação direta)' },
  { value: '2', label: '2 - Estrangeira (mercado interno)' },
  { value: '3', label: '3 - Nacional, importação >40% e ≤70%' },
  { value: '4', label: '4 - Nacional (conforme PPB)' },
  { value: '5', label: '5 - Nacional, importação ≤40%' },
  { value: '6', label: '6 - Estrangeira, imp. direta sem similar' },
  { value: '7', label: '7 - Estrangeira, merc. interno sem similar' },
  { value: '8', label: '8 - Nacional, importação >70%' },
]

export function NovoProduto() {
  const [open, setOpen] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [unidade, setUnidade] = useState('UN')
  const [ncm, setNcm] = useState('')
  const [valor, setValor] = useState('')
  const [tipo, setTipo] = useState('')
  const [familia, setFamilia] = useState('') // codigo_familia (string)
  const [origem, setOrigem] = useState('0')
  const [familias, setFamilias] = useState<{ codigo: number; descricao: string }[]>([])
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  // Carrega as familias existentes ao abrir (familia e obrigatoria no Omie).
  useEffect(() => {
    if (open && familias.length === 0) {
      buscarFamilias().then(setFamilias).catch(() => {})
    }
  }, [open, familias.length])

  function criar() {
    if (!codigo.trim() || !descricao.trim() || !unidade.trim()) {
      toast.error('Preencha código, descrição e unidade')
      return
    }
    if (ncm.replace(/\D/g, '').length !== 8) {
      toast.error('O NCM deve ter 8 dígitos')
      return
    }
    if (!familia) {
      toast.error('Escolha a família do produto')
      return
    }
    const fam = familias.find((f) => String(f.codigo) === familia)
    startTransition(async () => {
      const res = await criarProduto({
        codigo,
        descricao,
        unidade,
        ncm,
        valorUnitario: Number(valor) || 0,
        tipoItem: tipo || undefined,
        codigoFamilia: fam ? fam.codigo : null,
        descricaoFamilia: fam ? fam.descricao : null,
        origem,
      })
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Produto criado no Omie')
      setOpen(false)
      setCodigo('')
      setDescricao('')
      setUnidade('UN')
      setNcm('')
      setValor('')
      setTipo('')
      setFamilia('')
      setOrigem('0')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" /> Novo produto
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo produto</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Código</Label>
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)} className={inputClass} placeholder="Ex.: 90999" />
            </div>
            <div className="space-y-1">
              <Label>Unidade</Label>
              <input value={unidade} onChange={(e) => setUnidade(e.target.value)} className={inputClass} placeholder="UN, KG..." />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Descrição</Label>
            <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={inputClass} placeholder="Nome do produto" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>NCM</Label>
              <input value={ncm} onChange={(e) => setNcm(e.target.value)} className={inputClass} placeholder="8 dígitos" inputMode="numeric" />
            </div>
            <div className="space-y-1">
              <Label>Valor unitário</Label>
              <input type="number" min={0} value={valor} onChange={(e) => setValor(e.target.value)} className={inputClass} placeholder="0,00" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Tipo</Label>
              <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputClass}>
                <option value="">Padrão</option>
                {PRODUTO_TIPO_ITEM.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Origem</Label>
              <select value={origem} onChange={(e) => setOrigem(e.target.value)} className={inputClass}>
                {ORIGENS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Família</Label>
            <select value={familia} onChange={(e) => setFamilia(e.target.value)} className={inputClass}>
              <option value="">Selecione a família</option>
              {familias.map((f) => (
                <option key={f.codigo} value={f.codigo}>
                  {f.descricao}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[12px] text-text-muted">O produto é criado direto no Omie. NCM (8 dígitos) e família são obrigatórios.</p>
        </div>
        <DialogFooter>
          <Button onClick={criar} disabled={pending}>
            {pending ? 'Criando...' : 'Criar no Omie'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
