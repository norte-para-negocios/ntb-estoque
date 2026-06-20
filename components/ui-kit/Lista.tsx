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
  // No mobile, as colunas numéricas (alinhadas à direita) viram "valor do lado":
  // vão para a borda direita da linha, estilo extrato. As demais ficam no subtítulo.
  const subColunas = demais.filter((c) => c.alinhar !== 'right')
  const valColunas = demais.filter((c) => c.alinhar === 'right')

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

      {/* Mobile: linhas estilo extrato — finas, padding enxuto. Titulo + dados
          secundarios a esquerda; numeros (colunas .alinhar=right) na borda
          direita; acao por ultimo. Alvo de toque min 38px. */}
      <div className="lg:hidden divide-y divide-border rounded-lg border border-border bg-surface">
        {linhas.map((row, i) => (
          <div
            key={chaveLinha(row)}
            style={stagger(i)}
            className="u-stagger flex min-h-[38px] items-center gap-2.5 px-3 py-2 first:rounded-t-lg last:rounded-b-lg"
          >
            {/* Esquerda: titulo + dados secundarios em linha */}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-text leading-snug">
                {primaria.render(row)}
              </div>
              {subColunas.length > 0 && (
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {subColunas.map((c, idx) => (
                    <span key={idx} className="text-[11px] text-text-muted leading-none">
                      {c.render(row)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {/* Direita: valores numericos, alinhados (estilo extrato). Com 2+
                valores, cada um ganha um rotulo pequeno pra nao confundir; com 1
                so, fica limpo (o cabecalho ja diz o que e no desktop). */}
            {valColunas.length > 0 && (
              <div className="flex shrink-0 flex-col items-end gap-0.5 text-right leading-none">
                {valColunas.map((c, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-baseline justify-end gap-1 text-[13px] leading-none text-text"
                  >
                    {valColunas.length > 1 && (
                      <span className="text-[10px] font-normal text-text-muted">{c.label}</span>
                    )}
                    <span className="num">{c.render(row)}</span>
                  </span>
                ))}
              </div>
            )}
            {/* Acao */}
            {acao && <div className="shrink-0">{acao(row)}</div>}
          </div>
        ))}
      </div>
    </>
  )
}
