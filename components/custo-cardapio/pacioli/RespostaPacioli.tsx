import Link from 'next/link'
import { blocosDe, type Trecho } from '@/lib/custo-cardapio/pacioli-puro'

// Resposta do Pacioli: parágrafos, listas, negrito e links internos da cozinha. Nada de HTML vindo do modelo.

function Trechos({ trechos }: { trechos: Trecho[] }) {
  return trechos.map((t, i) =>
    t.tipo === 'link' ? <Link key={i} href={t.href} className="font-semibold text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand">{t.v}</Link>
      : t.tipo === 'negrito' ? <strong key={i} className="font-semibold text-text">{t.v}</strong>
        : <span key={i}>{t.v}</span>)
}

export function RespostaPacioli({ texto }: { texto: string }) {
  return (
    <div className="space-y-2 text-[15px] leading-relaxed text-text">
      {blocosDe(texto).map((b, i) =>
        b.tipo === 'paragrafo' ? <p key={i}><Trechos trechos={b.trechos} /></p>
          : b.ordenada
            ? <ol key={i} className="list-decimal space-y-1 pl-5 marker:text-text-muted">{b.itens.map((it, j) => <li key={j}><Trechos trechos={it} /></li>)}</ol>
            : <ul key={i} className="list-disc space-y-1 pl-5 marker:text-text-muted">{b.itens.map((it, j) => <li key={j}><Trechos trechos={it} /></li>)}</ul>)}
    </div>
  )
}
