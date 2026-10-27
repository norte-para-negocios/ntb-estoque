import type { ReactNode } from 'react'
import { Check, CircleAlert } from 'lucide-react'

export type PassoEntrada = { ok: boolean; texto: string }

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * Moldura do painel "Dar entrada" (27/10/2026): fica ao lado dos itens (no celular, embaixo) em vez da barra que
 * flutuava por cima da tela. Passos com ✓ ou o que falta, campos, totais e o botão; o conteúdo vem de quem usa
 * (loja com Omie ou estoque próprio).
 */
export function PainelEntrada({ titulo, passos, children, totais, rodape }: {
  titulo: string
  passos?: PassoEntrada[]
  children?: ReactNode
  totais?: { mercadorias: number; outros: number; total: number } | null
  rodape?: ReactNode
}) {
  return (
    <aside className="flex flex-col gap-4 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1" aria-label={titulo}>
      <h2 className="text-[16px] font-semibold text-text">{titulo}</h2>
      {!!passos?.length && (
        <ol className="space-y-2">
          {passos.map((p) => (
            <li key={p.texto} className="flex items-start gap-2.5 text-[14px]">
              <span className={`mt-px flex size-5 shrink-0 items-center justify-center rounded-full ${p.ok ? 'bg-[color-mix(in_srgb,var(--ok)_15%,transparent)] text-ok' : 'bg-[color-mix(in_srgb,var(--warn)_16%,transparent)] text-warn'}`} aria-hidden>
                {p.ok ? <Check className="size-3" strokeWidth={3} /> : <CircleAlert className="size-3" strokeWidth={2.6} />}
              </span>
              <span className={p.ok ? 'text-text' : 'font-medium text-warn'}>{p.texto}</span>
            </li>
          ))}
        </ol>
      )}
      {children}
      {totais && (
        <dl className="num space-y-1 border-t border-border pt-3 text-[13px]">
          <div className="flex justify-between"><dt className="text-text-muted">Mercadorias</dt><dd>{brl(totais.mercadorias)}</dd></div>
          {totais.outros !== 0 && <div className="flex justify-between"><dt className="text-text-muted">Desconto, IPI, ST e frete</dt><dd>{totais.outros > 0 ? '+' : ''}{brl(totais.outros)}</dd></div>}
          <div className="flex justify-between pt-1 text-[16px] font-semibold text-text"><dt>Total da nota</dt><dd>{brl(totais.total)}</dd></div>
        </dl>
      )}
      {rodape}
    </aside>
  )
}
