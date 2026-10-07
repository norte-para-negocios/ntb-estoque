import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import type { Situacao } from '@/app/(app)/estoque/tipos'

export const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
export const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Cartão de indicador. `tom` pinta só o número (vermelho/âmbar), o resto segue o kit. */
export function Indicador({
  rotulo, valor, dica, icon: Icon, href, tom,
}: { rotulo: string; valor: string; dica?: string; icon: LucideIcon; href?: string; tom?: 'erro' | 'aviso' }) {
  const cor = tom === 'erro' ? 'text-err' : tom === 'aviso' ? 'text-warn' : 'text-text'
  const miolo = (
    <div className="group relative h-full overflow-hidden rounded-[var(--r-lg)] bg-surface p-4 u-card">
      <Icon className={`size-[18px] ${tom ? cor : 'text-text-muted'}`} strokeWidth={1.75} />
      <div className={`mt-3 text-[26px] font-semibold leading-none tracking-[-0.02em] num ${cor}`}>{valor}</div>
      <div className="mt-1.5 text-[13px] font-medium text-text">{rotulo}</div>
      {dica && <div className="text-[12px] text-text-muted">{dica}</div>}
    </div>
  )
  return href ? <Link href={href} className="block h-full">{miolo}</Link> : miolo
}

const SIT: Record<Situacao, { rotulo: string; ponto: string }> = {
  negativo: { rotulo: 'Negativo', ponto: 'bg-err' },
  zerado: { rotulo: 'Zerado', ponto: 'bg-text-muted/50' },
  baixo: { rotulo: 'Abaixo do mínimo', ponto: 'bg-warn' },
  ok: { rotulo: 'Em dia', ponto: 'bg-ok' },
}

export function SituacaoPill({ situacao }: { situacao: Situacao }) {
  const s = SIT[situacao]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-text">
      <span className={`size-2 shrink-0 rounded-full ${s.ponto}`} />
      {s.rotulo}
    </span>
  )
}

/** Barra fina: quanto do mínimo (ou da maior reserva) o saldo representa. Negativo = vermelho cheio. */
export function BarraSaldo({ saldo, minimo, situacao }: { saldo: number; minimo: number | null; situacao: Situacao }) {
  const alvo = minimo && minimo > 0 ? minimo * 2 : Math.max(saldo, 1)
  const pct = situacao === 'negativo' ? 100 : Math.max(0, Math.min(100, (saldo / alvo) * 100))
  const cor = situacao === 'negativo' ? 'bg-err' : situacao === 'baixo' ? 'bg-warn' : situacao === 'zerado' ? 'bg-text-muted/30' : 'bg-brand'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2" role="presentation">
      <div className={`h-full rounded-full ${cor}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Saldo({ valor, unidade, className = '' }: { valor: number; unidade: string; className?: string }) {
  return (
    <span className={`num whitespace-nowrap ${valor < 0 ? 'font-semibold text-err' : ''} ${className}`}>
      {fmtQtd(valor)} <span className="text-[12px] font-normal text-text-muted">{unidade}</span>
    </span>
  )
}
