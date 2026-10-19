'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { btnClass } from '@/components/ui-kit/Button'
import { acaoRequisicao, gerarPedidosDasRequisicoes } from '@/lib/actions/requisicao-compra'
import type { AcaoRequisicao } from '@/lib/compras/requisicao-puro'

const ROTULO: Record<AcaoRequisicao, string> = { editar: 'Editar', aprovar: 'Aprovar', recusar: 'Recusar', reabrir: 'Reabrir' }
const novaChave = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`)

export function AcoesRequisicao({ id, acoes, podeGerarPedido }: { id: number; acoes: AcaoRequisicao[]; podeGerarPedido: boolean }) {
  const router = useRouter()
  const [pend, start] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const [recusando, setRecusando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [chave] = useState(novaChave)

  function executar(a: Exclude<AcaoRequisicao, 'editar'>, m?: string) {
    setErro(null)
    start(async () => {
      const r = await acaoRequisicao(id, a, m ?? null)
      if ('error' in r) setErro(r.error)
      else { setRecusando(false); setMotivo(''); router.refresh() }
    })
  }
  function gerar() {
    setErro(null)
    start(async () => {
      const r = await gerarPedidosDasRequisicoes([id], chave)
      if ('error' in r) { setErro(r.error); return }
      if (r.pedidos.length === 1) router.push(`/pedido-compra/${r.pedidos[0].id}`)
      else router.push(`/pedido-compra?criados=${r.pedidos.map((p) => p.numero).join(',')}`)
    })
  }

  if (!acoes.length && !podeGerarPedido) return null
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {podeGerarPedido && <button type="button" disabled={pend} className={btnClass('primary')} onClick={gerar}>{pend ? 'Gerando…' : 'Gerar pedido de compra'}</button>}
        {acoes.map((a) => a === 'editar' ? (
          <Link key={a} href={`/requisicao-compra/${id}/editar`} className={btnClass('outline')}>{ROTULO[a]}</Link>
        ) : (
          <button key={a} type="button" disabled={pend} className={btnClass(a === 'aprovar' ? 'primary' : 'outline')}
            onClick={() => (a === 'recusar' ? setRecusando(true) : executar(a))}>{ROTULO[a]}</button>
        ))}
      </div>
      {recusando && (
        <div className="flex flex-wrap items-center gap-2">
          <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por que recusar?"
            className="h-9 min-w-[240px] flex-1 rounded-[var(--r-md)] bg-surface-2 px-3 text-sm" />
          <button type="button" disabled={pend || !motivo.trim()} className={btnClass('primary')} onClick={() => executar('recusar', motivo.trim())}>Confirmar</button>
          <button type="button" className={btnClass('outline')} onClick={() => setRecusando(false)}>Voltar</button>
        </div>
      )}
      {erro && <p className="text-[13px] text-err">{erro}</p>}
    </div>
  )
}
