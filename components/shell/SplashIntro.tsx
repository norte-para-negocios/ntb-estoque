'use client'

import * as React from 'react'

/**
 * SplashIntro — animação de abertura do NTB Estoque.
 *
 * Um foguete cruza a tela em diagonal e, ao passar pelo centro, uma linha de
 * corte teal varre a tela revelando a logo NTB (efeito wipe via clip-path).
 * A logo assenta, "STOCK" aparece, e o overlay some sozinho.
 *
 * Decisões de produto / técnicas:
 *  - Aparece UMA VEZ por abertura da aba (sessionStorage), não a cada navegação
 *    interna do SPA. Recarregar a aba (F5) mostra de novo.
 *  - Fundo escuro elegante próprio (independe do tema claro/escuro do app).
 *  - 100% CSS + SVG. Anima só transform/opacity/clip-path (hardware-accelerated).
 *  - Botão "Pular" sempre acessível; clique em qualquer lugar / Esc / Enter pula.
 *  - prefers-reduced-motion: versão estática curta (sem foguete cruzando).
 *  - pointer-events liberados após o fim para nunca travar o uso.
 */

const STORAGE_KEY = 'ntb_splash_visto'
const DURACAO_MS = 2400
const DURACAO_REDUZIDA_MS = 900

export function SplashIntro() {
  // Começa null para evitar mismatch de hidratação; decidimos no cliente.
  const [visivel, setVisivel] = React.useState<boolean | null>(null)
  const [saindo, setSaindo] = React.useState(false)
  const [reduzido, setReduzido] = React.useState(false)
  const timers = React.useRef<number[]>([])

  const encerrar = React.useCallback(() => {
    setSaindo((jaSaindo) => {
      if (jaSaindo) return jaSaindo
      // Fade-out e desmonta.
      const t = window.setTimeout(() => setVisivel(false), 460)
      timers.current.push(t)
      return true
    })
  }, [])

  React.useEffect(() => {
    let mostrar = true
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === '1') mostrar = false
    } catch {
      // sessionStorage indisponível (modo restrito): mostra uma vez por mount.
    }

    if (!mostrar) {
      setVisivel(false)
      return
    }

    const prefereReduzido =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

    setReduzido(prefereReduzido)
    setVisivel(true)

    try {
      sessionStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* ignora */
    }

    // Trava o scroll do body durante a splash.
    const overflowAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const total = prefereReduzido ? DURACAO_REDUZIDA_MS : DURACAO_MS
    const t = window.setTimeout(encerrar, total)
    timers.current.push(t)

    return () => {
      document.body.style.overflow = overflowAnterior
      timers.current.forEach((id) => window.clearTimeout(id))
      timers.current = []
    }
  }, [encerrar])

  // Pular por teclado.
  React.useEffect(() => {
    if (visivel !== true) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        encerrar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visivel, encerrar])

  if (visivel !== true) return null

  return (
    <div
      className="ntb-splash"
      data-saindo={saindo ? '1' : '0'}
      data-reduzido={reduzido ? '1' : '0'}
      onClick={encerrar}
      role="dialog"
      aria-label="Abertura do NTB Estoque"
    >
      {/* Glow teal de fundo, respira sutilmente */}
      <div className="ntb-splash__glow" aria-hidden />

      {/* Linha de corte que varre a tela revelando a logo */}
      <div className="ntb-splash__corte" aria-hidden />

      {/* Foguete cruzando em diagonal, com rastro */}
      {!reduzido && (
        <div className="ntb-splash__voo" aria-hidden>
          <span className="ntb-splash__rastro" />
          <Foguete className="ntb-splash__foguete" />
        </div>
      )}

      {/* Logo NTB revelada em duas metades */}
      <div className="ntb-splash__palco" aria-hidden>
        <LogoNTB />
        <span className="ntb-splash__stock">STOCK</span>
      </div>

      {/* Botão pular, sempre acessível */}
      <button
        type="button"
        className="ntb-splash__pular"
        onClick={(e) => {
          e.stopPropagation()
          encerrar()
        }}
      >
        Pular
      </button>
    </div>
  )
}

/* SVG do foguete, desenhado para o tema (corpo claro, janela teal, chama). */
function Foguete({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="58"
      height="58"
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* Chama */}
      <path
        className="ntb-chama"
        d="M16 38c-4 2-8 7-10 13 6-1 11-3 14-7"
        fill="#2eb5c3"
        fillOpacity="0.9"
      />
      <path
        d="M18 36c-2.5 1.5-5 4.5-6.5 8.5 4-1 6.8-2.4 8.6-4.8"
        fill="#7fe3ee"
      />
      {/* Corpo */}
      <path
        d="M30 46 18 34C26 16 42 8 56 8c0 14-8 30-26 38Z"
        fill="#eef3f7"
      />
      <path
        d="M30 46 24 40C31 24 44 14 56 8c0 13-8 30-26 38Z"
        fill="#cdd8e3"
      />
      {/* Janela teal */}
      <circle cx="40" cy="24" r="6" fill="#0a0d13" />
      <circle cx="40" cy="24" r="4" fill="#2eb5c3" />
      <circle cx="38.4" cy="22.4" r="1.4" fill="#bff0f6" />
      {/* Aletas */}
      <path d="M18 34 12 36c-2 2-3 6-2 10 4-1 7-3 9-6Z" fill="#2eb5c3" />
      <path d="M30 46l-2 6c2 1 6 0 9-2 -1-4-3-7-6-9Z" fill="#1c8d99" />
    </svg>
  )
}

/* Logo NTB em SVG, com o "T" central em teal (espelha a marca real). */
function LogoNTB() {
  return (
    <svg
      className="ntb-splash__logo"
      viewBox="0 0 300 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="NTB"
    >
      {/* Metade de cima (revelada por clip) */}
      <text
        x="150"
        y="74"
        textAnchor="middle"
        fontFamily="var(--font-sans), 'Plus Jakarta Sans', system-ui, sans-serif"
        fontSize="90"
        fontWeight="700"
        letterSpacing="-4"
      >
        <tspan fill="#f4f7fa">N</tspan>
        <tspan fill="#2eb5c3">T</tspan>
        <tspan fill="#f4f7fa">B</tspan>
      </text>
    </svg>
  )
}
