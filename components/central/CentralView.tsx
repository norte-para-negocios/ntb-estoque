'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowUpRight, ChevronRight, Lock, Search, Star } from 'lucide-react'
import { CLASSE_TOM, iconeDaSecao, iconeDoItem } from '@/lib/central/icones'
import { NAV_ITEMS } from '@/components/shell/NavItems'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { SegmentedControl } from '@/components/ui-kit/SegmentedControl'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { MODULOS, moduloPorId } from '@/lib/central/modulos'
import {
  moduloVisivel,
  modulosVisiveis,
  type ItemPronto,
  type ModuloPronto,
} from '@/lib/central/visibilidade'
import { useCentral, useFavoritos } from './central-estado'

type Filtro = 'todos' | 'breve' | 'dev'
const FILTROS = [
  { value: 'todos', label: 'Tudo' },
  { value: 'breve', label: 'Em breve' },
  { value: 'dev', label: 'Só dev' },
]

const passa = (i: ItemPronto, f: Filtro) => f === 'todos' || (f === 'breve' ? !!i.emBreve : i.soDev)

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

function Etiquetas({ item }: { item: ItemPronto }) {
  return (
    <>
      {item.emBreve && <span className="rounded-full bg-surface-2 px-1.5 py-px text-[10px] font-semibold text-warn">em breve</span>}
      {item.cadeado && <Lock className="size-3.5 shrink-0 text-text-muted/60" strokeWidth={2} aria-label="Em breve para quem não é administrador" />}
      {item.soDev && <span className="rounded-full bg-brand-soft px-1.5 py-px text-[10px] font-semibold text-brand">só dev</span>}
    </>
  )
}

function Bloco({ label, secao, grande = false }: { label: string; secao?: string; grande?: boolean }) {
  const { Icon, tom } = iconeDoItem(label, secao)
  return (
    <span
      className={`flex shrink-0 items-center justify-center ${grande ? 'size-11 rounded-[14px]' : 'size-8 rounded-[10px]'} ${CLASSE_TOM[tom]}`}
      aria-hidden
    >
      <Icon className={grande ? 'size-[22px]' : 'size-[17px]'} strokeWidth={1.9} />
    </span>
  )
}

function Estrela({ href, favs, alternar }: { href: string; favs: string[]; alternar: (h: string) => void }) {
  const on = favs.includes(href)
  return (
    <button
      type="button"
      onClick={() => alternar(href)}
      aria-pressed={on}
      aria-label={on ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
      title={on ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
      className={`flex size-7 shrink-0 items-center justify-center rounded-full u-motion u-press-sm hover:bg-surface-2 ${
        on ? 'text-warn' : 'text-text-muted/50 hover:text-text'
      }`}
    >
      <Star className="size-4" strokeWidth={2} fill={on ? 'currentColor' : 'none'} />
    </button>
  )
}

/** Item de seção: bloco com ícone + nome, seta à direita (ou texto apagado quando ainda não existe). */
function LinhaItem({ item, secao, favs, alternar }: { item: ItemPronto; secao?: string; favs: string[]; alternar: (h: string) => void }) {
  if (item.emBreve || !item.href) {
    return (
      <li className="flex min-h-11 items-center gap-3 rounded-[12px] px-2 py-1.5 text-[14px] text-text-muted/70 opacity-70">
        <Bloco label={item.label} secao={secao} />
        <span className="flex-1" aria-disabled="true">
          {item.label}
        </span>
        <Etiquetas item={item} />
      </li>
    )
  }
  return (
    <li className="group flex min-h-11 items-center gap-1 rounded-[12px] pr-1 u-motion hover:bg-surface-2">
      <Link href={item.href} className="flex min-h-11 flex-1 items-center gap-3 px-2 py-1.5 text-[14px] font-medium text-text group-hover:text-brand">
        <Bloco label={item.label} secao={secao} />
        <span className="flex-1">{item.label}</span>
        <Etiquetas item={item} />
        <ChevronRight className="size-4 shrink-0 text-text-muted/40 u-motion group-hover:translate-x-0.5 group-hover:text-brand" strokeWidth={2} aria-hidden />
      </Link>
      <Estrela href={item.href} favs={favs} alternar={alternar} />
    </li>
  )
}

function CartaoAtalho({ item, favs, alternar }: { item: ItemPronto; favs: string[]; alternar: (h: string) => void }) {
  const corpo = (
    <div className="flex items-center gap-3.5">
      <Bloco label={item.label} grande />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-text">{item.label}</span>
          <Etiquetas item={item} />
        </div>
        {item.desc && <p className="mt-0.5 text-[13px] leading-snug text-text-muted">{item.desc}</p>}
      </div>
    </div>
  )
  if (item.emBreve || !item.href) {
    return (
      <div className="rounded-[var(--r-lg)] bg-surface p-4 opacity-70 shadow-[var(--shadow-sm)]">
        {corpo}
      </div>
    )
  }
  return (
    <div className="group relative rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)] u-motion hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]">
      <Link href={item.href} className="block p-4 pr-12">
        {corpo}
      </Link>
      <div className="absolute right-2 top-2">
        <Estrela href={item.href} favs={favs} alternar={alternar} />
      </div>
    </div>
  )
}

function SecaoTitulo({ nome }: { nome: string }) {
  const Icon = iconeDaSecao(nome)
  return (
    <h2 className="mb-2 flex items-center gap-2 border-b border-border/60 px-1.5 pb-2.5 pt-1 text-[14px] font-semibold text-text">
      <Icon className="size-[18px] text-brand" strokeWidth={2} aria-hidden />
      {nome}
    </h2>
  )
}

function BarraFavoritos({ favs, modulos, alternar }: { favs: string[]; modulos: ModuloPronto[]; alternar: (h: string) => void }) {
  const todos = modulos.flatMap((m) => [...m.atalhos, ...m.secoes.flatMap((s) => s.itens)])
  const itens = favs
    .map((h) => todos.find((i) => i.href === h))
    .filter((i): i is ItemPronto => !!i && !!i.href)
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted" aria-live="polite">
      <span className="font-semibold">Favoritos:</span>
      {itens.length === 0 ? (
        <span>marque a estrela em qualquer item para fixar aqui.</span>
      ) : (
        itens.map((i) => (
          <span key={i.href} className="inline-flex items-center gap-0.5 rounded-full bg-surface pl-3 pr-1 shadow-[var(--shadow-sm)]">
            <Link href={i.href!} className="py-1 font-medium text-text hover:text-brand">
              {i.label}
            </Link>
            <Estrela href={i.href!} favs={favs} alternar={alternar} />
          </span>
        ))
      )}
    </div>
  )
}

/** Central de um módulo: atalhos, seções (Incluir / Importar / Exibir todos) e relatórios. */
export function CentralModulo({ id }: { id: string }) {
  const central = useCentral()
  const [filtro, setFiltro] = React.useState<Filtro>('todos')
  const [busca, setBusca] = React.useState('')
  const [favs, alternar] = useFavoritos(central?.userId ?? '')

  const modulos = React.useMemo(() => (central ? modulosVisiveis(MODULOS, NAV_ITEMS, central.ctx) : []), [central])
  const base = moduloPorId(id)
  const modulo = React.useMemo(
    () => (central && base ? moduloVisivel(base, NAV_ITEMS, central.ctx) : null),
    [central, base]
  )
  if (!central || !base || !modulo) return null

  const q = norm(busca.trim())
  const Icon = modulo.icone

  // Busca vale para todos os módulos.
  const resultados = q
    ? modulos.flatMap((m) =>
        [
          ...m.atalhos.map((i) => ({ m, secao: 'Atalhos', i })),
          ...m.secoes.flatMap((s) => s.itens.map((i) => ({ m, secao: s.nome, i }))),
        ].filter(({ i, secao }) => !i.ref && passa(i, filtro) && norm(`${m.nome} ${secao} ${i.label} ${i.desc ?? ''}`).includes(q))
      )
    : []

  const atalhos = modulo.atalhos.filter((i) => passa(i, filtro))
  const secoes = modulo.secoes
    .map((s) => ({ ...s, itens: s.itens.filter((i) => passa(i, filtro)) }))
    .filter((s) => s.itens.length > 0)

  return (
    <div className="space-y-5">
      <PageHeader title={modulo.nome} icon={Icon} description={modulo.desc} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative block flex-1">
          <span className="sr-only">Buscar telas e ações</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Ir para qualquer tela ou ação: pagar, XML, DRE…"
            className="h-10 w-full rounded-full bg-surface pl-9 pr-4 text-[14px] text-text shadow-[var(--shadow-sm)] outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-brand"
          />
        </label>
        <SegmentedControl opcoes={FILTROS} value={filtro} onChange={(v) => setFiltro(v as Filtro)} aria-label="Filtrar itens" />
      </div>

      <BarraFavoritos favs={favs} modulos={modulos} alternar={alternar} />

      {q ? (
        resultados.length === 0 ? (
          <EmptyState icon={Search} title="Nada encontrado" hint="Tente outra palavra ou mude o filtro." />
        ) : (
          <div className="rounded-[var(--r-lg)] bg-surface p-2 shadow-[var(--shadow-sm)]">
            {resultados.map(({ m, secao, i }, k) => (
              <div key={`${m.id}-${secao}-${i.label}-${k}`} className="flex items-center gap-2">
                <ul className="flex-1">
                  <LinhaItem item={{ ...i, label: `${secao === 'Atalhos' ? '' : secao + ' › '}${i.label}` }} secao={secao === 'Atalhos' ? undefined : secao} favs={favs} alternar={alternar} />
                </ul>
                <span className="hidden pr-2 text-[12px] text-text-muted sm:block">{m.nome}</span>
              </div>
            ))}
          </div>
        )
      ) : atalhos.length === 0 && secoes.length === 0 ? (
        <EmptyState icon={Icon} title="Nada para mostrar" hint="Nenhum item deste módulo combina com o filtro." />
      ) : (
        <>
          {atalhos.length > 0 && (
            <section>
              <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wide text-text-muted">Atalhos</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {atalhos.map((i, k) => (
                  <CartaoAtalho key={`${i.label}-${k}`} item={i} favs={favs} alternar={alternar} />
                ))}
              </div>
            </section>
          )}
          {secoes.length > 0 && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {secoes.map((s) => (
                <section key={s.nome} className="rounded-[var(--r-lg)] bg-surface p-3 shadow-[var(--shadow-sm)]">
                  <SecaoTitulo nome={s.nome} />
                  <ul className="space-y-0.5">
                    {s.itens.map((i, k) => (
                      <LinhaItem key={`${i.label}-${k}`} item={i} secao={s.nome} favs={favs} alternar={alternar} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Visão geral: favoritos + um cartão por módulo. */
export function CentralGeral() {
  const central = useCentral()
  const [favs, alternar] = useFavoritos(central?.userId ?? '')
  const modulos = React.useMemo(() => (central ? modulosVisiveis(MODULOS, NAV_ITEMS, central.ctx) : []), [central])
  if (!central) return null

  return (
    <div className="space-y-5">
      <PageHeader title="Central" description="Todos os módulos do Norte Estoque num lugar só." />
      <BarraFavoritos favs={favs} modulos={modulos} alternar={alternar} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {modulos.map((m) => {
          const Icon = m.icone
          const total = [...m.atalhos, ...m.secoes.flatMap((s) => s.itens)].filter((i) => !i.ref).length
          return (
            <section key={m.id} className="group relative rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] u-motion hover:shadow-[var(--shadow-md)]">
              <Link href={`/central/${m.id}`} className="flex items-start gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-brand-soft text-brand">
                  <Icon className="size-[22px]" strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-text group-hover:text-brand">{m.nome}</span>
                    <ArrowUpRight className="ml-auto size-4 text-text-muted/30 group-hover:text-brand" />
                  </div>
                  <p className="mt-0.5 text-[13px] text-text-muted">{m.desc}</p>
                  <p className="mt-1 text-[12px] text-text-muted/80">{total} itens</p>
                </div>
              </Link>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {m.atalhos.slice(0, 4).map((i, k) =>
                  i.href && !i.emBreve ? (
                    <li key={`${i.label}-${k}`}>
                      <Link href={i.href} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-muted u-motion hover:text-brand">
                        {React.createElement(iconeDoItem(i.label).Icon, { className: 'size-3.5', strokeWidth: 2, 'aria-hidden': true })}
                        {i.label}
                      </Link>
                    </li>
                  ) : (
                    <li key={`${i.label}-${k}`} className="rounded-full bg-surface-2 px-2.5 py-1 text-[12px] text-text-muted/60">
                      <span aria-disabled="true">{i.label}</span>
                    </li>
                  )
                )}
              </ul>
            </section>
          )
        })}
      </div>
      <p className="text-[12px] text-text-muted">
        Itens com a etiqueta &quot;só dev&quot; ainda não foram lançados para os demais usuários. &quot;em breve&quot; marca o que ainda não existe.
      </p>
    </div>
  )
}
