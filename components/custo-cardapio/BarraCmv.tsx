import type { Situacao } from '@/lib/custo-cardapio/preco-puro'
import { pct } from '@/lib/custo-cardapio/formato'

const COR: Record<Situacao, string> = { ok: 'bg-ok', atencao: 'bg-warn', acima: 'bg-err', sem_preco: 'bg-text-muted/40', sem_custo: 'bg-text-muted/40', incompleto: 'bg-text-muted/50', suspeito: 'bg-warn' }
const TEXTO: Record<Situacao, string> = { ok: 'text-ok', atencao: 'text-warn', acima: 'text-err', sem_preco: 'text-text-muted', sem_custo: 'text-text-muted', incompleto: 'text-text-muted', suspeito: 'text-warn' }

/** CMV do prato numa barra de 0 a 60%, com a marca da meta. */
export function BarraCmv({ cmv, meta, situacao }: { cmv: number | null; meta: number; situacao: Situacao }) {
  const escala = 0.6
  const largura = cmv == null || situacao === 'suspeito' ? 0 : Math.min(cmv / escala, 1) * 100
  return (
    <div className="flex items-center gap-2.5">
      <span className={`num w-[68px] shrink-0 whitespace-nowrap text-right text-[14px] font-semibold ${TEXTO[situacao]}`}
        title={situacao === 'incompleto' ? 'Falta o custo de algum insumo: o CMV real é maior' : situacao === 'suspeito' ? 'Algum insumo tem custo médio fora do normal' : undefined}>
        {situacao === 'sem_preco' ? 'sem preço' : situacao === 'sem_custo' ? 'sem custo' : situacao === 'incompleto' ? `≥ ${pct(cmv)}` : situacao === 'suspeito' ? 'conferir' : pct(cmv)}
      </span>
      <div className="relative h-1.5 w-full min-w-[60px] rounded-full bg-surface-2" aria-hidden>
        <div className={`absolute inset-y-0 left-0 rounded-full ${COR[situacao]}`} style={{ width: `${largura}%` }} />
        <div className="absolute -inset-y-1 w-px bg-text/40" style={{ left: `${Math.min(meta / escala, 1) * 100}%` }} title={`Meta ${pct(meta, 0)}`} />
      </div>
    </div>
  )
}
