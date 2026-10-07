'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui-kit/Spinner'
import { detalheMovimentoProprio, type DetalheKardex as Detalhe } from '@/lib/actions/movimentacoes-proprio'
import { ROTULO_ORIGEM, ROTULO_TIPO } from '@/lib/estoque/kardex-tipos'

const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })
const brl = (n: number | null) => (n == null ? '-' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }))
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })

/** Janela de detalhe de um movimento do kardex: dados, documento de origem e movimentos ligados (estorno, pernas). */
export function DetalheKardex({ id, onFechar, onAbrir }: { id: number | null; onFechar: () => void; onAbrir: (id: number) => void }) {
  const [det, setDet] = useState<Detalhe | null>(null)

  useEffect(() => {
    if (id == null) return
    let vivo = true
    setDet(null)
    detalheMovimentoProprio(id).then((d) => { if (vivo) setDet(d) })
    return () => { vivo = false }
  }, [id])

  return (
    <Dialog open={id != null} onOpenChange={(o) => { if (!o) onFechar() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Movimento #{id}</DialogTitle>
        </DialogHeader>
        {!det ? (
          <div className="flex items-center gap-2 py-6 text-sm text-text-muted"><Spinner /> Carregando...</div>
        ) : 'error' in det ? (
          <p className="py-4 text-sm text-err">{det.error}</p>
        ) : (
          <div className="space-y-4 text-[14px]">
            <div>
              <p className="font-semibold text-text">{det.movimento.produto}</p>
              <p className="num text-[12px] text-text-muted">{det.movimento.codigo}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-[var(--r-md)] bg-surface-2 p-3 text-[13px]">
              <dt className="text-text-muted">Tipo</dt><dd>{ROTULO_TIPO[det.movimento.tipo] ?? det.movimento.tipo}</dd>
              <dt className="text-text-muted">Origem</dt><dd>{ROTULO_ORIGEM[det.movimento.origem] ?? det.movimento.origem}</dd>
              <dt className="text-text-muted">Quantidade</dt>
              <dd className={`num font-medium ${det.movimento.quantidade < 0 ? 'text-err' : 'text-ok'}`}>{det.movimento.quantidade > 0 ? '+' : ''}{qtd(det.movimento.quantidade)}{det.movimento.unidade ? ` ${det.movimento.unidade}` : ''}</dd>
              <dt className="text-text-muted">Local</dt><dd>{det.movimento.local ?? '-'}</dd>
              <dt className="text-text-muted">Saldo no local depois</dt><dd className="num">{qtd(det.movimento.saldo_apos)}</dd>
              <dt className="text-text-muted">Saldo total depois</dt><dd className="num">{qtd(det.movimento.saldo_total_apos)}</dd>
              <dt className="text-text-muted">Custo do movimento</dt><dd className="num">{brl(det.movimento.custo)}{det.movimento.custo_estimado ? ' (estimado)' : ''}</dd>
              <dt className="text-text-muted">Custo médio depois</dt><dd className="num">{brl(det.movimento.cmc_apos)}</dd>
              <dt className="text-text-muted">Quando</dt><dd>{quando(det.movimento.quando)}</dd>
              <dt className="text-text-muted">Usuário</dt><dd className="break-all">{det.movimento.user_id ?? '-'}</dd>
              <dt className="text-text-muted">Referência</dt><dd className="num break-all">{det.movimento.ref}</dd>
              {det.movimento.obs && (<><dt className="text-text-muted">Observação</dt><dd>{det.movimento.obs}</dd></>)}
            </dl>

            {det.documento && (
              <div className="rounded-[var(--r-md)] border border-border/60 p-3">
                <p className="eyebrow">Documento de origem</p>
                <p className="mt-1 font-medium text-text">{det.documento.rotulo}</p>
                <p className="text-[13px] text-text-muted">{det.documento.descricao}</p>
                {det.documento.linhas?.map((l) => (
                  <p key={l.rotulo} className="mt-1 text-[12px] text-text-muted"><span className="font-medium">{l.rotulo}:</span> <span className="break-all">{l.valor}</span></p>
                ))}
                {det.documento.href && (
                  <Link href={det.documento.href} className="mt-2 inline-block text-[13px] font-medium text-brand hover:underline">Abrir documento</Link>
                )}
              </div>
            )}

            {det.vinculados.length > 0 && (
              <div>
                <p className="eyebrow">Movimentos ligados</p>
                <ul className="mt-1 divide-y divide-border/60 rounded-[var(--r-md)] bg-surface-2">
                  {det.vinculados.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                      <span className="min-w-0">
                        <span className="block text-text-muted">{v.rotulo}</span>
                        <span className="block truncate">{v.produto} · {v.local ?? '-'} · {quando(v.quando)}</span>
                      </span>
                      <button type="button" onClick={() => onAbrir(v.id)} className="shrink-0 font-medium text-brand hover:underline">
                        #{v.id} · <span className="num">{v.quantidade > 0 ? '+' : ''}{qtd(v.quantidade)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
