// Quadro das etapas do recebimento (loja de estoque próprio): 4 colunas e o contador das canceladas/desfeitas.
import Link from 'next/link'
import { ORDEM_ETAPAS, ROTULO_ETAPA, type EtapaNF } from '@/lib/estoque/nf-etapas'

export type CartaoEtapa = { id: number; numero: string | null; fornecedor: string | null; valor: number | null; emissao: string | null; situacao: string | null; cancelada: boolean }

const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtData = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
const SELO: Record<string, string> = { divergente: 'divergente', parcial: 'parcial' }

export function QuadroEtapasNF({ grupos }: { grupos: Record<EtapaNF, CartaoEtapa[]> }) {
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-text-muted">{ROTULO_ETAPA.fora}: <span className="num font-medium text-text">{grupos.fora.length}</span></p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {ORDEM_ETAPAS.map((e) => (
          <section key={e} className="space-y-2 rounded-[var(--r-lg)] bg-surface-2 p-3" aria-label={ROTULO_ETAPA[e]}>
            <h2 className="flex items-center justify-between text-[14px] font-semibold text-text">{ROTULO_ETAPA[e]}<span className="num text-text-muted">{grupos[e].length}</span></h2>
            {grupos[e].length === 0 && <p className="text-[13px] text-text-muted">Nenhuma nota.</p>}
            <ul className="space-y-2">
              {grupos[e].map((n) => (
                <li key={n.id}>
                  <Link href={`/nota-fiscal/${n.id}`} className="block rounded-[var(--r-md)] bg-surface p-3 shadow-[var(--shadow-sm)] hover:bg-surface/80">
                    <p className="truncate text-[14px] font-medium text-text">{n.fornecedor ?? 'Fornecedor sem nome'}</p>
                    <p className="num text-[12px] text-text-muted">
                      NF {n.numero ?? '—'}{n.emissao ? ` · ${fmtData(n.emissao)}` : ''}{n.valor != null ? ` · ${fmtBRL(n.valor)}` : ''}
                    </p>
                    {n.situacao && SELO[n.situacao] && <span className="mt-1 inline-block rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-medium text-warn">{SELO[n.situacao]}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
