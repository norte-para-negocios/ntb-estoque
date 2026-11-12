'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Clock, FileText, Minus, Pencil, Play, Plus, Scale, Users } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import type { NoGuia, ReceitaGuia } from '@/lib/custo-cardapio/guia'
import { escalarNos, hrefGuia, lerEscala } from '@/lib/custo-cardapio/guia-puro'
import { qtd } from '@/lib/custo-cardapio/formato'
import { ModoCozinhar } from './ModoCozinhar'

// Receita do guia: a ficha que a cozinha lê (foto, quantidade, ingredientes, passos, observações). Sem R$.

const fmtEscala = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

function Passos({ passos, grande = false }: { passos: string[]; grande?: boolean }) {
  return (
    <ol className={grande ? 'space-y-3' : 'space-y-2'}>
      {passos.map((p, i) => (
        <li key={i} className={`flex gap-3 ${grande ? 'text-[16px]' : 'text-[14px]'} leading-relaxed`}>
          <span className={`num flex shrink-0 items-center justify-center rounded-full bg-brand-fill font-semibold text-white ${grande ? 'mt-0.5 size-7 text-[13px]' : 'mt-0.5 size-5 text-[11px]'}`}>{i + 1}</span>
          <span className="min-w-0">{p}</span>
        </li>
      ))}
    </ol>
  )
}

export function CartaoReceita({ receita: r, ctx, passados, contexto }: { receita: ReceitaGuia; ctx: string | null; passados: boolean; contexto: string | null }) {
  const [escalaTxt, setEscalaTxt] = useState('1')
  const [aberto, setAberto] = useState<Record<string, boolean>>({})
  const [cozinhando, setCozinhando] = useState(false)
  const escala = lerEscala(escalaTxt)
  const filhos = useMemo(() => escalarNos(r.filhos, escala), [r.filhos, escala])
  const total = r.quantidade * escala
  const rotulo = escala === 1 ? r.rotuloQtd
    : r.tipo === 'prato' ? `${fmtEscala(total)} ${total === 1 ? 'porção' : 'porções'}` : qtd(total, r.unidade)
  const passo = (d: number) => setEscalaTxt(fmtEscala(Math.max(0.5, Math.round((escala + d) * 2) / 2)))

  const Arvore = ({ nos, chave, nivel }: { nos: NoGuia[]; chave: string; nivel: number }) => (
    <ul className={nivel ? 'mt-1.5 space-y-1.5 border-l-2 border-border pl-3' : 'divide-y divide-border'}>
      {nos.map((n, i) => {
        const k = `${chave}.${i}`
        const sub = n.temFicha ? r.subs[n.codigo] : undefined
        return (
          <li key={k} className={nivel ? '' : 'py-2.5'}>
            <div className="flex items-start justify-between gap-3">
              {n.filhos.length > 0 ? (
                <button type="button" onClick={() => setAberto((a) => ({ ...a, [k]: !a[k] }))} aria-expanded={!!aberto[k]}
                  className="flex min-w-0 items-start gap-1 text-left">
                  <ChevronRight className={`mt-0.5 size-4 shrink-0 text-text-muted u-motion ${aberto[k] ? 'rotate-90' : ''}`} />
                  <span className={`${nivel ? 'text-[14px]' : 'text-[15px]'} font-medium`}>{n.descricao} <span className="text-[12px] font-normal text-text-muted">· preparação</span></span>
                </button>
              ) : (
                <span className={`min-w-0 ${nivel ? 'text-[14px] text-text-muted' : 'text-[15px]'}`}>{n.descricao}</span>
              )}
              <span className={`num shrink-0 font-semibold ${nivel ? 'text-[14px] text-text-muted' : 'text-[15px]'}`}>{qtd(n.quantidade, n.unidade)}</span>
            </div>
            {aberto[k] && n.filhos.length > 0 && (
              <div className="ml-5">
                <Arvore nos={n.filhos} chave={k} nivel={nivel + 1} />
                {sub && sub.passos.length > 0 && <div className="mt-2.5"><p className="mb-1.5 text-[12px] font-semibold text-text-muted">Como fazer</p><Passos passos={sub.passos} /></div>}
                {sub?.observacoes && <p className="mt-2 whitespace-pre-line text-[13px] text-text-muted">{sub.observacoes}</p>}
                <Link href={`${hrefGuia({ ctx, p: n.codigo, b: n.quantidade, passados })}#receita`} scroll={false} className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline">
                  Abrir a ficha de {n.descricao.toLowerCase()} nesta quantidade <ChevronRight className="size-3.5" />
                </Link>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )

  return (
    <article id="receita" className="scroll-mt-4 overflow-hidden rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
      {r.fotoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- URL assinada do bucket privado
        <img src={r.fotoUrl} alt={`Foto de ${r.descricao}`} className="aspect-[16/7] w-full object-cover" />
      )}
      <div className="space-y-6 p-4 sm:p-6">
        <header className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-text-muted">{r.tipo === 'preparacao' ? 'Preparação' : 'Prato'}{contexto && r.base === 'contexto' ? ` · ${contexto}` : ''}</p>
              <h2 className="text-[24px] font-semibold leading-tight sm:text-[28px]">{r.descricao}</h2>
            </div>
            <button type="button" onClick={() => setCozinhando(true)} className={`${btnClass('primary')} h-11 px-5 text-[15px]`}><Play className="size-4" /> Modo cozinhar</button>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-[14px] font-semibold text-brand"><Users className="size-4" /> {rotulo}</span>
            {r.tempo && <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-[14px] font-medium"><Clock className="size-4" /> {r.tempo}</span>}
            {r.rendimento && <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-[14px] font-medium"><Scale className="size-4" /> Rende {r.rendimento}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
            <span>Multiplicar:</span>
            <div className="inline-flex items-center rounded-full bg-surface-2 p-0.5">
              <button type="button" onClick={() => passo(-0.5)} aria-label="Diminuir" className="flex size-8 items-center justify-center rounded-full hover:bg-[var(--border)]"><Minus className="size-4" /></button>
              <label className="flex items-center">
                <span className="sr-only">Multiplicar quantidades por</span>
                <span aria-hidden>×</span>
                <input inputMode="decimal" value={escalaTxt} onChange={(e) => setEscalaTxt(e.target.value.replace(/[^\d,.]/g, '').slice(0, 6))}
                  className="num w-12 bg-transparent text-center text-[15px] font-semibold text-text outline-none" />
              </label>
              <button type="button" onClick={() => passo(0.5)} aria-label="Aumentar" className="flex size-8 items-center justify-center rounded-full hover:bg-[var(--border)]"><Plus className="size-4" /></button>
            </div>
            {escala !== 1 && <button type="button" onClick={() => setEscalaTxt('1')} className="font-semibold text-brand hover:underline">voltar para ×1</button>}
            {r.base === 'manual' && <Link href={`${hrefGuia({ ctx, p: r.codigo, passados })}#receita`} scroll={false} className="font-semibold text-brand hover:underline">voltar para a quantidade {ctx ? 'do contexto' : 'base'}</Link>}
          </div>
          {r.ciclo && <p className="rounded-[var(--r-md)] bg-err/10 px-3 py-2 text-[13px] text-err">A ficha tem um ciclo (uma preparação usa a si mesma). Confira as quantidades no cadastro.</p>}
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <section aria-labelledby="t-ingr">
            <h3 id="t-ingr" className="mb-1 text-[17px] font-semibold">Ingredientes</h3>
            <Arvore nos={filhos} chave="r" nivel={0} />
          </section>
          <section aria-labelledby="t-modo" className="space-y-5">
            <div>
              <h3 id="t-modo" className="mb-3 text-[17px] font-semibold">Modo de preparo</h3>
              {r.passos.length ? <Passos passos={r.passos} grande /> : (
                <p className="text-[14px] text-text-muted">Ainda não escrito. <Link href={`/cozinha/pratos/${r.codigo}`} className="font-semibold text-brand hover:underline">Escrever agora</Link></p>
              )}
            </div>
            {r.observacoes && (
              <div className="rounded-[var(--r-md)] bg-surface-2 px-4 py-3">
                <p className="mb-1 text-[12px] font-semibold text-text-muted">Observações</p>
                <p className="whitespace-pre-line text-[15px] leading-relaxed">{r.observacoes}</p>
              </div>
            )}
          </section>
        </div>

        <footer className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Link href={`/cozinha/pratos/${r.codigo}`} className={btnClass('outline')}><Pencil className="size-4" /> Editar preparo e foto</Link>
          <a href={`/cozinha/pratos/${r.codigo}/ficha?cozinha=1`} className={btnClass('outline')}><FileText className="size-4" /> Ficha da cozinha em PDF</a>
        </footer>
      </div>
      {cozinhando && <ModoCozinhar nome={r.descricao} rotulo={rotulo} fotoUrl={r.fotoUrl} ingredientes={filhos} passos={r.passos} observacoes={r.observacoes} subs={r.subs} onSair={() => setCozinhando(false)} />}
    </article>
  )
}
