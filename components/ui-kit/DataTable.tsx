import * as React from 'react'

/**
 * `minLargura`: classe de largura mínima da tabela (ex.: 'max-2xl:min-w-[1200px]').
 * Quando vem, abaixo de 2xl o bloco rola na horizontal em vez de esmagar a coluna
 * flexível (achado 2026-09-27: OPs a 1280px com o produto ficando sem largura).
 * Nesse modo o thead deixa de ser fixo só enquanto houver rolagem horizontal.
 */
export function DataTable({ children, minLargura }: { children: React.ReactNode; minLargura?: string }) {
  return (
    // A4: fade-up sutil do bloco ao montar (as linhas vem soltas, sem stagger
    // por linha, entao a tabela inteira "assenta" de uma vez, bem de leve).
    // data-sticky-table: sinaliza ao CSS global (globals.css) para aplicar
    // thead sticky com top = --lista-header-h (gravado pelo ListaHeader).
    <div className={`u-stagger rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] bg-surface ${minLargura ? 'max-2xl:overflow-x-auto 2xl:overflow-clip' : 'overflow-clip'}`}>
      <table
        data-sticky-table
        className={`w-full table-fixed text-sm ${minLargura ?? ''} [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[13px] [&_th]:font-semibold [&_th]:text-text-muted [&_thead]:border-b [&_thead]:border-border [&_thead]:bg-surface [&_thead]:shadow-[0_1px_0_var(--border)] [&_td]:px-4 [&_td]:py-2.5 [&_tbody_tr]:border-b [&_tbody_tr]:border-border/60 [&_tbody_tr:last-child]:border-0 [&_tbody_tr]:u-motion hover:[&_tbody_tr]:bg-surface-2/60`}
      >
        {children}
      </table>
    </div>
  )
}
