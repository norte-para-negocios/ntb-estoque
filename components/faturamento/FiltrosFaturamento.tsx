'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { MultiSelect } from '@/components/ui-kit/MultiSelect'
import { Combobox } from '@/components/ui-kit/Combobox'

type Opcao = { value: string; label: string }
const lista = (v: string | null) => (v ?? '').split(',').filter(Boolean)

// Tipo, Familia e Situacao sempre visiveis. Mudar qualquer um mantem periodo/aba e fecha o detalhe aberto.
// Relatórios que não são de venda escondem a Situação (`semSituacao`) e podem mostrar o Fornecedor (`fornecedores`).
export function FiltrosFaturamento({ tipos, familias, semSituacao = false, fornecedores }: {
  tipos: Opcao[]; familias: Opcao[]; semSituacao?: boolean; fornecedores?: string[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  function set(chave: string, valor: string) {
    const q = new URLSearchParams(sp.toString())
    if (valor) q.set(chave, valor)
    else q.delete(chave)
    q.delete('produto')
    router.push(`${pathname}?${q}`)
  }
  const lbl = 'flex flex-col gap-1 text-[12px] text-text-muted'
  const forn = sp.get('fornecedor') ?? ''
  return (
    <div className="flex flex-wrap items-end gap-3">
      {fornecedores && (
        <label className={lbl}>Fornecedor
          <Combobox className="w-full sm:w-64" options={[...(forn && !fornecedores.includes(forn) ? [forn] : []), ...fornecedores].map((f) => ({ value: f, label: f }))}
            value={forn} onChange={(v) => set('fornecedor', v)} placeholder="Todos os fornecedores" />
        </label>
      )}
      <label className={lbl}>Tipo<MultiSelect className="w-52" options={tipos} value={lista(sp.get('tipo'))} onChange={(v) => set('tipo', v.join(','))} placeholder="Todos os tipos" /></label>
      <label className={lbl}>Família<MultiSelect className="w-52" options={familias} value={lista(sp.get('familia'))} onChange={(v) => set('familia', v.join(','))} placeholder="Todas as famílias" /></label>
      {!semSituacao && (
        <label className={lbl}>Situação
          <select value={sp.get('situacao') ?? ''} onChange={(e) => set('situacao', e.target.value)} className="h-9 rounded-[var(--r-md)] border border-border bg-surface px-2 text-sm text-text">
            <option value="">Vendas válidas</option>
            <option value="devolvidas">Só devolvidas</option>
            <option value="canceladas">Só canceladas</option>
          </select>
        </label>
      )}
    </div>
  )
}
