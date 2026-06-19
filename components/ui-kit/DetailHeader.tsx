'use client'

/**
 * DetailHeader — cabecalho interno para telas de detalhe/passo.
 *
 * Props:
 *   href        — destino do botao Voltar (obrigatorio; use "/" para raiz de secao)
 *   title       — titulo principal da tela
 *   breadcrumb? — trilha declarativa: [{ label, href? }, ...] (ex.: [{ label: "Notas Fiscais", href: "/nota-fiscal" }])
 *                 O ultimo item e o titulo da tela atual (sem href); os anteriores viram links.
 *   meta?       — linha de metadados abaixo do titulo (ex.: data + StatusPill + responsavel)
 *   actions?    — botoes/links no canto direito (ex.: Imprimir PDF)
 *
 * Comportamento de sticky:
 *   - Mobile (< lg): sticky top-14 z-20, cola abaixo do MobileNav (h-14 / top-0 z-30).
 *   - Desktop (>= lg): nao e sticky (o layout nao rola o main como um todo — cada secao
 *     tem scroll proprio, e o sidebar fica fixo); exibe o header normalmente inline.
 *
 * Visual: Linear/Vercel — fundo bg-surface, borda inferior, backdrop-blur discreto.
 */

import Link from 'next/link'
import { ArrowLeft, ChevronRight } from 'lucide-react'

export interface BreadcrumbItem {
  label: string
  href?: string
}

export interface DetailHeaderProps {
  /** Destino do botao Voltar */
  href: string
  /** Titulo principal */
  title: string
  /** Trilha de breadcrumb declarativa (opcional) */
  breadcrumb?: BreadcrumbItem[]
  /** Linha de metadados abaixo do titulo (nodes prontos: date, StatusPill, etc.) */
  meta?: React.ReactNode
  /** Acoes no canto direito (botoes, links de impressao, etc.) */
  actions?: React.ReactNode
}

export function DetailHeader({ href, title, breadcrumb, meta, actions }: DetailHeaderProps) {
  return (
    <div
      className="
        sticky top-14 z-20
        lg:static lg:top-auto lg:z-auto
        -mx-4 mb-5 px-4
        lg:mx-0 lg:px-0
        border-b border-border
        bg-surface/95 backdrop-blur
        lg:border-none lg:bg-transparent lg:backdrop-blur-none
        pt-3 pb-3
        lg:pt-0 lg:pb-0 lg:mb-5
      "
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {/* Breadcrumb (se fornecido) */}
          {breadcrumb && breadcrumb.length > 0 && (
            <nav
              aria-label="Caminho"
              className="mb-1.5 flex flex-wrap items-center gap-0.5 text-[12px] text-text-muted"
            >
              {breadcrumb.map((item, i) => (
                <span key={i} className="flex items-center gap-0.5">
                  {i > 0 && (
                    <ChevronRight className="size-3 shrink-0 text-text-muted/40" aria-hidden />
                  )}
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="transition-colors hover:text-text"
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <span className="text-text-muted/70">{item.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )}

          {/* Linha de voltar */}
          <Link
            href={href}
            className="
              mb-1.5 inline-flex items-center gap-1
              text-[13px] text-text-muted
              transition-colors hover:text-text
              min-h-[40px] -ml-1 pl-1 pr-2
              rounded-md
              u-motion
              active:bg-surface-2
            "
            aria-label="Voltar"
          >
            <ArrowLeft className="size-3.5 shrink-0" aria-hidden />
            <span>Voltar</span>
          </Link>

          {/* Titulo */}
          <h1 className="truncate text-lg font-semibold tracking-tight text-text leading-tight">
            {title}
          </h1>

          {/* Metadados opcionais */}
          {meta && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              {meta}
            </div>
          )}
        </div>

        {/* Acoes */}
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}
