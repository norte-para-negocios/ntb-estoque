'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react'
import { ArrowRight, ChevronDown, ChevronRight, Lock, Plus, Search, Star } from 'lucide-react'
import { NAV_ITEMS } from '@/components/shell/NavItems'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { SPRING_TAP, SPRING_UI } from '@/lib/motion'
import { MODULOS, moduloPorId } from '@/lib/central/modulos'
import { CLASSE_TOM, iconeDaSecao, iconeDoItem } from '@/lib/central/icones'
import { organizar, rotuloBotao, varianteBotao } from '@/lib/central/organizar'
import {
  moduloVisivel,
  modulosVisiveis,
  type ItemPronto,
  type ModuloPronto,
  type SecaoPronta,
} from '@/lib/central/visibilidade'
import { useCentral, useFavoritos } from './central-estado'
import { numerosDaCentral } from '@/lib/actions/central-numeros'
import { destaquesDoModulo, formatarValor, type Numero, type Numeros } from '@/lib/central/numeros'

// A cena 3D é um pedaço à parte (three.js): só baixa quem abre uma central.
const CenaCentral = dynamic(() => import('./CenaCentral'), { ssr: false })

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// ---------- movimento ----------
const lista: Variants = { oculto: {}, visivel: { transition: { staggerChildren: 0.03, delayChildren: 0.02 } } }
const entra: Variants = {
  oculto: { opacity: 0, y: 10 },
  visivel: { opacity: 1, y: 0, transition: { type: 'spring', bounce: 0.1, duration: 0.35 } },
}
const semMovimento: Variants = { oculto: { opacity: 1 }, visivel: { opacity: 1 } }

/** Cena 3D só de tablet para cima: no celular nem baixa a biblioteca. */
function useTelaLarga() {
  const [larga, setLarga] = React.useState(false)
  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const ler = () => setLarga(mq.matches)
    ler()
    mq.addEventListener('change', ler)
    return () => mq.removeEventListener('change', ler)
  }, [])
  return larga
}

// ---------- números do dia ----------
// Contagens leves (só "quantos"), pedidas a cada vez que a página abre; até chegarem, a tela mostra a descrição.
function useNumeros(): Numeros {
  const [numeros, setNumeros] = React.useState<Numeros>({})
  React.useEffect(() => {
    let vivo = true
    numerosDaCentral()
      .then((n) => vivo && setNumeros(n))
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [])
  return numeros
}

function Valor({ n, claro = false, grande = false }: { n: Numero; claro?: boolean; grande?: boolean }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span
        className={`num font-semibold tracking-[-0.02em] ${grande ? 'text-[28px]' : 'text-[22px]'} leading-none ${
          claro ? 'text-white' : n.alerta ? 'text-[var(--tone-warn)]' : 'text-text'
        }`}
      >
        {formatarValor(n.valor)}
      </span>
      <span className={`truncate text-[13px] ${claro ? 'text-white/85' : 'text-text-muted'}`}>{n.rotulo}</span>
    </span>
  )
}

function useVariantes() {
  const reduzir = useReducedMotion()
  return { lista: reduzir ? semMovimento : lista, entra: reduzir ? semMovimento : entra, reduzir: !!reduzir }
}

// ---------- peças ----------
function Bloco({ label, secao, href, tamanho = 'm' }: { label: string; secao?: string; href?: string; tamanho?: 'p' | 'm' | 'g' }) {
  const { Icon, tom } = iconeDoItem(label, secao, href)
  const cls = tamanho === 'g' ? 'size-12 rounded-[16px]' : tamanho === 'm' ? 'size-10 rounded-[13px]' : 'size-8 rounded-[10px]'
  const ic = tamanho === 'g' ? 'size-[23px]' : tamanho === 'm' ? 'size-[19px]' : 'size-[16px]'
  return (
    <span className={`flex shrink-0 items-center justify-center ${cls} ${CLASSE_TOM[tom]}`} aria-hidden>
      <Icon className={ic} strokeWidth={1.9} />
    </span>
  )
}

function Etiquetas({ item, claro = false }: { item: ItemPronto; claro?: boolean }) {
  return (
    <>
      {item.cadeado && <Lock className="size-3.5 shrink-0 text-text-muted/60" strokeWidth={2} aria-label="Em breve para quem não é administrador" />}
      {item.soDev && (
        <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${claro ? 'bg-white/25 text-white' : 'bg-brand-soft text-brand'}`}>só dev</span>
      )}
    </>
  )
}

/** Estrela de favorito: só aparece quando você aponta para o item (ou já é favorito). */
function Estrela({ href, favs, alternar }: { href: string; favs: string[]; alternar: (h: string) => void }) {
  const on = favs.includes(href)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        alternar(href)
      }}
      aria-pressed={on}
      aria-label={on ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
      title={on ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
      className={`flex size-7 shrink-0 items-center justify-center rounded-full u-motion u-press-sm hover:bg-surface-2 focus-visible:opacity-100 [@media(hover:none)]:size-11 ${
        on ? 'text-warn opacity-100' : 'text-text-muted/60 opacity-0 hover:text-text group-hover:opacity-100 [@media(hover:none)]:opacity-100'
      }`}
    >
      <Star className="size-4" strokeWidth={2} fill={on ? 'currentColor' : 'none'} />
    </button>
  )
}

function Titulo({ children, n }: { children: React.ReactNode; n?: number }) {
  return (
    <h2 className="mb-3 flex items-baseline gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-muted">
      {children}
      {n != null && <span className="font-medium normal-case tracking-normal text-text-muted/60">{n}</span>}
    </h2>
  )
}

// ---------- telas do módulo (opção B: cada tela com o número do dia) ----------
function CartaoTela({
  item,
  principal,
  numero,
  favs,
  alternar,
}: {
  item: ItemPronto
  principal: boolean
  numero?: Numero
  favs: string[]
  alternar: (h: string) => void
}) {
  const v = useVariantes()
  const { Icon } = iconeDoItem(item.label, undefined, item.href)
  return (
    <motion.div variants={v.entra} className={`h-full min-w-0 ${principal ? 'sm:col-span-2' : ''}`}>
      <motion.div
        whileHover={v.reduzir ? undefined : { y: -3 }}
        whileTap={v.reduzir ? undefined : { scale: 0.985 }}
        transition={SPRING_UI}
        className={`group relative h-full rounded-[20px] transition-shadow duration-200 ${
          principal
            ? 'bg-[linear-gradient(135deg,var(--brand-fill),var(--brand-fill-hover))] text-white shadow-[0_14px_34px_-16px_var(--brand-fill)]'
            : 'bg-surface shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)]'
        }`}
      >
        <Link
          href={item.href!}
          className={`flex h-full min-h-[112px] flex-col justify-between gap-4 rounded-[20px] p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset ${
            principal ? 'focus-visible:ring-white' : 'focus-visible:ring-brand'
          }`}
        >
          <span className="flex items-start gap-3 pr-7 [@media(hover:none)]:pr-11">
            {principal ? (
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[13px] bg-white/20" aria-hidden>
                <Icon className="size-[19px]" strokeWidth={1.9} />
              </span>
            ) : (
              <Bloco label={item.label} href={item.href} />
            )}
            <span className="min-w-0 flex-1 pt-0.5">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`text-[15px] font-semibold leading-snug ${principal ? '' : 'text-text group-hover:text-brand'}`}>{item.label}</span>
                {numero?.alerta && <span className="size-2 rounded-full bg-[var(--tone-warn)]" aria-label="Precisa de atenção" />}
                <Etiquetas item={item} claro={principal} />
              </span>
              {(principal || !numero) && item.desc && (
                <span className={`mt-0.5 line-clamp-2 block text-[13px] leading-snug ${principal ? 'text-white/85' : 'text-text-muted'}`}>{item.desc}</span>
              )}
            </span>
          </span>
          {numero ? (
            <Valor n={numero} claro={principal} grande={principal} />
          ) : (
            <ArrowRight
              className={`size-[17px] self-end opacity-0 transition duration-300 group-hover:opacity-100 ${principal ? 'text-white' : 'text-brand'}`}
              strokeWidth={2.2}
              aria-hidden
            />
          )}
        </Link>
        <div className="absolute right-2 top-2">
          <Estrela href={item.href!} favs={favs} alternar={alternar} />
        </div>
      </motion.div>
    </motion.div>
  )
}

// ---------- consultas (uma tela por linha) ----------
function CartaoConsulta({ item, secao, favs, alternar }: { item: ItemPronto; secao?: string; favs: string[]; alternar: (h: string) => void }) {
  const v = useVariantes()
  return (
    <motion.div variants={v.entra} className="h-full min-w-0">
      <motion.div
        whileHover={v.reduzir ? undefined : { y: -2 }}
        whileTap={v.reduzir ? undefined : { scale: 0.985 }}
        transition={SPRING_UI}
        className="group relative h-full rounded-[18px] bg-surface shadow-[var(--shadow-sm)] transition-shadow duration-200 hover:shadow-[var(--shadow-md)]"
      >
        <Link href={item.href!} className="flex h-full min-h-[68px] items-center gap-3.5 rounded-[18px] p-3.5 pr-9 [@media(hover:none)]:pr-14">
          <Bloco label={item.label} secao={secao} href={item.href} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="text-[15px] leading-snug font-semibold text-text group-hover:text-brand">{item.label}</span>
              <Etiquetas item={item} />
            </span>
            {item.desc && <span className="line-clamp-2 text-[13px] text-text-muted">{item.desc}</span>}
          </span>
          <ChevronRight className="size-4 shrink-0 text-text-muted/40 u-motion group-hover:translate-x-0.5 group-hover:text-brand" strokeWidth={2} aria-hidden />
        </Link>
        <div className="absolute right-1 top-1">
          <Estrela href={item.href!} favs={favs} alternar={alternar} />
        </div>
      </motion.div>
    </motion.div>
  )
}

// ---------- cadastros (uma coisa, vários botões) ----------
const CLASSE_BOTAO = {
  novo: 'bg-brand-fill text-white hover:bg-[var(--brand-fill-hover)]',
  importar: 'bg-brand-soft text-brand hover:bg-brand-fill hover:text-white',
  padrao: 'bg-surface-2 text-text hover:bg-brand-fill hover:text-white',
} as const

function CartaoCadastro({ secao }: { secao: SecaoPronta }) {
  const v = useVariantes()
  // O ícone do cadastro é o da tela dele ("Exibir todos"): o mesmo do menu lateral.
  const exibir = secao.itens.find((i) => /^exibir/i.test(i.label))
  const Icon = exibir ? iconeDoItem(secao.nome, undefined, exibir.href).Icon : iconeDaSecao(secao.nome)
  return (
    <motion.section variants={v.entra} className="flex flex-col gap-3.5 rounded-[20px] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-start gap-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[13px] bg-brand-soft text-brand" aria-hidden>
          {React.createElement(Icon, { className: 'size-[19px]', strokeWidth: 1.9 })}
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-tight text-text">{secao.nome}</h3>
          {secao.desc && <p className="mt-0.5 text-[13px] text-text-muted">{secao.desc}</p>}
        </div>
      </div>
      <div className="mt-auto flex flex-wrap gap-1.5">
        {secao.itens.map((i, k) => (
          <motion.span key={`${i.label}-${k}`} whileTap={v.reduzir ? undefined : { scale: 0.94 }} transition={SPRING_TAP} className="inline-flex">
            <Link
              href={i.href!}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold u-motion ${CLASSE_BOTAO[varianteBotao(i.label)]}`}
            >
              {rotuloBotao(i.label)}
              <Etiquetas item={i} />
            </Link>
          </motion.span>
        ))}
      </div>
    </motion.section>
  )
}

// ---------- relatórios ----------
function ChipRelatorio({ item }: { item: ItemPronto }) {
  const v = useVariantes()
  const { Icon } = iconeDoItem(item.label, undefined, item.href)
  return (
    <motion.span variants={v.entra} whileHover={v.reduzir ? undefined : { y: -2 }} whileTap={v.reduzir ? undefined : { scale: 0.96 }} transition={SPRING_UI}>
      <Link
        href={item.href!}
        className="inline-flex h-10 items-center gap-2 rounded-full bg-surface px-4 text-[14px] font-medium text-text shadow-[var(--shadow-sm)] u-motion hover:text-brand hover:shadow-[var(--shadow-md)]"
      >
        <Icon className="size-4 text-text-muted" strokeWidth={2} aria-hidden />
        {item.label}
        <Etiquetas item={item} />
      </Link>
    </motion.span>
  )
}

// ---------- gaveta "em breve" ----------
function Gaveta({ itens }: { itens: string[] }) {
  const [aberta, setAberta] = React.useState(false)
  const v = useVariantes()
  if (itens.length === 0) return null
  return (
    <div className="rounded-[22px] bg-surface shadow-[var(--shadow-sm)]">
      <button
        type="button"
        onClick={() => setAberta((a) => !a)}
        aria-expanded={aberta}
        className="flex w-full items-center justify-between rounded-[22px] px-5 py-4 text-left text-[14px] font-semibold text-text-muted u-motion hover:text-text"
      >
        <span>
          Em breve <span className="ml-1 font-medium text-text-muted/60">{itens.length} itens a caminho</span>
        </span>
        <motion.span animate={{ rotate: aberta ? 180 : 0 }} transition={SPRING_UI}>
          <ChevronDown className="size-4" aria-hidden />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {aberta && (
          <motion.div
            initial={v.reduzir ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={v.reduzir ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={SPRING_UI}
            className="overflow-hidden"
          >
            <ul className="flex flex-wrap gap-2 px-5 pb-5">
              {itens.map((t) => (
                <li key={t} className="rounded-full bg-surface-2 px-3 py-1.5 text-[13px] text-text-muted">
                  {t}
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------- favoritos ----------
const todosItens = (m: ModuloPronto) => [...m.novos, ...m.telas, ...m.secoes.flatMap((s) => s.itens)]

function BarraFavoritos({ favs, modulos, alternar }: { favs: string[]; modulos: ModuloPronto[]; alternar: (h: string) => void }) {
  const todos = modulos.flatMap(todosItens)
  const itens = favs.map((h) => todos.find((i) => i.href === h)).filter((i): i is ItemPronto => !!i && !!i.href)
  if (itens.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted" aria-live="polite">
      <Star className="size-4 text-warn" fill="currentColor" aria-hidden />
      {itens.map((i) => (
        <span key={i.href} className="group inline-flex items-center gap-0.5 rounded-full bg-surface pl-3 pr-1 shadow-[var(--shadow-sm)]">
          <Link href={i.href!} className="py-1 font-medium text-text hover:text-brand">
            {i.label}
          </Link>
          <Estrela href={i.href!} favs={favs} alternar={alternar} />
        </span>
      ))}
    </div>
  )
}

// ---------- faixa "Novo" (criar documentos) ----------
function BotaoNovo({ item }: { item: ItemPronto }) {
  const v = useVariantes()
  return (
    <motion.span variants={v.entra} whileHover={v.reduzir ? undefined : { y: -2 }} whileTap={v.reduzir ? undefined : { scale: 0.96 }} transition={SPRING_UI} className="inline-flex">
      <Link
        href={item.href!}
        className="inline-flex h-10 items-center gap-2 rounded-full bg-brand-fill pl-3 pr-4 text-[14px] font-semibold text-white shadow-[var(--shadow-sm)] u-motion outline-none hover:bg-[var(--brand-fill-hover)] focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      >
        <Plus className="size-4" strokeWidth={2.4} aria-hidden />
        {item.label}
        <Etiquetas item={item} claro />
      </Link>
    </motion.span>
  )
}

// ---------- cabeçalho com cena 3D (baixo: o primeiro botão aparece sem rolar) ----------
function Cabecalho({
  id,
  nome,
  desc,
  busca,
  setBusca,
}: {
  id: string
  nome: string
  desc: string
  busca?: string
  setBusca?: (s: string) => void
}) {
  const v = useVariantes()
  const larga = useTelaLarga()
  return (
    <motion.header
      initial={v.reduzir ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.6 }}
      className="relative overflow-hidden rounded-[26px] bg-[linear-gradient(120deg,color-mix(in_srgb,var(--brand)_16%,var(--surface)),var(--surface)_62%)] shadow-[var(--shadow-sm)]"
    >
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[34%] [mask-image:linear-gradient(to_right,transparent,black_35%)] md:block">
        {larga && <CenaCentral modulo={id} key={id} />}
      </div>
      <div className="relative flex min-h-[112px] flex-col gap-4 p-5 md:w-[70%] md:flex-row md:items-center md:justify-between md:gap-8 md:px-8">
        <div className="min-w-0">
          <h1 className="text-[30px] font-bold leading-[1.05] tracking-[-0.03em] text-text md:text-[36px]">{nome}</h1>
          <p className="mt-1.5 text-[15px] leading-snug text-text-muted">{desc}</p>
        </div>
        {setBusca && (
          <label className="relative block w-full md:max-w-[340px]">
            <span className="sr-only">Buscar telas e ações</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 size-[17px] -translate-y-1/2 text-text-muted" aria-hidden />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Achar uma tela…"
              className="h-11 w-full rounded-full bg-surface pl-10 pr-4 text-[14px] text-text shadow-[var(--shadow-sm)] ring-1 ring-[var(--border)] outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-brand"
            />
          </label>
        )}
      </div>
    </motion.header>
  )
}

/** Central de um módulo: Novo, telas (a principal em destaque), cadastros e relatórios. */
export function CentralModulo({ id }: { id: string }) {
  const central = useCentral()
  const [busca, setBusca] = React.useState('')
  const [favs, alternar] = useFavoritos(central?.userId ?? '')
  const v = useVariantes()
  const numeros = useNumeros()

  const modulos = React.useMemo(() => (central ? modulosVisiveis(MODULOS, NAV_ITEMS, central.ctx) : []), [central])
  const base = moduloPorId(id)
  const modulo = React.useMemo(() => (central && base ? moduloVisivel(base, NAV_ITEMS, central.ctx) : null), [central, base])
  const org = React.useMemo(() => (modulo ? organizar(modulo) : null), [modulo])
  if (!central || !base || !modulo || !org) return null

  const q = norm(busca.trim())
  // A busca vale para todos os módulos e só traz o que existe.
  const resultados = q
    ? modulos.flatMap((m) =>
        [
          ...m.novos.map((i) => ({ m, secao: 'Novo', i })),
          ...m.telas.map((i) => ({ m, secao: '', i })),
          ...m.secoes.flatMap((s) => s.itens.map((i) => ({ m, secao: s.nome, i }))),
        ].filter(({ i, secao }) => !i.ref && !i.emBreve && !!i.href && norm(`${m.nome} ${secao} ${i.label} ${i.desc ?? ''}`).includes(q))
      )
    : []

  return (
    <div className="space-y-7">
      <Cabecalho id={id} nome={modulo.nome} desc={modulo.desc} busca={busca} setBusca={setBusca} />

      {q ? (
        resultados.length === 0 ? (
          <EmptyState icon={Search} title="Nada encontrado" hint="Tente outra palavra." />
        ) : (
          <motion.div key="busca" variants={v.lista} initial="oculto" animate="visivel" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {resultados.map(({ m, secao, i }, k) => (
              <CartaoConsulta
                key={`${m.id}-${secao}-${i.label}-${k}`}
                item={{
                  ...i,
                  label: secao === 'Novo' ? `Novo: ${i.label}` : secao ? `${secao} › ${rotuloBotao(i.label)}` : i.label,
                  desc: m.nome,
                }}
                secao={secao || undefined}
                favs={favs}
                alternar={alternar}
              />
            ))}
          </motion.div>
        )
      ) : (
        <motion.div key={id} variants={v.lista} initial="oculto" animate="visivel" className="space-y-8">
          <BarraFavoritos favs={favs} modulos={modulos} alternar={alternar} />

          {org.novos.length > 0 && (
            <section aria-label="Criar">
              <Titulo>Novo</Titulo>
              <div className="flex flex-wrap gap-2.5">
                {org.novos.map((i, k) => (
                  <BotaoNovo key={`${i.label}-${k}`} item={i} />
                ))}
              </div>
            </section>
          )}

          {(org.principal || org.telas.length > 0) && (
            <section>
              <Titulo n={org.telas.length + (org.principal ? 1 : 0)}>Telas</Titulo>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {org.principal && <CartaoTela item={org.principal} principal numero={numeros[org.principal.href ?? '']} favs={favs} alternar={alternar} />}
                {org.telas.map((i, k) => (
                  <CartaoTela key={`${i.label}-${k}`} item={i} principal={false} numero={numeros[i.href ?? '']} favs={favs} alternar={alternar} />
                ))}
              </div>
            </section>
          )}

          {org.cadastros.length > 0 && (
            <section>
              <Titulo n={org.cadastros.length}>Cadastros</Titulo>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {org.cadastros.map((s) => (
                  <CartaoCadastro key={s.nome} secao={s} />
                ))}
              </div>
            </section>
          )}

          {org.relatorios.length > 0 && (
            <section>
              <Titulo n={org.relatorios.length}>Relatórios</Titulo>
              <div className="flex flex-wrap gap-2.5">
                {org.relatorios.map((i, k) => (
                  <ChipRelatorio key={`${i.label}-${k}`} item={i} />
                ))}
              </div>
            </section>
          )}

          <motion.div variants={v.entra}>
            <Gaveta itens={org.embreve} />
          </motion.div>
          <p className="text-[12px] text-text-muted">Itens com a etiqueta &quot;só dev&quot; ainda não foram lançados para os demais usuários.</p>
        </motion.div>
      )}
    </div>
  )
}

/** Visão geral: favoritos + um cartão por módulo com os números do dia e todas as telas dele. */
export function CentralGeral() {
  const central = useCentral()
  const [favs, alternar] = useFavoritos(central?.userId ?? '')
  const v = useVariantes()
  const numeros = useNumeros()
  const modulos = React.useMemo(() => (central ? modulosVisiveis(MODULOS, NAV_ITEMS, central.ctx) : []), [central])
  if (!central) return null

  const cartoes = modulos
    .map((m) => {
      const o = organizar(m)
      return { m, telas: [...(o.principal ? [o.principal] : []), ...o.telas].filter((i) => !!i.href) }
    })
    // Módulo sem nenhuma tela nesta loja (ex.: Finanças nas lojas do Omie) não ocupa espaço.
    .filter(({ telas }) => telas.length > 0)

  return (
    <div className="space-y-7">
      <Cabecalho id="inicio" nome="Visão geral" desc="O que precisa de você hoje, por módulo." />
      <BarraFavoritos favs={favs} modulos={modulos} alternar={alternar} />
      {/* Colunas (não grade): cada cartão tem a altura do que tem dentro, sem branco sobrando. */}
      <motion.div variants={v.lista} initial="oculto" animate="visivel" className="gap-4 sm:columns-2 xl:columns-3">
        {cartoes.map(({ m, telas }) => {
          const Icon = m.icone
          const destaques = destaquesDoModulo(
            telas.map((i) => i.href!),
            numeros
          )
          return (
            <motion.section
              key={m.id}
              variants={v.entra}
              className="mb-4 flex break-inside-avoid flex-col gap-4 rounded-[22px] bg-surface p-5 shadow-[var(--shadow-sm)] transition-shadow duration-200 hover:shadow-[var(--shadow-md)]"
            >
              <Link href={m.href} className="group flex items-center gap-3.5">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-brand-soft text-brand">
                  <Icon className="size-[21px]" strokeWidth={1.9} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-semibold text-text group-hover:text-brand">{m.nome}</span>
                  <span className="block truncate text-[13px] text-text-muted">{m.desc}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-text-muted/50 u-motion group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden />
              </Link>
              {destaques.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {destaques.map((d) => (
                    <Link key={d.href} href={d.href} className={`min-w-0 rounded-[14px] ${destaques.length === 1 ? 'col-span-2' : ''} bg-surface-2 px-3 py-2.5 u-motion hover:bg-brand-soft`}>
                      <span className={`num block text-[20px] font-semibold leading-tight tracking-[-0.02em] ${d.alerta ? 'text-[var(--tone-warn)]' : 'text-text'}`}>
                        {formatarValor(d.valor)}
                      </span>
                      <span className="line-clamp-2 block text-[12.5px] leading-snug text-text-muted">{d.rotulo}</span>
                    </Link>
                  ))}
                </div>
              )}
              <ul className="-mx-1.5 grid">
                {telas.map((i, k) => {
                  const { Icon: Ic } = iconeDoItem(i.label, undefined, i.href)
                  const n = numeros[i.href!]
                  return (
                    <li key={`${i.label}-${k}`}>
                      <Link href={i.href!} className="group flex items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 text-[14px] text-text u-motion hover:bg-surface-2 hover:text-brand">
                        <Ic className="size-4 shrink-0 text-brand" strokeWidth={2} aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{i.label}</span>
                        {n?.alerta && n.valor > 0 && (
                          <span className="num rounded-full bg-[color-mix(in_srgb,var(--tone-warn)_16%,transparent)] px-2 text-[12px] font-semibold text-[var(--tone-warn)]">
                            {formatarValor(n.valor)}
                          </span>
                        )}
                        <Etiquetas item={i} />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </motion.section>
          )
        })}
      </motion.div>
    </div>
  )
}
