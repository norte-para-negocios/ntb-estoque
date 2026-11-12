import Link from 'next/link'

// Blocos do Início (e reaproveitados em Insumos/Estoque da cozinha): seção com título, uma frase e uma lista em cartão.

export function Secao({ titulo, sub, acao, children }: { titulo: string; sub?: string; acao?: { href: string; rotulo: string }; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-text">{titulo}</h2>
        {acao && <Link href={acao.href} className="shrink-0 text-[13px] font-medium text-brand hover:underline">{acao.rotulo}</Link>}
      </div>
      {sub && <p className="mb-2 text-[13px] text-text-muted">{sub}</p>}
      {!sub && <div className="mb-2" />}
      {children}
    </section>
  )
}

/** Cartão com linhas separadas por um fio. */
export function Lista({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-border/60 overflow-hidden rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">{children}</div>
}

/** Linha clicável: título e detalhe à esquerda, número e detalhe à direita. */
export function Linha({ href, titulo, detalhe, valor, valorDetalhe, tomValor }: {
  href: string; titulo: string; detalhe?: React.ReactNode; valor?: React.ReactNode; valorDetalhe?: React.ReactNode; tomValor?: 'err' | 'warn' | 'ok'
}) {
  const cor = tomValor === 'err' ? 'text-err' : tomValor === 'warn' ? 'text-warn' : tomValor === 'ok' ? 'text-ok' : 'text-text'
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3 u-motion hover:bg-surface-2/60">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-text">{titulo}</p>
        {detalhe && <p className="num truncate text-[12.5px] text-text-muted">{detalhe}</p>}
      </div>
      {(valor != null || valorDetalhe != null) && (
        <div className="shrink-0 text-right">
          {valor != null && <p className={`num text-[14px] font-semibold ${cor}`}>{valor}</p>}
          {valorDetalhe != null && <p className="num text-[12.5px] text-text-muted">{valorDetalhe}</p>}
        </div>
      )}
    </Link>
  )
}

/** Lista vazia: uma frase dentro do cartão. */
export function Vazio({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[var(--r-lg)] bg-surface px-4 py-4 text-[13.5px] text-text-muted shadow-[var(--shadow-sm)]">{children}</div>
}

export const dataCurta = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '—')
export const dataLonga = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')
