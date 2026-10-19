'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { btnClass } from '@/components/ui-kit/Button'
import { mudarEtapaPedido, type AcaoEtapa } from '@/lib/actions/pedido-compra'
import type { AcaoPedido } from '@/lib/compras/pedido-puro'

const ROTULO: Record<AcaoPedido, string> = {
  editar: 'Editar', enviar: 'Enviar para aprovação', aprovar: 'Aprovar', reprovar: 'Devolver ao comprador', reabrir: 'Reabrir para editar', cancelar: 'Cancelar pedido',
}
const PEDE_MOTIVO: AcaoPedido[] = ['reprovar', 'cancelar']

export function AcoesPedido({ id, acoes, recebeuAlgo }: { id: number; acoes: AcaoPedido[]; recebeuAlgo: boolean }) {
  const router = useRouter()
  const [pend, start] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const [motivoDe, setMotivoDe] = useState<AcaoPedido | null>(null)
  const [motivo, setMotivo] = useState('')

  function executar(a: AcaoPedido, m?: string) {
    setErro(null)
    start(async () => {
      const r = await mudarEtapaPedido(id, a as AcaoEtapa, m ?? null)
      if ('error' in r) setErro(r.error)
      else { setMotivoDe(null); setMotivo(''); router.refresh() }
    })
  }

  if (!acoes.length) return null
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {acoes.map((a) => a === 'editar' ? (
          <Link key={a} href={`/pedido-compra/${id}/editar`} className={btnClass('outline')}>{ROTULO[a]}</Link>
        ) : (
          <button key={a} type="button" disabled={pend} className={btnClass(a === 'aprovar' || a === 'enviar' ? 'primary' : 'outline')}
            onClick={() => (PEDE_MOTIVO.includes(a) ? setMotivoDe(a) : executar(a))}>
            {a === 'cancelar' && recebeuAlgo ? 'Encerrar o que falta receber' : ROTULO[a]}
          </button>
        ))}
      </div>
      {motivoDe && (
        <div className="flex flex-wrap items-center gap-2">
          <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={motivoDe === 'reprovar' ? 'O que precisa mudar?' : 'Motivo do cancelamento'}
            className="h-9 min-w-[240px] flex-1 rounded-[var(--r-md)] bg-surface-2 px-3 text-sm" />
          <button type="button" disabled={pend || !motivo.trim()} className={btnClass('primary')} onClick={() => executar(motivoDe, motivo.trim())}>Confirmar</button>
          <button type="button" className={btnClass('outline')} onClick={() => setMotivoDe(null)}>Voltar</button>
        </div>
      )}
      {erro && <p className="text-[13px] text-err">{erro}</p>}
    </div>
  )
}
