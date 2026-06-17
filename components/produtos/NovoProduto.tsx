'use client'

import { useEffect, useState, useTransition, type ReactNode } from 'react'
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

const EXTRA_VAZIO = {
  ean: '', descrDetalhada: '', obsInternas: '', marca: '', modelo: '',
  pesoLiq: '', pesoBruto: '', altura: '', largura: '', profundidade: '', cest: '',
}

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

export function NovoProduto() {
  const [open, setOpen] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [unidade, setUnidade] = useState('UN')
  const [ncm, setNcm] = useState('')
  const [valor, setValor] = useState('')
  const [tipo, setTipo] = useState('')
  const [familia, setFamilia] = useState('')
  const [origem, setOrigem] = useState('0')
  const [familias, setFamilias] = useState<{ codigo: number; descricao: string }[]>([])
  const [extra, setExtra] = useState({ ...EXTRA_VAZIO })
  const setX = (k: keyof typeof extra, v: string) => setExtra((e) => ({ ...e, [k]: v }))
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  // Carrega as familias existentes ao abrir (familia e obrigatoria no Omie).
  useEffect(() => {
    if (open && familias.length === 0) buscarFamilias().then(setFamilias).catch(() => {})
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
    const num = (s: string) => {
      const n = Number(s.replace(',', '.'))
      return Number.isFinite(n) && n > 0 ? n : undefined
    }
    startTransition(async () => {
      const res = await criarProduto({
        codigo,
        descricao,
        unidade,
        ncm,
        valorUnitario: Number(valor.replace(',', '.')) || 0,
        tipoItem: tipo || undefined,
        codigoFamilia: fam ? fam.codigo : null,
        descricaoFamilia: fam ? fam.descricao : null,
        origem,
        ean: extra.ean || undefined,
        descrDetalhada: extra.descrDetalhada || undefined,
        obsInternas: extra.obsInternas || undefined,
        marca: extra.marca || undefined,
        modelo: extra.modelo || undefined,
        pesoLiq: num(extra.pesoLiq),
        pesoBruto: num(extra.pesoBruto),
        altura: num(extra.altura),
        largura: num(extra.largura),
        profundidade: num(extra.profundidade),
        cest: extra.cest || undefined,
      })
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Produto criado no Omie')
      setOpen(false)
      setCodigo(''); setDescricao(''); setUnidade('UN'); setNcm(''); setValor('')
      setTipo(''); setFamilia(''); setOrigem('0'); setExtra({ ...EXTRA_VAZIO })
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
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo produto</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Identificacao */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Código">
                <input value={codigo} onChange={(e) => setCodigo(e.target.value)} className={inputClass} placeholder="Ex.: 90999" />
              </Campo>
              <Campo label="Unidade">
                <input value={unidade} onChange={(e) => setUnidade(e.target.value)} className={inputClass} placeholder="UN, KG..." />
              </Campo>
            </div>
            <Campo label="Descrição">
              <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={inputClass} placeholder="Nome do produto" />
            </Campo>
            <Campo label="Descrição detalhada">
              <textarea value={extra.descrDetalhada} onChange={(e) => setX('descrDetalhada', e.target.value)} className={inputClass} rows={2} placeholder="Opcional" />
            </Campo>
            <div className="grid grid-cols-3 gap-3">
              <Campo label="NCM">
                <input value={ncm} onChange={(e) => setNcm(e.target.value)} className={inputClass} placeholder="8 dígitos" inputMode="numeric" />
              </Campo>
              <Campo label="EAN / cód. barras">
                <input value={extra.ean} onChange={(e) => setX('ean', e.target.value)} className={inputClass} placeholder="Opcional" inputMode="numeric" />
              </Campo>
              <Campo label="Valor unitário">
                <input type="number" min={0} step="any" value={valor} onChange={(e) => setValor(e.target.value)} className={inputClass} placeholder="0,00" />
              </Campo>
            </div>
          </div>

          {/* Classificacao */}
          <div className="space-y-3 border-t border-border pt-3">
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Família">
                <select value={familia} onChange={(e) => setFamilia(e.target.value)} className={inputClass}>
                  <option value="">Selecione</option>
                  {familias.map((f) => (
                    <option key={f.codigo} value={f.codigo}>{f.descricao}</option>
                  ))}
                </select>
              </Campo>
              <Campo label="Tipo">
                <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputClass}>
                  <option value="">Padrão</option>
                  {PRODUTO_TIPO_ITEM.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </Campo>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Marca">
                <input value={extra.marca} onChange={(e) => setX('marca', e.target.value)} className={inputClass} placeholder="Opcional" />
              </Campo>
              <Campo label="Modelo">
                <input value={extra.modelo} onChange={(e) => setX('modelo', e.target.value)} className={inputClass} placeholder="Opcional" />
              </Campo>
            </div>
          </div>

          {/* Fiscal */}
          <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
            <Campo label="Origem">
              <select value={origem} onChange={(e) => setOrigem(e.target.value)} className={inputClass}>
                {ORIGENS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Campo>
            <Campo label="CEST">
              <input value={extra.cest} onChange={(e) => setX('cest', e.target.value)} className={inputClass} placeholder="Opcional (validado pelo Omie)" inputMode="numeric" />
            </Campo>
          </div>

          {/* Logistica */}
          <div className="space-y-3 border-t border-border pt-3">
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Peso líq. (kg)">
                <input type="number" min={0} step="any" value={extra.pesoLiq} onChange={(e) => setX('pesoLiq', e.target.value)} className={inputClass} placeholder="0" />
              </Campo>
              <Campo label="Peso bruto (kg)">
                <input type="number" min={0} step="any" value={extra.pesoBruto} onChange={(e) => setX('pesoBruto', e.target.value)} className={inputClass} placeholder="0" />
              </Campo>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Campo label="Altura (cm)">
                <input type="number" min={0} step="any" value={extra.altura} onChange={(e) => setX('altura', e.target.value)} className={inputClass} placeholder="0" />
              </Campo>
              <Campo label="Largura (cm)">
                <input type="number" min={0} step="any" value={extra.largura} onChange={(e) => setX('largura', e.target.value)} className={inputClass} placeholder="0" />
              </Campo>
              <Campo label="Profund. (cm)">
                <input type="number" min={0} step="any" value={extra.profundidade} onChange={(e) => setX('profundidade', e.target.value)} className={inputClass} placeholder="0" />
              </Campo>
            </div>
          </div>

          {/* Extras */}
          <div className="border-t border-border pt-3">
            <Campo label="Observações internas">
              <textarea value={extra.obsInternas} onChange={(e) => setX('obsInternas', e.target.value)} className={inputClass} rows={2} placeholder="Opcional" />
            </Campo>
          </div>

          <p className="text-[12px] text-text-muted">
            Criado direto no Omie. Obrigatórios: código, descrição, unidade, NCM (8 dígitos) e família. O resto é opcional.
          </p>
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
