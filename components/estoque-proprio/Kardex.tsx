'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { btnLinhaClass } from '@/components/ui-kit/Button'
import { estornarMovimento } from '@/lib/actions/estoque-proprio'
import { ROTULO_TIPO, type Movimento } from '@/app/(app)/estoque/tipos'

const fmt = (n: number, d = 3) => n.toLocaleString('pt-BR', { maximumFractionDigits: d })
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const ORIGEM: Record<string, string> = {
  ENTRADA_MANUAL: 'Entrada manual', AJUSTE_MANUAL: 'Ajuste manual', TRANSFERENCIA: 'Transferência', ESTORNO: 'Estorno', VENDA: 'Venda',
}

/** Kardex: tabela cronológica inversa de movimentos, com estorno por linha. */
export function Kardex({ movimentos, unidade, mostrarProduto = false, podeEstornar = false }: {
  movimentos: Movimento[]; unidade?: string; mostrarProduto?: boolean; podeEstornar?: boolean
}) {
  const router = useRouter()
  const [confirmando, setConfirmando] = useState<number | null>(null)
  const [pending, start] = useTransition()

  function estornar(id: number) {
    start(async () => {
      const r = await estornarMovimento(id)
      setConfirmando(null)
      if ('error' in r) { toast.error('Não foi possível estornar', { description: r.error }); return }
      toast.success('Movimento estornado')
      router.refresh()
    })
  }

  if (!movimentos.length) return <p className="px-1 py-8 text-center text-[13px] text-text-muted">Nenhum movimento ainda.</p>

  return (
    <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface u-card">
      <table className="w-full min-w-[720px] text-left text-[13px]">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-text-muted">
            <th className="px-4 py-2.5 font-medium">Quando</th>
            <th className="px-2 py-2.5 font-medium">Movimento</th>
            {mostrarProduto && <th className="px-2 py-2.5 font-medium">Produto</th>}
            <th className="px-2 py-2.5 font-medium">Local</th>
            <th className="px-2 py-2.5 text-right font-medium">Quantidade</th>
            <th className="px-2 py-2.5 text-right font-medium">Custo</th>
            <th className="px-2 py-2.5 text-right font-medium">Saldo após</th>
            {podeEstornar && <th className="px-4 py-2.5" />}
          </tr>
        </thead>
        <tbody>
          {movimentos.map((m) => {
            const entra = m.quantidade > 0
            return (
              <tr key={m.id} className={`border-t border-[var(--border)] ${m.estornado ? 'opacity-55' : ''}`}>
                <td className="whitespace-nowrap px-4 py-2.5 text-text-muted num">{quando(m.criado)}</td>
                <td className="px-2 py-2.5">
                  <div className="font-medium text-text">{ROTULO_TIPO[m.tipo] ?? m.tipo}{m.estornado && <span className="ml-1.5 text-[11px] font-normal text-text-muted">estornado</span>}{m.ehEstorno && <span className="ml-1.5 text-[11px] font-normal text-text-muted">estorno</span>}</div>
                  <div className="text-[12px] text-text-muted">{ORIGEM[m.origem] ?? m.origem}{m.obs ? ` · ${m.obs}` : ''}</div>
                </td>
                {mostrarProduto && (
                  <td className="px-2 py-2.5"><Link href={`/estoque/produto/${m.codigoProduto}`} className="hover:underline">{m.produto ?? m.codigoProduto}</Link></td>
                )}
                <td className="whitespace-nowrap px-2 py-2.5 text-text-muted">{m.local}</td>
                <td className={`whitespace-nowrap px-2 py-2.5 text-right num font-medium ${entra ? 'text-ok' : 'text-err'}`}>
                  {entra ? '+' : ''}{fmt(m.quantidade)}{unidade ? ` ${unidade}` : ''}
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right num text-text-muted">
                  {m.custo != null ? m.custo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'}
                  {m.custoEstimado && <span title="Entrada sem custo informado" className="ml-1">*</span>}
                </td>
                <td className={`whitespace-nowrap px-2 py-2.5 text-right num ${m.saldoApos < 0 ? 'font-semibold text-err' : 'text-text'}`}>{fmt(m.saldoApos)}</td>
                {podeEstornar && (
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    {!m.estornado && !m.ehEstorno && m.tipo !== 'TRF' && (
                      confirmando === m.id ? (
                        <span className="inline-flex items-center gap-1.5">
                          <button type="button" disabled={pending} onClick={() => estornar(m.id)} className={btnLinhaClass('dangerSoft')} style={{ width: 'auto', padding: '0 12px' }}>Confirmar</button>
                          <button type="button" onClick={() => setConfirmando(null)} className="text-[12px] text-text-muted hover:text-text">Cancelar</button>
                        </span>
                      ) : (
                        <button type="button" aria-label="Estornar movimento" title="Estornar" onClick={() => setConfirmando(m.id)} className={btnLinhaClass('ghost')}><Undo2 className="size-4" /></button>
                      )
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
