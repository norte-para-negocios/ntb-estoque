import * as React from 'react'

export type Coluna<T> = {
  label: string
  render: (row: T) => React.ReactNode
  alinhar?: 'right'
  primaria?: boolean // vira o título do card no mobile
  flexivel?: boolean // no desktop, absorve o espaço restante e trunca (texto longo)
  ocultarMobile?: boolean // não aparece no card
  larguraDesktop?: string // aceito por compatibilidade (largura é automática agora)
}

export function Lista<T>({
  colunas,
  linhas,
  chaveLinha,
  acao,
  vazio,
}: {
  colunas: Coluna<T>[]
  linhas: T[]
  chaveLinha: (row: T) => string | number
  acao?: (row: T) => React.ReactNode
  vazio?: React.ReactNode
}) {
  if (!linhas.length) return <>{vazio ?? null}</>
  const primaria = colunas.find((c) => c.primaria) ?? colunas[0]
  // A coluna flexível absorve o espaço e trunca; se nenhuma marcada, usa a primária.
  const flexivel = colunas.find((c) => c.flexivel) ?? primaria
  const demais = colunas.filter((c) => c !== primaria && !c.ocultarMobile)

  // Classes da célula no desktop: flexível encolhe e trunca; o resto fica natural (nowrap).
  const tdClasse = (c: Coluna<T>) =>
    c === flexivel
      ? 'w-full max-w-0 truncate'
      : 'whitespace-nowrap'

  return (
    <>
      {/* Desktop: tabela (largura automática, sem estourar). overflow-hidden clipa
          o conteudo no raio do container -> cantos arredondados sem o thead "vazar". */}
      <div className="hidden lg:block overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-2 shadow-[0_1px_0_var(--border)]">
            <tr>
              {colunas.map((c, i) => (
                <th
                  key={i}
                  className={`px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted ${
                    c.alinhar === 'right' ? 'text-right' : 'text-left'
                  } ${c === flexivel ? '' : 'whitespace-nowrap'} ${i === 0 ? 'rounded-tl-lg' : ''} ${
                    i === colunas.length - 1 && !acao ? 'rounded-tr-lg' : ''
                  }`}
                >
                  {c.label}
                </th>
              ))}
              {acao && <th className="rounded-tr-lg px-4 py-2" />}
            </tr>
          </thead>
          <tbody>
            {linhas.map((row) => (
              <tr
                key={chaveLinha(row)}
                className="border-b border-border/60 last:border-0 transition-colors even:bg-surface-2/30 hover:bg-surface-2/40"
              >
                {colunas.map((c, i) => (
                  <td
                    key={i}
                    className={`px-4 py-2 ${c.alinhar === 'right' ? 'text-right' : ''} ${tdClasse(c)}`}
                  >
                    {c.render(row)}
                  </td>
                ))}
                {acao && (
                  <td className="px-4 py-2 text-right whitespace-nowrap">{acao(row)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards empilhados */}
      <div className="lg:hidden space-y-3">
        {linhas.map((row) => (
          <div key={chaveLinha(row)} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 font-semibold text-text">{primaria.render(row)}</div>
              {acao && <div className="shrink-0">{acao(row)}</div>}
            </div>
            {demais.length > 0 && (
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                {demais.map((c, i) => (
                  <div key={i} className={`min-w-0 ${c.alinhar === 'right' ? 'text-right' : ''}`}>
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                      {c.label}
                    </dt>
                    <dd className="text-sm text-text break-words">{c.render(row)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
