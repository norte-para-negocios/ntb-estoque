'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { MultiSelect } from '@/components/ui-kit/MultiSelect'
import { Combobox } from '@/components/ui-kit/Combobox'

type Opcao = { value: string; label: string }
const lista = (v: string | null) => (v ?? '').split(',').filter(Boolean)

// Fornecedor, Familia e Situacao sempre visiveis (mesmo desenho dos filtros do Faturamento).
// Mudar qualquer um mantem periodo/visao, volta pra pagina 1 e fecha o detalhe aberto.
export function FiltrosNotas({ fornecedores, familias, situacoes, children }: {
  fornecedores: string[]
  familias: Opcao[]
  situacoes: Opcao[]
  children?: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  function set(chave: string, valor: string) {
    const q = new URLSearchParams(sp.toString())
    if (valor) q.set(chave, valor)
    else q.delete(chave)
    q.delete('item')
    q.delete('page')
    router.push(`${pathname}?${q}`)
  }
  const atual = sp.get('fornecedor') ?? ''
  // Link antigo com parte do nome: continua valendo e aparece no campo.
  const opcoesForn = [...(atual && !fornecedores.includes(atual) ? [atual] : []), ...fornecedores].map((f) => ({ value: f, label: f }))
  const lbl = 'flex w-full flex-col gap-1 text-[12px] text-text-muted sm:w-auto'
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className={lbl}>Fornecedor
        <Combobox className="w-full sm:w-64" options={opcoesForn} value={atual} onChange={(v) => set('fornecedor', v)} placeholder="Todos os fornecedores" />
      </label>
      <label className={lbl}>Família<MultiSelect className="w-full sm:w-52" options={familias} value={lista(sp.get('familia'))} onChange={(v) => set('familia', v.join(','))} placeholder="Todas as famílias" /></label>
      <label className={lbl}>Situação da nota
        <select value={sp.get('status') ?? ''} onChange={(e) => set('status', e.target.value)} className="h-9 w-full rounded-[var(--r-md)] border border-border bg-surface px-2 text-sm text-text sm:w-auto">
          {situacoes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      {children}
    </div>
  )
}
