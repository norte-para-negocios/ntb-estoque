'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Sparkles, Tags } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { campoCompra } from '@/components/compras-proprio/SeletorProduto'
import { setCategoriaContabilNota, classificarItensPeloProduto } from '@/lib/actions/nota-fiscal'
import { criarCategoriaContabil } from '@/lib/actions/categoria-contabil'

const NOVA = '__nova'
const MISTA = '__mista'

/** Categoria da nota inteira, na cara da tela: vale para todos os itens; exceção por item fica na lista de itens. */
export function ClassificarNotaNF({ notaId, categorias, categoriaAtual, mista, editavel, podeCriar, categoriaOmie = null, compacto = false, sugestao = null }: {
  notaId: number
  categorias: { id: number; nome: string }[]
  /** Todos os itens com a mesma categoria; null = nenhum item classificado. */
  categoriaAtual: number | null
  /** Itens com categorias diferentes. */
  mista: boolean
  editavel: boolean
  podeCriar: boolean
  /** Loja com Omie: a nota já traz a categoria de compra do Omie; ela vale e não se pede outra. */
  categoriaOmie?: { codigo: string; nome: string | null } | null
  /** Dentro do painel de entrada (coluna estreita, sem cartão próprio). */
  compacto?: boolean
  /** Categoria que o sistema sugere (a das últimas notas do fornecedor). */
  sugestao?: { id: number; nome: string; motivo: string } | null
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

  function pelosProdutos() {
    start(async () => {
      const r = await classificarItensPeloProduto(notaId)
      if ('error' in r && r.error) { toast.error('Não foi possível classificar pelos produtos', { description: r.error }); return }
      const x = r as { classificados: number; semRegra: number }
      if (x.classificados === 0) toast.info('Nenhum item pôde ser classificado pelo produto', { description: 'Escolha a categoria da nota acima.' })
      else toast.success(`${x.classificados} ${x.classificados === 1 ? 'item classificado' : 'itens classificados'} pelo tipo do produto`, { description: x.semRegra > 0 ? `${x.semRegra} sem regra: escolha a categoria.` : undefined })
      router.refresh()
    })
  }

  const semCategorias = categorias.length === 0
  if (compacto) {
    if (categoriaOmie) {
      return (
        <div className="grid gap-1 text-[13px]">
          <span className="text-text-muted">Categoria da nota (vem do Omie)</span>
          <span className="font-medium text-text"><span className="num text-text-muted">{categoriaOmie.codigo}</span>{categoriaOmie.nome ? ` · ${categoriaOmie.nome}` : ''}</span>
        </div>
      )
    }
    return (
      <div className="grid gap-1.5 text-[13px]">
        <label htmlFor="cat-nota" className="text-text-muted">Categoria da nota</label>
        <select id="cat-nota" className={`${campoCompra} ${!valor ? 'ring-2 ring-warn/50' : ''}`} value={valor} disabled={!editavel || pending} onChange={(e) => escolher(e.target.value)}>
          <option value="">{semCategorias ? 'Nenhuma categoria cadastrada' : 'Escolher a categoria…'}</option>
          {mista && <option value={MISTA} disabled>Várias (cada item tem a sua)</option>}
          {categorias.map((c) => <option key={c.id} value={String(c.id)}>{c.nome}</option>)}
          {podeCriar && editavel && <option value={NOVA}>+ Nova categoria…</option>}
        </select>
        {editavel && !valor && sugestao && (
          <button type="button" disabled={pending} onClick={() => escolher(String(sugestao.id))}
            className="flex items-start gap-1.5 rounded-[var(--r-md)] bg-brand-soft px-2.5 py-2 text-left text-brand hover:brightness-95">
            <Sparkles className="mt-0.5 size-3.5 shrink-0" />
            <span><span className="font-semibold">Usar {sugestao.nome}</span><span className="block text-[12px] opacity-80">{sugestao.motivo}</span></span>
          </button>
        )}
        {criando && (
          <div className="flex items-end gap-2">
            <input aria-label="Nome da nova categoria" autoFocus className={campoCompra} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Bebidas" onKeyDown={(e) => { if (e.key === 'Enter' && nome.trim()) criar() }} />
            <button type="button" className={btnClass('primary')} disabled={pending || nome.trim().length < 2} onClick={criar}>{pending && <Spinner />}Criar</button>
          </div>
        )}
        {editavel && !semCategorias && (
          <button type="button" className="justify-self-start text-[12.5px] font-medium text-brand hover:underline" disabled={pending} onClick={pelosProdutos}
            title="Cada item recebe a categoria do tipo do produto dele (revenda, matéria-prima, uso e consumo…)">
            Classificar cada item pelo tipo do produto
          </button>
        )}
      </div>
    )
  }
  if (categoriaOmie) {
    return (
      <section aria-label="Categoria da nota" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--r-lg)] bg-surface px-4 py-3 u-card">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-text-muted"><Tags className="size-4" />Categoria da nota (no Omie)</span>
        <span className="text-[14px] font-semibold text-text"><span className="num text-text-muted">{categoriaOmie.codigo}</span>{categoriaOmie.nome ? ` · ${categoriaOmie.nome}` : ''}</span>
        <span className="text-[12px] text-text-muted">Já vem do Omie. Cada item ainda pode ter a sua classificação na lista abaixo.</span>
      </section>
    )
  }
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
        {editavel && !semCategorias && (
          <button type="button" className={btnClass('outline')} disabled={pending} onClick={pelosProdutos} title="Cada item recebe a categoria do tipo do produto dele (revenda, matéria-prima, uso e consumo…)">
            {pending && <Spinner />}Classificar pelos produtos
          </button>
        )}
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
