'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { editarLojaNegocio, type LojaNegocioInput } from '@/lib/actions/minha-loja'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

function mascaraCep(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8)
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`
}

export type LojaInfo = {
  nome: string | null
  nome_fantasia: string | null
  cnpj: string | null
  cep: string | null
  uf: string | null
  cidade: string | null
  bairro: string | null
  logradouro: string | null
  numero: string | null
  meta_compras_pct: number | null
}

export function InformacoesForm({ loja }: { loja: LojaInfo }) {
  const [form, setForm] = useState<LojaNegocioInput>({
    nome_fantasia: loja.nome_fantasia ?? '',
    cep: loja.cep ?? '',
    uf: loja.uf ?? '',
    cidade: loja.cidade ?? '',
    bairro: loja.bairro ?? '',
    logradouro: loja.logradouro ?? '',
    numero: loja.numero ?? '',
    meta_compras_pct: loja.meta_compras_pct != null ? String(loja.meta_compras_pct) : '',
  })
  const [pending, start] = useTransition()
  const router = useRouter()

  function set<K extends keyof LojaNegocioInput>(k: K, v: LojaNegocioInput[K]) {
    setForm((p) => ({ ...p, [k]: v }))
  }
  function salvar() {
    start(async () => {
      const res = await editarLojaNegocio(form)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Informações salvas')
      router.refresh()
    })
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-1 text-sm font-semibold text-text">Informações da loja</div>
      <p className="mb-3 text-[13px] text-text-muted">
        Dados de negócio e endereço. CNPJ, razão social e integração com o Omie ficam com o administrador geral.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Somente leitura: identidade fiscal */}
        <div className="col-span-2">
          <label className={labelClass}>Razão social</label>
          <input className={`${inputClass} opacity-60`} value={loja.nome ?? '-'} disabled />
        </div>
        <div className="col-span-2">
          <label className={labelClass}>CNPJ</label>
          <input className={`${inputClass} num opacity-60`} value={loja.cnpj ?? '-'} disabled />
        </div>

        <div className="col-span-2 sm:col-span-4">
          <label className={labelClass}>Nome fantasia</label>
          <input className={inputClass} value={form.nome_fantasia} onChange={(e) => set('nome_fantasia', e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>CEP</label>
          <input className={`${inputClass} num`} value={form.cep} maxLength={9} placeholder="XXXXX-XXX" onChange={(e) => set('cep', mascaraCep(e.target.value))} />
        </div>
        <div>
          <label className={labelClass}>UF</label>
          <input className={inputClass} value={form.uf} maxLength={2} placeholder="BA" onChange={(e) => set('uf', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
        </div>
        <div className="col-span-2">
          <label className={labelClass}>Cidade</label>
          <input className={inputClass} value={form.cidade} onChange={(e) => set('cidade', e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className={labelClass}>Bairro</label>
          <input className={inputClass} value={form.bairro} onChange={(e) => set('bairro', e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Logradouro</label>
          <input className={inputClass} value={form.logradouro} onChange={(e) => set('logradouro', e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Número</label>
          <input className={inputClass} value={form.numero} onChange={(e) => set('numero', e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Meta compras ÷ faturamento (%)</label>
          <input
            className={`${inputClass} num`}
            value={form.meta_compras_pct}
            placeholder="40"
            inputMode="decimal"
            onChange={(e) => set('meta_compras_pct', e.target.value.replace(/[^0-9.,]/g, ''))}
          />
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <button type="button" onClick={salvar} disabled={pending} className={btnClass('primary')}>
          {pending && <Spinner />}
          {pending ? 'Salvando...' : 'Salvar informações'}
        </button>
      </div>
    </div>
  )
}
