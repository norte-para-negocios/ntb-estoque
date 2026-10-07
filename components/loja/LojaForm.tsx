'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Plus, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { criarLoja, editarLoja, type LojaInput } from '@/lib/actions/loja'
import type { ModoEstoque } from '@/lib/estoque/ledger'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'

const inputClass =
  'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-sm text-text outline-none transition-colors placeholder:text-text-muted max-sm:text-base focus:ring-2 focus:ring-brand/40'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

// Mascara de CNPJ: remove nao-digitos e formata XX.XXX.XXX/XXXX-XX
function aplicarMascaraCnpj(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

// Mascara de CEP: XXXXX-XXX
function aplicarMascaraCep(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 5) return d
  return `${d.slice(0, 5)}-${d.slice(5)}`
}

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
  modo_estoque?: string | null
  // campos extras (presentes em LojaRow, ignorados no form mas necessarios para
  // o card receber o objeto completo e passar para LojaForm sem erros de tipo)
  [key: string]: unknown
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
    modo_estoque: 'omie',
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
    modo_estoque: l.modo_estoque === 'proprio' || l.modo_estoque === 'nenhum' ? l.modo_estoque : 'omie',
  }
}

export function LojaForm({ loja }: { loja?: LojaExistente }) {
  const editando = !!loja
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<LojaInput>(loja ? fromLoja(loja) : vazio())
  const [criarNoVendas, setCriarNoVendas] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const modoAtual: ModoEstoque = form.modo_estoque ?? 'omie'

  function set<K extends keyof LojaInput>(campo: K, valor: LojaInput[K]) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  function salvar() {
    if (!form.cnpj.trim() || !form.nome.trim()) {
      toast.error('Preencha CNPJ e nome')
      return
    }
    startTransition(async () => {
      const res = editando ? await editarLoja(loja!.id, form) : await criarLoja(form, criarNoVendas)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success(editando ? 'Loja atualizada' : 'Loja criada')
      const aviso = res as { avisoVendas?: string; avisoSemente?: string } | undefined
      if (aviso?.avisoSemente) toast.error('Atenção', { description: aviso.avisoSemente })
      const avisoVendas = aviso?.avisoVendas
      if (!editando && avisoVendas) {
        toast.error('Loja criada, mas o NTB Vendas ficou pendente', { description: avisoVendas })
      } else if (!editando && criarNoVendas) {
        toast.success('Loja criada no NTB Vendas também')
      }
      setOpen(false)
      if (!editando) { setForm(vazio()); setCriarNoVendas(false) }
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          editando ? (
            <button type="button" className={btnClass('outline')}>
              <Pencil className="size-4" /> Editar
            </button>
          ) : (
            <button type="button" className={btnClass('primary')}>
              <Plus className="size-4" /> Nova loja
            </button>
          )
        }
      />
      <DialogContent className="overflow-hidden bg-surface p-0 sm:max-w-lg" showCloseButton={false}>
        <div className="px-5 pb-2 pt-5 text-[17px] font-semibold text-text">
          {editando ? 'Editar loja' : 'Nova loja'}
        </div>
        <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto px-5 py-3">
          <div>
            <label className={labelClass}>CNPJ</label>
            <input
              className={`${inputClass} num`}
              value={form.cnpj}
              placeholder="XX.XXX.XXX/XXXX-XX"
              onChange={(e) => set('cnpj', aplicarMascaraCnpj(e.target.value))}
              maxLength={18}
            />
          </div>
          <div>
            <label className={labelClass}>Nome</label>
            <input className={inputClass} value={form.nome} onChange={(e) => set('nome', e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Nome fantasia</label>
            <input
              className={inputClass}
              value={form.nome_fantasia}
              onChange={(e) => set('nome_fantasia', e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>CEP</label>
            <input
              className={`${inputClass} num`}
              value={form.cep}
              placeholder="XXXXX-XXX"
              maxLength={9}
              onChange={(e) => set('cep', aplicarMascaraCep(e.target.value))}
            />
          </div>
          <div>
            <label className={labelClass}>UF</label>
            <input
              className={inputClass}
              value={form.uf}
              maxLength={2}
              placeholder="BA"
              onChange={(e) => set('uf', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
            />
          </div>
          <div>
            <label className={labelClass}>Cidade</label>
            <input className={inputClass} value={form.cidade} onChange={(e) => set('cidade', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Bairro</label>
            <input className={inputClass} value={form.bairro} onChange={(e) => set('bairro', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Logradouro</label>
            <input
              className={inputClass}
              value={form.logradouro}
              onChange={(e) => set('logradouro', e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Número</label>
            <input className={inputClass} value={form.numero} onChange={(e) => set('numero', e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Como a loja controla estoque</label>
            <select
              className={inputClass}
              value={form.modo_estoque ?? 'omie'}
              onChange={(e) => set('modo_estoque', e.target.value as ModoEstoque)}
            >
              <option value="omie">Integrado ao Omie (espelho do Omie)</option>
              <option value="proprio">Estoque próprio (Norte Estoque é o dono do estoque)</option>
              <option value="nenhum">Sem controle de estoque (só vendas)</option>
            </select>
            <p className="mt-1 text-[12px] text-text-muted">
              {modoAtual === 'proprio'
                ? 'Produtos, locais, entradas, saídas e inventário ficam aqui. A loja já nasce com Estoque Geral, Bar, Cozinha e famílias básicas.'
                : modoAtual === 'nenhum'
                  ? 'A loja só vende: nenhuma baixa de estoque é feita.'
                  : 'O estoque continua sincronizado com o Omie, como hoje.'}
              {editando && ' O modo só pode ser trocado antes do primeiro movimento de estoque próprio.'}
            </p>
          </div>
          {modoAtual === 'omie' && (
            <>
          <div className="col-span-2">
            <label className={labelClass}>Omie App Key</label>
            <input
              className={inputClass}
              value={form.omie_app_key}
              onChange={(e) => set('omie_app_key', e.target.value)}
              placeholder="Deixe vazio para loja fora do Omie"
            />
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Omie App Secret</label>
            <input
              className={inputClass}
              value={form.omie_app_secret}
              onChange={(e) => set('omie_app_secret', e.target.value)}
              placeholder="Deixe vazio para loja fora do Omie"
            />
          </div>
            </>
          )}
          <label className="col-span-2 flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={(e) => set('ativo', e.target.checked)}
              className="accent-[var(--brand)]"
            />
            Loja ativa
          </label>
          {!editando && (
            <label className="col-span-2 flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={criarNoVendas}
                onChange={(e) => setCriarNoVendas(e.target.checked)}
                className="accent-[var(--brand)]"
              />
              Criar no NTB Vendas também
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-3">
          <button type="button" onClick={salvar} disabled={pending} className={btnClass('primary')}>
            {pending && <Spinner />}
            {pending ? 'Salvando...' : editando ? 'Salvar' : 'Criar loja'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
