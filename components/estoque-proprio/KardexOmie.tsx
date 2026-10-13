'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { LinhaKardexOmie } from '@/lib/estoque/kardex-omie-puro'
import { formatCustoUnit } from '@/lib/num-br'

const fmt = (n: number | null, d = 3) => (n == null ? '-' : n.toLocaleString('pt-BR', { maximumFractionDigits: d }))
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const dia = (iso: string) => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a.slice(2)}` }

export type LinhaKardexTela = LinhaKardexOmie & { saltoCmc: boolean; local: string }

/** Kardex do Omie (ListarMovimentoEstoque) de um produto, mais recente primeiro; carga sob demanda (só leitura do Omie). */
export function KardexOmie({ codigoProduto, unidade, linhas, podeCarregar, ultimaCarga = null }: {
  codigoProduto: number; unidade: string; linhas: LinhaKardexTela[]; podeCarregar: boolean
  ultimaCarga?: { carregadoEm: string; movimentos: number } | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function carregar() {
    start(async () => {
      const r = await fetch('/api/estoque/kardex-omie', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigoProduto }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error('Não foi possível ler os movimentos do Omie', { description: j.error ?? `HTTP ${r.status}` }); return }
      toast.success(j.doCache ? 'Já carregado há pouco' : `Movimentos atualizados (${j.gravados})`)
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      {podeCarregar && (
        <button type="button" onClick={carregar} disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-[13px] font-medium text-text u-card disabled:opacity-60">
          <RefreshCw className={`size-3.5 ${pending ? 'animate-spin' : ''}`} /> {pending ? 'Lendo o Omie…' : 'Carregar movimentos do Omie'}
        </button>
      )}
      {ultimaCarga && <p className="text-[12px] text-text-muted">Lido do Omie em {quando(ultimaCarga.carregadoEm)} (últimos 55 dias).</p>}
      {!linhas.length ? (
        <p className="px-1 py-6 text-center text-[13px] text-text-muted">{ultimaCarga ? 'Nenhum movimento no Omie nos últimos 55 dias.' : 'Nenhum movimento carregado. Clique em Carregar movimentos do Omie (últimos 55 dias).'}</p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface u-card">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                <th className="px-4 py-2.5 font-medium">Data</th>
                <th className="px-2 py-2.5 font-medium">Origem</th>
                <th className="px-2 py-2.5 font-medium">Local</th>
                <th className="px-2 py-2.5 text-right font-medium">Quantidade</th>
                <th className="px-2 py-2.5 text-right font-medium">Custo unit.</th>
                <th className="px-2 py-2.5 text-right font-medium">Custo médio após</th>
                <th className="px-2 py-2.5 text-right font-medium">Saldo após</th>
                <th className="px-4 py-2.5 font-medium">Documento</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((m) => {
                const entra = m.quantidade > 0
                return (
                  <tr key={m.id_mov} className={`border-t border-[var(--border)] ${m.cancelado ? 'line-through opacity-60' : ''}`}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-text-muted num">{dia(m.data_mov)}</td>
                    <td className="px-2 py-2.5">
                      <div className="font-medium text-text">{m.cod_origem || '-'}</div>
                      {m.des_origem && <div className="text-[12px] text-text-muted">{m.des_origem}</div>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-text-muted">{m.local}</td>
                    <td className={`whitespace-nowrap px-2 py-2.5 text-right num font-medium ${entra ? 'text-ok' : 'text-err'}`}>
                      {entra ? '+' : ''}{fmt(m.quantidade)} {unidade}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right num text-text-muted">{m.valor_unit != null ? formatCustoUnit(m.valor_unit) : '-'}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right num">
                      {m.cmc_apos != null ? formatCustoUnit(m.cmc_apos) : '-'}
                      {m.saltoCmc && <span title="Custo médio subiu 10 vezes ou mais neste movimento" className="ml-1.5 rounded-full bg-surface-2 px-1.5 text-[11px] font-semibold text-err">salto</span>}
                    </td>
                    <td className={`whitespace-nowrap px-2 py-2.5 text-right num ${(m.saldo_apos ?? 0) < 0 ? 'font-semibold text-err' : 'text-text'}`}>{fmt(m.saldo_apos)}</td>
                    <td className="px-4 py-2.5 text-text-muted">{m.num_pedido ?? m.num_doc ?? '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
