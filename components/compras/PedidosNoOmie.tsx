import Link from 'next/link'
import { Money } from '@/components/ui-kit/Money'
import type { PedidoOmieResumo } from '@/lib/compras/pedidos-omie-puro'

// C1: pedidos de compra em aberto no Omie (inclusive os criados direto no Omie), só leitura (OMIE_LER_PEDIDOS_COMPRA).

const dataBR = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—')
const SITUACAO: Record<PedidoOmieResumo['situacao'], string> = { pendente: 'A receber', recebido_parcial: 'Recebido em parte', recebido: 'Recebido' }

export function PedidosNoOmie({ pedidos, aviso, truncado }: { pedidos: PedidoOmieResumo[]; aviso: string | null; truncado: boolean }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-text">Pedidos no Omie</h2>
        <span className="text-[12px] text-text-muted">Em aberto no Omie (pendentes, faturados e recebidos em parte), atualizado a cada 10 min{truncado ? ' · só os 250 primeiros' : ''}.</span>
      </div>
      {aviso && <p className="rounded-[var(--r-lg)] bg-warn/10 px-4 py-3 text-[13px] text-text">{aviso}</p>}
      {pedidos.length === 0 ? (
        !aviso && <p className="text-[13px] text-text-muted">Nenhum pedido em aberto no Omie.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--r-lg)] bg-surface u-card">
          {pedidos.map((p) => (
            <li key={p.nCodPed} className="grid items-center gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium text-text">Nº {p.numero} (Omie) · {p.fornecedor}</span>
                <span className="text-[12px] text-text-muted">
                  {p.itens} item(ns){p.inclusao ? ` · incluído ${dataBR(p.inclusao)}` : ''}
                  {p.pedidoNtbId ? <> · <Link href={`/pedido-compra/${p.pedidoNtbId}`} className="text-brand hover:underline">criado aqui no NTB</Link></> : ' · criado no Omie'}
                </span>
              </span>
              <span className="text-[13px] text-text">{SITUACAO[p.situacao]}{p.etapa ? <span className="text-text-muted"> · etapa {p.etapa}</span> : null}</span>
              <span className="text-[13px] text-text-muted">Entrega: <span className="num text-text">{dataBR(p.previsao)}</span></span>
              <span className="md:text-right"><Money value={p.valor} className="text-[14px] font-semibold" /></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
