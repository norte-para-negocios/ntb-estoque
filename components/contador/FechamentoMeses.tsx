'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Lock, LockOpen } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { fecharMes, pendenciasDoMes, reabrirMes } from '@/lib/actions/periodo-fechado'
import { rotuloMes, validarReabertura, type Pendencia } from '@/lib/estoque/periodo-fechado-puro'

export type MesTela = { mes: string; fechado: { em: string; por: string | null; obs: string | null } | null }

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' })
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Fechamento do mês: fechar trava toda escrita com data no mês (no banco e no servidor); reabrir pede motivo e fica registrado.
export function FechamentoMeses({ meses, podeFechar, podeReabrir }: { meses: MesTela[]; podeFechar: boolean; podeReabrir: boolean }) {
  const router = useRouter()
  const [pend, start] = useTransition()
  const [alvo, setAlvo] = useState<{ mes: string; acao: 'fechar' | 'reabrir' } | null>(null)
  const [pendencias, setPendencias] = useState<Pendencia[] | null>(null)
  const [aceitar, setAceitar] = useState(false)
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  function abrir(mes: string, acao: 'fechar' | 'reabrir') {
    setAlvo({ mes, acao }); setTexto(''); setErro(null); setAceitar(false); setPendencias(null)
    if (acao === 'fechar') start(async () => {
      const r = await pendenciasDoMes(mes)
      if ('error' in r) setErro(r.error)
      else setPendencias(r.pendencias)
    })
  }

  function confirmar() {
    if (!alvo) return
    setErro(null)
    start(async () => {
      if (alvo.acao === 'fechar') {
        const r = await fecharMes(alvo.mes, { obs: texto, aceitarPendencias: aceitar })
        if ('error' in r) { setErro(r.error); if (r.pendencias) setPendencias(r.pendencias); return }
        toast.success(`${cap(rotuloMes(alvo.mes))} fechado`, { description: 'Nada mais entra com data neste mês.' })
      } else {
        const r = await reabrirMes(alvo.mes, texto)
        if ('error' in r) { setErro(r.error); return }
        toast.success(`${cap(rotuloMes(alvo.mes))} reaberto`)
      }
      setAlvo(null)
      router.refresh()
    })
  }

  const temPend = (pendencias?.length ?? 0) > 0
  const bloqueado = !alvo || pend || (alvo.acao === 'fechar' ? pendencias === null || (temPend && !aceitar) : !!validarReabertura(texto))

  return (
    <>
      <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--r-lg)] bg-surface u-card">
        {meses.map((m) => (
          <li key={m.mes} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <span className="flex min-w-0 items-center gap-2">
              {m.fechado ? <Lock className="size-4 text-text-muted" aria-hidden /> : <LockOpen className="size-4 text-ok" aria-hidden />}
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-text">{cap(rotuloMes(m.mes))}</span>
                <span className="text-[12px] text-text-muted">
                  {m.fechado ? `Fechado em ${dataHora(m.fechado.em)}${m.fechado.por ? ` por ${m.fechado.por}` : ''}${m.fechado.obs ? ` · ${m.fechado.obs}` : ''}` : 'Aberto: aceita lançamentos com data neste mês'}
                </span>
              </span>
            </span>
            {m.fechado
              ? podeReabrir && <button type="button" className={btnClass('outline')} onClick={() => abrir(m.mes, 'reabrir')}>Reabrir</button>
              : podeFechar && <button type="button" className={btnClass('primary')} onClick={() => abrir(m.mes, 'fechar')}>Fechar mês</button>}
          </li>
        ))}
      </ul>

      <Dialog open={!!alvo} onOpenChange={(o) => { if (!o && !pend) setAlvo(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{alvo ? `${alvo.acao === 'fechar' ? 'Fechar' : 'Reabrir'} ${rotuloMes(alvo.mes)}` : ''}</DialogTitle>
            <p className="text-[13px] text-text-muted">
              {alvo?.acao === 'fechar'
                ? 'Depois de fechado, nenhum lançamento com data neste mês é aceito: entrada de nota, ajuste, inventário, produção, pedido de compra e correção de custo (inclusive o que o Norte Estoque manda ao Omie).'
                : 'Reabrir libera de novo os lançamentos com data neste mês. Quem reabriu e o motivo ficam registrados.'}
            </p>
          </DialogHeader>
          <div className="space-y-3 text-[13px]">
            {alvo?.acao === 'fechar' && pendencias === null && !erro && <p className="flex items-center gap-2 text-text-muted"><Spinner /> Conferindo pendências do mês…</p>}
            {temPend && (
              <div className="space-y-2 rounded-[var(--r-md)] bg-surface-2 p-3">
                <p className="font-medium text-warn">Ainda há envios com data neste mês:</p>
                <ul className="list-disc pl-5">{pendencias!.map((p) => <li key={p.tipo}>{p.quantidade} {p.detalhe}</li>)}</ul>
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5" checked={aceitar} onChange={(e) => setAceitar(e.target.checked)} />
                  Fechar assim mesmo: estes envios ficam parados enquanto o mês estiver fechado.
                </label>
              </div>
            )}
            {alvo?.acao === 'fechar' && pendencias !== null && !temPend && <p className="text-ok">Nenhuma pendência com data neste mês.</p>}
            <label className="block space-y-1">
              <span>{alvo?.acao === 'fechar' ? 'Observação (opcional)' : 'Motivo da reabertura'}</span>
              <input className="w-full rounded-[var(--r-md)] bg-surface-2 px-3 py-2" value={texto} onChange={(e) => setTexto(e.target.value)}
                placeholder={alvo?.acao === 'fechar' ? 'Ex.: enviado ao contador' : 'Ex.: contador pediu para corrigir o inventário'} />
            </label>
            {erro && <p className="rounded-[var(--r-md)] bg-surface-2 p-2 font-medium text-err">{erro}</p>}
          </div>
          <DialogFooter>
            <button type="button" className={btnClass(alvo?.acao === 'reabrir' ? 'outline' : 'primary')} disabled={bloqueado} onClick={confirmar}>
              {pend && <Spinner />}{alvo?.acao === 'fechar' ? 'Fechar o mês' : 'Reabrir o mês'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
