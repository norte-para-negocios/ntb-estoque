'use client'

import { useState, useTransition } from 'react'
import { Search, Building2, CheckCircle2, Truck, Contact } from 'lucide-react'
import { toast } from 'sonner'
import { consultarCnpj, importarParceiro } from '@/lib/actions/sintegra'
import type { ParceiroOmie } from '@/lib/omie/cliente-fornecedor'
import { btnClass } from '@/components/ui-kit/Button'

const inputClass =
  'w-full rounded-md border border-border bg-surface py-1.5 pl-9 pr-3 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand'

type Estado = 'inicial' | 'buscando' | 'achou' | 'nao_achou'

export function SintegraBusca() {
  const [cnpj, setCnpj] = useState('')
  const [estado, setEstado] = useState<Estado>('inicial')
  const [parceiro, setParceiro] = useState<ParceiroOmie | null>(null)
  const [comoFornecedor, setComoFornecedor] = useState(false)
  const [comoCliente, setComoCliente] = useState(false)
  const [pending, startTransition] = useTransition()
  const [importando, startImport] = useTransition()

  function buscar(e: React.FormEvent) {
    e.preventDefault()
    if (!cnpj.trim()) {
      toast.error('Informe um CNPJ ou CPF')
      return
    }
    setEstado('buscando')
    startTransition(async () => {
      const res = await consultarCnpj(cnpj)
      if ('error' in res) {
        toast.error('Erro', { description: res.error })
        setEstado('inicial')
        return
      }
      if (!res.parceiro) {
        setParceiro(null)
        setEstado('nao_achou')
        return
      }
      setParceiro(res.parceiro)
      setComoFornecedor(res.parceiro.ehFornecedor)
      setComoCliente(res.parceiro.ehCliente)
      setEstado('achou')
    })
  }

  function importar() {
    if (!parceiro) return
    if (!comoFornecedor && !comoCliente) {
      toast.error('Escolha importar como fornecedor e/ou cliente')
      return
    }
    startImport(async () => {
      const res = await importarParceiro(parceiro, { fornecedor: comoFornecedor, cliente: comoCliente })
      if ('error' in res) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success(`Importado como ${res.importados.join(' e ')}`)
    })
  }

  const campos = parceiro
    ? ([
        ['Razão social', parceiro.razao_social],
        ['Nome fantasia', parceiro.nome_fantasia],
        ['CNPJ/CPF', parceiro.cnpj_cpf],
        ['Inscrição estadual', parceiro.inscricao_estadual],
        ['E-mail', parceiro.email],
        ['Telefone', parceiro.telefone],
        [
          'Endereço',
          [parceiro.logradouro, parceiro.numero].filter(Boolean).join(', ') || null,
        ],
        [
          'Cidade/UF',
          [parceiro.cidade, parceiro.uf].filter(Boolean).join('/') || null,
        ],
        ['CEP', parceiro.cep],
      ] as [string, string | null][])
    : []

  return (
    <div className="space-y-4">
      <form onSubmit={buscar} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
            placeholder="Informe o CNPJ ou CPF (ex.: 11.222.333/0001-44)"
            className={inputClass}
          />
        </div>
        <button type="submit" disabled={pending} className={`${btnClass('primary')} shrink-0`}>
          <Search className="size-4" /> {pending ? 'Consultando...' : 'Consultar'}
        </button>
      </form>

      {estado === 'nao_achou' && (
        <div className="rounded-lg border border-border bg-surface p-4 text-[13px] text-text-muted">
          Nenhum cadastro encontrado no Omie para esse CNPJ/CPF. O Omie só localiza quem já está
          cadastrado lá (cliente ou fornecedor).
        </div>
      )}

      {estado === 'achou' && parceiro && (
        <div className="rounded-lg border border-border bg-surface">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Building2 className="size-4 text-brand" />
            <span className="text-sm font-semibold text-text">Cadastro encontrado no Omie</span>
            <span className="ml-auto flex gap-1.5">
              {parceiro.ehFornecedor && (
                <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">
                  Fornecedor
                </span>
              )}
              {parceiro.ehCliente && (
                <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">
                  Cliente
                </span>
              )}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-4 text-[13px] sm:grid-cols-3">
            {campos.map(([label, valor]) => (
              <div key={label}>
                <div className="text-[11px] uppercase tracking-wider text-text-muted">{label}</div>
                <div className="truncate text-text" title={valor ?? undefined}>
                  {valor || '-'}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4 border-t border-border px-4 py-3">
            <span className="text-[13px] font-medium text-text">Importar para o cadastro local como:</span>
            <label className="flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={comoFornecedor}
                onChange={(e) => setComoFornecedor(e.target.checked)}
                className="accent-[var(--brand)]"
              />
              <Truck className="size-4 text-text-muted" /> Fornecedor
            </label>
            <label className="flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={comoCliente}
                onChange={(e) => setComoCliente(e.target.checked)}
                className="accent-[var(--brand)]"
              />
              <Contact className="size-4 text-text-muted" /> Cliente
            </label>
            <button
              type="button"
              onClick={importar}
              disabled={importando}
              className={`${btnClass('primary')} ml-auto`}
            >
              <CheckCircle2 className="size-4" /> {importando ? 'Importando...' : 'Importar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
