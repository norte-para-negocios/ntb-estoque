'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Tags } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { campoCompra } from '@/components/compras-proprio/SeletorProduto'
import { setCategoriaContabilNota } from '@/lib/actions/nota-fiscal'
import { criarCategoriaContabil } from '@/lib/actions/categoria-contabil'

const NOVA = '__nova'
const MISTA = '__mista'

/** Categoria da nota inteira, na cara da tela: vale para todos os itens; exceção por item fica na lista de itens. */
export function ClassificarNotaNF({ notaId, categorias, categoriaAtual, mista, editavel, podeCriar }: {
  notaId: number
  categorias: { id: number; nome: string }[]
  /** Todos os itens com a mesma categoria; null = nenhum item classificado. */
  categoriaAtual: number | null
  /** Itens com categorias diferentes. */
  mista: boolean
  editavel: boolean
  podeCriar: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [valor, setValor] = useState(mista ? MISTA : categoriaAtual != null ? String(categoriaAtual) : '')
  const [nome, setNome] = useState('')
  const criando = valor === NOVA

  function aplicar(id: number | null, anterior: string) {
    start(async () => {
      const r = await setCategoriaContabilNota(notaId, id)
      if ('error' in r && r.error) { toast.error('Não foi possível salvar a categoria', { description: r.error }); setValor(anterior); return }
      toast.success(id == null ? 'Categoria removida da nota' : 'Categoria aplicada a todos os itens')
      router.refresh()
    })
  }

  function escolher(v: string) {
    const anterior = valor
    setValor(v)
    if (v === NOVA || v === MISTA) return
    aplicar(v ? Number(v) : null, anterior)
  }

  function criar() {
    const anterior = mista ? MISTA : categoriaAtual != null ? String(categoriaAtual) : ''
    start(async () => {
      const c = await criarCategoriaContabil({ nome, ativa: true })
      if ('error' in c && c.error) { toast.error('Não foi possível criar a categoria', { description: c.error }); return }
      const r = await setCategoriaContabilNota(notaId, (c as { id: number }).id)
      if ('error' in r && r.error) { toast.error('Categoria criada, mas não aplicada à nota', { description: r.error }); setValor(anterior); router.refresh(); return }
      toast.success('Categoria criada e aplicada à nota')
      setNome('')
      router.refresh()
    })
  }

  const semCategorias = categorias.length === 0
  return (
    <section aria-label="Classificar a nota" className="rounded-[var(--r-lg)] bg-surface p-4 u-card">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[260px] flex-1 space-y-1.5">
          <label htmlFor="cat-nota" className="flex items-center gap-1.5 text-[13px] font-medium text-text-muted"><Tags className="size-4" />Categoria da nota</label>
          <select id="cat-nota" className={`${campoCompra} ${!valor ? 'ring-2 ring-warn/50' : ''}`} value={valor} disabled={!editavel || pending} onChange={(e) => escolher(e.target.value)}>
            <option value="">{semCategorias ? 'Nenhuma categoria cadastrada' : 'Escolher a categoria…'}</option>
            {mista && <option value={MISTA} disabled>Várias (cada item tem a sua)</option>}
            {categorias.map((c) => <option key={c.id} value={String(c.id)}>{c.nome}</option>)}
            {podeCriar && editavel && <option value={NOVA}>+ Nova categoria…</option>}
          </select>
        </div>
        {criando && (
          <div className="flex min-w-[260px] flex-1 items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <label htmlFor="cat-nova" className="text-[13px] font-medium text-text-muted">Nome da nova categoria</label>
              <input id="cat-nova" autoFocus className={campoCompra} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Bebidas" onKeyDown={(e) => { if (e.key === 'Enter' && nome.trim()) criar() }} />
            </div>
            <button type="button" className={btnClass('primary')} disabled={pending || nome.trim().length < 2} onClick={criar}>{pending && <Spinner />}Criar e usar</button>
          </div>
        )}
      </div>
      <p className="mt-2 text-[12px] text-text-muted">Vale para todos os itens da nota. Se algum item for diferente, mude na linha dele.</p>
    </section>
  )
}
