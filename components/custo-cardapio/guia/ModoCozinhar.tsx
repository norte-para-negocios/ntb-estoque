'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Check, Minus, Plus, RotateCcw, Sun, X } from 'lucide-react'
import type { NoGuia, ReceitaGuia } from '@/lib/custo-cardapio/guia'
import { qtd } from '@/lib/custo-cardapio/formato'

// Modo cozinhar: tela cheia para tablet/celular na bancada. Letra grande, checklist de ingredientes e de passos
// (só no aparelho, some ao sair), passo a passo com anterior/próximo, tela sempre ligada (Wake Lock, quando o
// navegador tem) e Esc para sair. Setas do teclado trocam o passo.

type Linha = { chave: string; no: NoGuia; nivel: number }

function achatar(nos: NoGuia[], nivel = 0, chave = 'r', out: Linha[] = []): Linha[] {
  nos.forEach((n, i) => {
    const k = `${chave}.${i}`
    out.push({ chave: k, no: n, nivel })
    if (n.filhos.length) achatar(n.filhos, nivel + 1, k, out)
  })
  return out
}

const TAMANHOS = [0.9, 1, 1.15, 1.3, 1.5] as const

type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener?: (t: string, f: () => void) => void }

export function ModoCozinhar({ nome, rotulo, fotoUrl, ingredientes, passos, observacoes, subs, onSair }: {
  nome: string; rotulo: string; fotoUrl: string | null; ingredientes: NoGuia[]; passos: string[]; observacoes: string | null
  subs: ReceitaGuia['subs']; onSair: () => void
}) {
  const linhas = useMemo(() => achatar(ingredientes), [ingredientes])
  const [aba, setAba] = useState<'ingredientes' | 'preparo'>('ingredientes')
  const [marcados, setMarcados] = useState<Record<string, boolean>>({})
  const [feitos, setFeitos] = useState<Record<number, boolean>>({})
  const [atual, setAtual] = useState(0)
  const [tam, setTam] = useState(2)
  const [telaLigada, setTelaLigada] = useState<'sim' | 'nao'>('nao')
  // Só monta depois de um toque (nunca no servidor), então dá para olhar o navigator direto.
  const semWakeLock = typeof navigator !== 'undefined' && !('wakeLock' in navigator)
  const fechar = useRef<HTMLButtonElement>(null)
  const montado = typeof document !== 'undefined'

  const nMarcados = linhas.filter((l) => marcados[l.chave]).length
  const nFeitos = passos.filter((_, i) => feitos[i]).length
  const escala = TAMANHOS[tam]

  // Tela ligada (Wake Lock). O navegador solta a trava quando a aba some; pede de novo quando volta.
  useEffect(() => {
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock
    if (!wl) return
    let trava: WakeLockSentinelLike | null = null
    let vivo = true
    const pedir = async () => {
      try {
        trava = await wl.request('screen')
        if (!vivo) { void trava.release(); return }
        setTelaLigada('sim')
        trava.addEventListener?.('release', () => { if (vivo) setTelaLigada('nao') })
      } catch {
        if (vivo) setTelaLigada('nao')
      }
    }
    void pedir()
    const aoVoltar = () => { if (document.visibilityState === 'visible') void pedir() }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      vivo = false
      document.removeEventListener('visibilitychange', aoVoltar)
      if (trava) void trava.release().catch(() => {})
    }
  }, [])

  // Sem rolar a página de trás; foco no botão de sair.
  useEffect(() => {
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    fechar.current?.focus()
    return () => { document.body.style.overflow = antes }
  }, [])

  const irPara = useCallback((i: number) => setAtual(Math.min(Math.max(i, 0), Math.max(passos.length - 1, 0))), [passos.length])

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onSair(); return }
      if (aba !== 'preparo' || (e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'ArrowRight') irPara(atual + 1)
      if (e.key === 'ArrowLeft') irPara(atual - 1)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [aba, atual, irPara, onSair])

  const marcarFeito = () => {
    const ja = !!feitos[atual]
    setFeitos((f) => ({ ...f, [atual]: !ja }))
    if (!ja && atual < passos.length - 1) irPara(atual + 1)
  }

  const tab = (on: boolean) => `relative h-11 flex-1 rounded-[10px] px-4 text-[16px] font-semibold u-motion ${on ? 'bg-surface text-text shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-text-muted'}`
  const btnRedondo = 'flex size-11 items-center justify-center rounded-full bg-surface-2 text-text u-motion u-press hover:bg-[var(--border)] disabled:opacity-40'

  const conteudo = (
    <div role="dialog" aria-modal="true" aria-label={`Modo cozinhar: ${nome}`} className="fixed inset-0 z-[100] flex flex-col bg-bg text-text" style={{ fontSize: `${escala}rem` }}>
      {/* Topo */}
      <div className="flex items-center gap-3 border-b border-border bg-surface px-3 py-2 sm:px-5" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        {fotoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada do bucket privado
          <img src={fotoUrl} alt="" className="hidden size-11 shrink-0 rounded-[10px] object-cover sm:block" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[1.15em] font-semibold leading-tight">{nome}</p>
          <p className="truncate text-[0.85em] text-text-muted">
            {rotulo}
            {telaLigada === 'sim' && <span className="ml-2 inline-flex items-center gap-1"><Sun className="inline size-3.5" /> tela ligada</span>}
          </p>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Tamanho da letra">
          <button type="button" onClick={() => setTam((t) => Math.max(t - 1, 0))} disabled={tam === 0} aria-label="Letra menor" className={btnRedondo}><Minus className="size-4" /></button>
          <span className="w-7 text-center text-[14px] font-semibold" aria-hidden>Aa</span>
          <button type="button" onClick={() => setTam((t) => Math.min(t + 1, TAMANHOS.length - 1))} disabled={tam === TAMANHOS.length - 1} aria-label="Letra maior" className={btnRedondo}><Plus className="size-4" /></button>
        </div>
        <button ref={fechar} type="button" onClick={onSair} aria-label="Sair do modo cozinhar (Esc)" className={`${btnRedondo} ml-1`}><X className="size-5" /></button>
      </div>

      {/* Abas */}
      <div className="px-3 pt-3 sm:px-5">
        <div role="tablist" className="mx-auto flex max-w-3xl gap-1 rounded-[12px] bg-surface-2 p-1">
          <button type="button" role="tab" aria-selected={aba === 'ingredientes'} onClick={() => setAba('ingredientes')} className={tab(aba === 'ingredientes')}>
            Ingredientes <span className="num text-[0.85em] font-medium text-text-muted">{nMarcados} de {linhas.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={aba === 'preparo'} onClick={() => setAba('preparo')} className={tab(aba === 'preparo')}>
            Preparo <span className="num text-[0.85em] font-medium text-text-muted">{passos.length ? `${nFeitos} de ${passos.length}` : ''}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-5">
        <div className="mx-auto max-w-3xl">
          {aba === 'ingredientes' ? (
            <>
              <ul className="space-y-2">
                {linhas.map(({ chave, no, nivel }) => {
                  const on = !!marcados[chave]
                  return (
                    <li key={chave} style={{ marginLeft: `${nivel * 1.5}em` }}>
                      <button type="button" role="checkbox" aria-checked={on} onClick={() => setMarcados((m) => ({ ...m, [chave]: !on }))}
                        className={`flex w-full items-center gap-3 rounded-[14px] px-4 py-3 text-left u-motion u-press-sm ${on ? 'bg-ok/10' : 'bg-surface'} ${no.filhos.length ? 'ring-1 ring-border' : ''}`}>
                        <span className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 u-motion ${on ? 'border-ok bg-ok text-white' : 'border-border'}`}>{on && <Check className="size-4" strokeWidth={3} />}</span>
                        <span className={`min-w-0 flex-1 text-[1.1em] leading-snug ${on ? 'text-text-muted line-through' : ''}`}>
                          {no.descricao}
                          {no.filhos.length > 0 && <span className="block text-[0.75em] font-medium text-text-muted no-underline">preparação: ingredientes abaixo{subs[no.codigo]?.passos.length ? ', passos no fim da lista' : ''}</span>}
                        </span>
                        <span className={`num shrink-0 text-[1.15em] font-semibold ${on ? 'text-text-muted' : ''}`}>{qtd(no.quantidade, no.unidade)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              {/* Passos das preparações usadas aqui */}
              {linhas.filter((l) => l.no.temFicha && subs[l.no.codigo]?.passos.length).map(({ chave, no }) => (
                <div key={`s${chave}`} className="mt-6 rounded-[14px] bg-surface p-4">
                  <p className="mb-2 text-[1em] font-semibold">Como fazer: {no.descricao}</p>
                  <ol className="list-decimal space-y-1.5 pl-6 text-[1em] leading-relaxed">
                    {subs[no.codigo].passos.map((p, i) => <li key={i}>{p}</li>)}
                  </ol>
                </div>
              ))}
              <div className="mt-6 flex flex-wrap justify-between gap-2">
                {nMarcados > 0 ? <button type="button" onClick={() => setMarcados({})} className="inline-flex items-center gap-1.5 text-[0.9em] font-semibold text-text-muted hover:text-text"><RotateCcw className="size-4" /> Desmarcar tudo</button> : <span />}
                <button type="button" onClick={() => setAba('preparo')} className="inline-flex h-12 items-center gap-2 rounded-full bg-brand-fill px-6 text-[1em] font-semibold text-white u-motion u-press">Ir para o preparo <ArrowRight className="size-5" /></button>
              </div>
            </>
          ) : passos.length === 0 ? (
            <div className="rounded-[14px] bg-surface p-6 text-center">
              <p className="text-[1.15em] font-semibold">Sem modo de preparo escrito</p>
              <p className="mt-1 text-text-muted">Escreva os passos na página do prato e eles aparecem aqui.</p>
              {observacoes && <p className="mt-4 whitespace-pre-line text-left">{observacoes}</p>}
            </div>
          ) : (
            <div className="space-y-5">
              <p className="text-center text-[0.95em] font-semibold text-text-muted" aria-live="polite">
                {nFeitos === passos.length ? 'Todos os passos feitos' : `Passo ${atual + 1} de ${passos.length}`}
              </p>
              <div className={`rounded-[20px] p-6 sm:p-8 u-motion ${feitos[atual] ? 'bg-ok/10' : 'bg-surface shadow-[var(--shadow-sm)]'}`}>
                <div className="mb-4 flex items-center gap-3">
                  <span className="num flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-fill text-[1.4em] font-semibold text-white">{atual + 1}</span>
                  {feitos[atual] && <span className="inline-flex items-center gap-1 rounded-full bg-ok px-3 py-1 text-[0.85em] font-semibold text-white"><Check className="size-4" strokeWidth={3} /> Feito</span>}
                </div>
                <p className="text-[1.6em] font-medium leading-snug">{passos[atual]}</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => irPara(atual - 1)} disabled={atual === 0} aria-label="Passo anterior" className="flex h-14 w-16 shrink-0 items-center justify-center rounded-full bg-surface-2 u-motion u-press disabled:opacity-40"><ArrowLeft className="size-6" /></button>
                <button type="button" onClick={marcarFeito} className={`flex h-14 flex-1 items-center justify-center gap-2 rounded-full text-[1.05em] font-semibold u-motion u-press ${feitos[atual] ? 'bg-surface-2 text-text' : 'bg-ok text-white'}`}>
                  {feitos[atual] ? 'Desfazer' : <><Check className="size-5" strokeWidth={3} /> Feito{atual < passos.length - 1 ? ', próximo' : ''}</>}
                </button>
                <button type="button" onClick={() => irPara(atual + 1)} disabled={atual >= passos.length - 1} aria-label="Próximo passo" className="flex h-14 w-16 shrink-0 items-center justify-center rounded-full bg-surface-2 u-motion u-press disabled:opacity-40"><ArrowRight className="size-6" /></button>
              </div>
              <ol className="space-y-1.5 pt-2">
                {passos.map((p, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => irPara(i)} aria-current={i === atual ? 'step' : undefined}
                      className={`flex w-full items-start gap-3 rounded-[12px] px-3 py-2 text-left text-[0.95em] u-motion ${i === atual ? 'bg-brand/10' : 'hover:bg-surface-2'}`}>
                      <span className={`num mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[0.75em] font-semibold ${feitos[i] ? 'bg-ok text-white' : 'bg-surface-2 text-text-muted'}`}>{feitos[i] ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}</span>
                      <span className={`min-w-0 ${feitos[i] ? 'text-text-muted line-through' : ''}`}>{p}</span>
                    </button>
                  </li>
                ))}
              </ol>
              {observacoes && (
                <div className="rounded-[14px] bg-surface-2 p-4">
                  <p className="mb-1 text-[0.8em] font-semibold uppercase tracking-wide text-text-muted">Observações</p>
                  <p className="whitespace-pre-line leading-relaxed">{observacoes}</p>
                </div>
              )}
              {nFeitos > 0 && <button type="button" onClick={() => { setFeitos({}); setAtual(0) }} className="inline-flex items-center gap-1.5 text-[0.9em] font-semibold text-text-muted hover:text-text"><RotateCcw className="size-4" /> Recomeçar os passos</button>}
            </div>
          )}
          {semWakeLock && <p className="mt-6 text-center text-[0.8em] text-text-muted">Este navegador não deixa manter a tela ligada. Ajuste o bloqueio de tela do aparelho se ela apagar.</p>}
        </div>
      </div>
    </div>
  )

  return montado ? createPortal(conteudo, document.body) : null
}
