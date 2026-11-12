'use client'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { AcaoPacioli } from '@/lib/custo-cardapio/pacioli-puro'

// O mascote é o motor oficial (public/pacioli: pacioli.js + acoes/*.js + ver.html, cópia de pacioli-mascote/web/v7),
// num iframe da mesma origem. Por que iframe e não <Script> no canvas: o motor cria globais (window.Pacioli,
// window.PacioliMotor), carrega as ações injetando <script> e lendo document.currentScript, roda um requestAnimationFrame
// próprio que não para e troca document.title — tudo isso fica preso no documento do iframe, sem colidir com o React
// (montagem dupla do StrictMode, navegação do App Router) nem com a página. A troca de ação vai por postMessage
// ({ acao } / { olhar }), que o ver.html já aceita, sem recarregar.
// Menos movimento (prefers-reduced-motion): o mascote fica parado numa pose (&freeze) e não troca de ação.

const hexDe = (cor: string): string | null => {
  const m = cor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/)
  if (!m || (m[4] != null && Number(m[4]) < 1)) return null
  return [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')
}

export function PacioliMascote({ acao, alvoRef, olharAlvo, className = '' }: {
  acao: AcaoPacioli
  /** Elemento para onde os olhos vão enquanto a pessoa digita (o campo da pergunta). */
  alvoRef?: RefObject<HTMLElement | null>
  olharAlvo?: boolean
  className?: string
}) {
  const caixaRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const pronto = useRef(false)
  const parado = useRef(false)
  const acaoRef = useRef(acao)
  const olharAlvoRef = useRef(false)
  /** Ação que já foi no endereço (não reenvia ao carregar, senão a animação recomeça). */
  const acaoNoSrc = useRef<string | null>(null)

  const enviar = useCallback((msg: Record<string, unknown>) => {
    if (!pronto.current) return
    frameRef.current?.contentWindow?.postMessage(msg, window.location.origin)
  }, [])

  // Monta o endereço com o tema e o fundo da página; refaz se o tema ou a preferência de movimento mudar.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const montar = () => {
      const escuro = document.documentElement.classList.contains('dark')
      parado.current = mq.matches
      const fundo = caixaRef.current ? hexDe(getComputedStyle(caixaRef.current).backgroundColor) : null
      acaoNoSrc.current = mq.matches ? '01-vigiando' : acaoRef.current
      const q = new URLSearchParams({ a: acaoNoSrc.current, tema: escuro ? 'escuro' : 'claro', veste: 'chef' })
      if (fundo) q.set('bg', fundo)
      q.set('semico', '')
      if (mq.matches) { q.set('freeze', ''); q.set('t', '2') }
      pronto.current = false
      setSrc(`/pacioli/ver.html?${q.toString()}`)
    }
    montar()
    let antes = document.documentElement.className
    const obs = new MutationObserver(() => {
      const agora = document.documentElement.className
      if (agora.includes('dark') !== antes.includes('dark')) montar()
      antes = agora
    })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    mq.addEventListener('change', montar)
    return () => { obs.disconnect(); mq.removeEventListener('change', montar) }
  }, [])

  useEffect(() => {
    acaoRef.current = acao
    if (!parado.current) enviar({ acao })
  }, [acao, enviar])

  // Os olhos seguem o ponteiro em qualquer lugar da página (dentro do iframe o próprio ver.html cuida).
  useEffect(() => {
    let quadro = 0
    let ultimo: [number, number] | null = null
    const olharPara = (x: number, y: number) => {
      const f = frameRef.current
      if (!f || parado.current) return
      const r = f.getBoundingClientRect()
      const lado = 0.92 * Math.min(r.width, r.height) / (92 / 64)
      if (!(lado > 0)) return
      enviar({ olhar: [0.5 + (x - (r.left + r.width / 2)) / lado, 0.5 + (y - (r.top + r.height / 2)) / lado] })
    }
    const mover = (e: PointerEvent) => {
      if (olharAlvoRef.current) return
      ultimo = [e.clientX, e.clientY]
      if (!quadro) quadro = requestAnimationFrame(() => { quadro = 0; if (ultimo) olharPara(ultimo[0], ultimo[1]) })
    }
    const soltar = () => { if (!olharAlvoRef.current) enviar({ olhar: null }) }
    window.addEventListener('pointermove', mover, { passive: true })
    document.documentElement.addEventListener('pointerleave', soltar)
    window.addEventListener('blur', soltar)
    return () => {
      cancelAnimationFrame(quadro)
      window.removeEventListener('pointermove', mover)
      document.documentElement.removeEventListener('pointerleave', soltar)
      window.removeEventListener('blur', soltar)
    }
  }, [enviar])

  // Enquanto digita: olha para o campo da pergunta.
  useEffect(() => {
    olharAlvoRef.current = !!olharAlvo
    const alvo = alvoRef?.current
    if (olharAlvo && alvo && frameRef.current && !parado.current) {
      const r = alvo.getBoundingClientRect()
      const f = frameRef.current.getBoundingClientRect()
      const lado = 0.92 * Math.min(f.width, f.height) / (92 / 64)
      if (lado > 0) enviar({ olhar: [0.5 + (r.left + Math.min(r.width, 240) / 2 - (f.left + f.width / 2)) / lado, 0.5 + (r.top + r.height / 2 - (f.top + f.height / 2)) / lado] })
    } else if (!olharAlvo) enviar({ olhar: null })
  }, [olharAlvo, alvoRef, enviar])

  return (
    <div ref={caixaRef} className={`relative overflow-hidden bg-surface-2 dark:bg-surface ${className}`}>
      {src && (
        <iframe
          ref={frameRef}
          key={src}
          src={src}
          title="Pacioli, o assistente da cozinha"
          aria-hidden="true"
          tabIndex={-1}
          sandbox="allow-scripts allow-same-origin"
          className="absolute inset-0 size-full border-0"
          onLoad={() => {
            pronto.current = true
            if (!parado.current && acaoRef.current !== acaoNoSrc.current) enviar({ acao: acaoRef.current })
          }}
        />
      )}
    </div>
  )
}
