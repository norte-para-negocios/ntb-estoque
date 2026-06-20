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

  // A4: stagger leve só nas primeiras linhas (24ms/linha, teto ~12) para a lista
  // "assentar" ao carregar sem atrasar o uso. Da 12 em diante entra sem delay.
  const stagger = (i: number): React.CSSProperties =>
    ({ '--stagger': `${Math.min(i, 11) * 24}ms` } as React.CSSProperties)

  return (
    <>
      {/* Desktop: tabela. overflow-clip (NAO -hidden): corta o fundo quadrado do
          thead na curva do card SEM virar scroll container, entao o cabecalho fixo
          (sticky) continua funcionando ao rolar, igual Excel. */}
      <div className="hidden lg:block overflow-clip rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead
            className="sticky z-20 border-b border-border bg-surface-2 shadow-[0_1px_0_var(--border)]"
            style={{
              // Desktop: fica logo abaixo do ListaHeader (top-0 do ListaHeader).
              // Mobile: fica abaixo do MobileNav (56px) + ListaHeader.
              // --lista-header-h é gravado pelo ListaHeader via ResizeObserver.
              // Fallback 0px: telas sem ListaHeader o thead gruda no topo normal.
              top: 'var(--lista-header-h, 0px)',
            }}
          >
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
            {linhas.map((row, i) => (
              <tr
                key={chaveLinha(row)}
                style={stagger(i)}
                className="border-b border-border/60 last:border-0 u-motion u-stagger even:bg-surface-2/30 hover:bg-surface-2/60"
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

      {/* Mobile: linhas estilo extrato — compactas, padding reduzido,
          dados secundarios em linha unica abaixo do titulo.
          Altura minima 40px por linha clicavel (alvo de toque). */}
      <div className="lg:hidden divide-y divide-border rounded-lg border border-border bg-surface">
        {linhas.map((row, i) => (
          <div
            key={chaveLinha(row)}
            style={stagger(i)}
            className="u-stagger flex min-h-[40px] items-center gap-2 px-3 py-2.5 first:rounded-t-lg last:rounded-b-lg"
          >
            {/* Coluna esquerda: titulo + dados secundarios em linha */}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-text leading-snug">
                {primaria.render(row)}
              </div>
              {demais.length > 0 && (
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                  {demais.map((c, idx) => (
                    <span key={idx} className="text-xs text-text-muted leading-none">
                      {c.render(row)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {/* Coluna direita: acao */}
            {acao && <div className="shrink-0">{acao(row)}</div>}
          </div>
        ))}
      </div>
    </>
  )
}
