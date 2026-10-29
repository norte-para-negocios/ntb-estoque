import Link from 'next/link'

export type AtalhoEstoque = 'estoque' | 'correcoes' | 'kardex' | 'ajustes' | 'fichas' | 'ops' | 'quem-mexeu'

const ATALHOS: { chave: AtalhoEstoque; href: string; rotulo: string }[] = [
  { chave: 'estoque', href: '/estoque', rotulo: 'Saldos' },
  { chave: 'kardex', href: '/estoque/kardex', rotulo: 'Kardex' },
  { chave: 'ajustes', href: '/estoque/ajustes', rotulo: 'Ajustes' },
  { chave: 'fichas', href: '/estoque/fichas', rotulo: 'Fichas' },
  { chave: 'ops', href: '/ordem-producao/abertas', rotulo: 'OPs abertas' },
  { chave: 'quem-mexeu', href: '/estoque/quem-mexeu', rotulo: 'Quem mexeu' },
]

/** Abas das telas de estoque (saldos, saúde, kardex, auditoria). Rola na horizontal no celular. */
export function EstoqueAtalhos({ atual }: { atual: AtalhoEstoque }) {
  return (
    <nav aria-label="Telas do estoque" className="-mx-1 overflow-x-auto pb-1">
      <ul className="flex w-max gap-1 px-1">
        {ATALHOS.map((a) => {
          const ativo = a.chave === atual
          return (
            <li key={a.chave}>
              <Link
                href={a.href}
                aria-current={ativo ? 'page' : undefined}
                className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-[13px] font-medium u-motion ${ativo ? 'bg-text text-surface' : 'bg-surface-2 text-text-muted hover:text-text'}`}
              >
                {a.rotulo}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
