/**
 * ListaHeader — wrapper sticky para o cabeçalho das telas de lista.
 *
 * Envolve <PageHeader> (+ chips opcionais) e mantém o bloco fixo
 * enquanto a tabela rola, com fundo e borda inferior sutil.
 *
 * Mobile  : sticky top-14 z-20 (abaixo do MobileNav h-14 z-30).
 * Desktop : sticky top-0 z-20 (MobileNav é lg:hidden; sidebar é fixo).
 *
 * z-index 20 — igual ao DetailHeader: acima da tabela, abaixo de
 * modais/gaveta (z-40/z-50).
 *
 * -mx + px: estica o fundo até as bordas do container (px-4/lg:px-8
 * do AppShell), sem afetar o layout interno dos filhos.
 *
 * O <PageHeader> filho mantém seu mb-5 original; o pb-3 do wrapper
 * garante respiro entre os chips e a tabela quando o bloco está colado.
 */
export function ListaHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={[
        'sticky top-14 lg:top-0 z-20',
        'bg-bg/95 backdrop-blur-sm',
        'border-b border-border',
        '-mx-4 px-4 lg:-mx-8 lg:px-8',
        'pt-3 pb-3',
        // Remove a margem inferior do último filho (ex: mb-5 do PageHeader quando
        // não há chips) para o bloco sticky não ficar com padding excessivo.
        '[&>*:last-child]:mb-0',
        'min-w-0',
      ].join(' ')}
    >
      {children}
    </div>
  )
}
