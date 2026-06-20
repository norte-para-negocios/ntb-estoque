import * as React from 'react'

export function DataTable({ children }: { children: React.ReactNode }) {
  return (
    // A4: fade-up sutil do bloco ao montar (as linhas vem soltas, sem stagger
    // por linha, entao a tabela inteira "assenta" de uma vez, bem de leve).
    // data-sticky-table: sinaliza ao CSS global (globals.css) para aplicar
    // thead sticky com top = --lista-header-h (gravado pelo ListaHeader).
    <div className="u-stagger overflow-clip rounded-lg border border-border bg-surface">
      <table
        data-sticky-table
        className="w-full table-fixed text-sm [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-text-muted [&_thead]:border-b [&_thead]:border-border [&_thead]:bg-surface-2 [&_thead]:shadow-[0_1px_0_var(--border)] [&_td]:px-4 [&_td]:py-2.5 [&_tbody_tr]:border-b [&_tbody_tr]:border-border/60 [&_tbody_tr:last-child]:border-0 [&_tbody_tr]:u-motion hover:[&_tbody_tr]:bg-surface-2/60"
      >
        {children}
      </table>
    </div>
  )
}
