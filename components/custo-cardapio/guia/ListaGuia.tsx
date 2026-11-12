'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChefHat, Search, X } from 'lucide-react'
import type { ContextoAtivo, ItemGuia, OpcaoContexto } from '@/lib/custo-cardapio/guia'
import { hrefGuia, normalizarBusca } from '@/lib/custo-cardapio/guia-puro'

// Lista do guia: busca, filtro por evento/cardápio e as receitas (com foto e quantidade do contexto).

const campo = 'h-10 w-full rounded-[var(--r-md)] bg-surface-2 px-3 text-[15px] outline-none focus:ring-2 focus:ring-brand/40'

export function ListaGuia({ itens, contextos, ativo, selecionado, passados }: {
  itens: ItemGuia[]; contextos: OpcaoContexto[]; ativo: ContextoAtivo | null; selecionado: number | null; passados: boolean
}) {
  const router = useRouter()
  const [busca, setBusca] = useState('')
  const [tipo, setTipo] = useState<'todos' | 'prato' | 'preparacao'>('todos')
  const ctx = ativo?.chave ?? null

  const visiveis = useMemo(() => {
    const q = normalizarBusca(busca)
    return itens.filter((i) => (tipo === 'todos' || i.tipo === tipo) && (!q || normalizarBusca(`${i.descricao} ${i.codigoTexto} ${i.familia ?? ''}`).includes(q)))
  }, [itens, busca, tipo])

  const eventos = contextos.filter((c) => c.tipo === 'evento')
  const cardapios = contextos.filter((c) => c.tipo === 'cardapio')
  const nPratos = itens.filter((i) => i.tipo === 'prato').length
  const chip = (on: boolean) => `inline-flex h-8 items-center whitespace-nowrap rounded-full px-3 text-[13px] font-semibold u-motion u-press-sm ${on ? 'bg-brand-fill text-white' : 'bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text'}`

  return (
    <aside className="rounded-[var(--r-lg)] bg-surface p-3 shadow-[var(--shadow-sm)] lg:sticky lg:top-4" aria-label="Receitas">
      <div className="space-y-2">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-text-muted">Quantidades para</span>
          <select value={ctx ?? ''} onChange={(e) => router.push(hrefGuia({ ctx: e.target.value || null, p: selecionado, passados }))} className={campo}>
            <option value="">Receita base (sem evento ou cardápio)</option>
            {eventos.length > 0 && (
              <optgroup label="Eventos">
                {eventos.map((c) => <option key={c.chave} value={c.chave}>{c.nome} · {c.sub}</option>)}
              </optgroup>
            )}
            {cardapios.length > 0 && (
              <optgroup label="Cardápios">
                {cardapios.map((c) => <option key={c.chave} value={c.chave}>{c.nome} · {c.sub}</option>)}
              </optgroup>
            )}
            {ativo && !contextos.some((c) => c.chave === ativo.chave) && <option value={ativo.chave}>{ativo.nome} · {ativo.sub}</option>}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[13px] text-text-muted">
          <input type="checkbox" checked={passados} onChange={(e) => router.push(hrefGuia({ ctx, p: selecionado, passados: e.target.checked }))} className="size-4 accent-[var(--brand)]" />
          Incluir eventos que já passaram
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar prato ou preparação" aria-label="Buscar receita" className={`${campo} pl-9`} />
          {busca && <button type="button" onClick={() => setBusca('')} aria-label="Limpar busca" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-muted hover:text-text"><X className="size-4" /></button>}
        </div>
        <div className="flex gap-1.5" role="group" aria-label="Tipo">
          <button type="button" onClick={() => setTipo('todos')} className={chip(tipo === 'todos')} aria-pressed={tipo === 'todos'}>Todos</button>
          <button type="button" onClick={() => setTipo('prato')} className={chip(tipo === 'prato')} aria-pressed={tipo === 'prato'}>Pratos {nPratos}</button>
          <button type="button" onClick={() => setTipo('preparacao')} className={chip(tipo === 'preparacao')} aria-pressed={tipo === 'preparacao'}>Preparações {itens.length - nPratos}</button>
        </div>
      </div>

      <ul className="-mx-1 mt-3 max-h-[45vh] space-y-0.5 overflow-y-auto px-1 lg:max-h-[calc(100dvh-330px)]">
        {visiveis.map((i) => {
          const on = i.codigo === selecionado
          return (
            <li key={i.codigo}>
              <Link href={`${hrefGuia({ ctx, p: i.codigo, passados })}#receita`} scroll={false} aria-current={on ? 'true' : undefined}
                className={`flex items-center gap-3 rounded-[var(--r-md)] p-2 u-motion ${on ? 'bg-brand/10' : 'hover:bg-surface-2'}`}>
                <span className="size-11 shrink-0 overflow-hidden rounded-[10px] bg-surface-2">
                  {i.fotoUrl
                    // eslint-disable-next-line @next/next/no-img-element -- URL assinada do bucket privado
                    ? <img src={i.fotoUrl} alt="" loading="lazy" className="size-full object-cover" />
                    : <span className="flex size-full items-center justify-center text-text-muted/60"><ChefHat className="size-5" strokeWidth={1.5} /></span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[14px] ${on ? 'font-semibold' : 'font-medium'}`}>{i.descricao}</span>
                  <span className="block truncate text-[12px] text-text-muted">
                    {i.tipo === 'preparacao' ? 'Preparação' : 'Prato'}
                    {i.rotuloQtd ? ` · ${i.tipo === 'preparacao' ? 'produzir ' : ''}${i.rotuloQtd}` : ''}
                    {!i.temPreparo ? ' · sem modo de preparo' : ''}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
        {!visiveis.length && <li className="px-2 py-6 text-center text-[13px] text-text-muted">{itens.length ? 'Nada com esse nome.' : 'Nenhuma receita com ficha técnica.'}</li>}
      </ul>
    </aside>
  )
}
