'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { cancelarInventario, definirMotivoItem, fecharInventario } from '@/lib/actions/inventario-proprio'
import { podeFechar, resumirVariancia } from '@/lib/estoque/inventario-regras'

export type LinhaRevisao = {
  codigoProduto: number; codigo: string; descricao: string; unidade: string
  esperado: number; contado: number; delta: number; cmc: number; valorDelta: number; motivo: string | null; exigeMotivo: boolean; aplicado: number | null
}

const fmtQ = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const fmtR = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function RevisarContagem({ inventarioId, linhas: inicial, fechado, limite }: { inventarioId: number; linhas: LinhaRevisao[]; fechado: boolean; limite: number }) {
  const router = useRouter()
  const [linhas, setLinhas] = useState(inicial)
  const [pending, start] = useTransition()
  const [confirmar, setConfirmar] = useState<null | 'fechar' | 'cancelar'>(null)
  const resumo = resumirVariancia(linhas)
  const ok = podeFechar(linhas)
  const comDiferenca = linhas.filter((l) => l.delta !== 0)
  const iguais = linhas.length - comDiferenca.length

  async function salvarMotivo(l: LinhaRevisao, motivo: string) {
    if ((l.motivo ?? '') === motivo.trim()) return
    const r = await definirMotivoItem({ inventarioId, codigoProduto: l.codigoProduto, motivo })
    if ('error' in r) return toast.error('Não salvou o motivo', { description: r.error })
    setLinhas((ls) => ls.map((x) => (x.codigoProduto === l.codigoProduto ? { ...x, motivo: motivo.trim() || null } : x)))
  }

  function executar() {
    const acao = confirmar
    start(async () => {
      if (acao === 'fechar') {
        const r = await fecharInventario(inventarioId)
        if ('error' in r) { toast.error('Não foi possível fechar', { description: r.error }); return }
        toast.success('Contagem fechada', { description: `${r.ajustes} ajuste(s) lançado(s) no estoque.` })
      } else if (acao === 'cancelar') {
        const r = await cancelarInventario(inventarioId)
        if ('error' in r) { toast.error('Não foi possível cancelar', { description: r.error }); return }
        toast.success('Contagem cancelada. Nada foi ajustado.')
      }
      setConfirmar(null)
      router.push('/inventario-proprio')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card rotulo="Itens contados" valor={String(resumo.contados)} dica={`${iguais} sem diferença`} />
        <Card rotulo="Com diferença" valor={String(resumo.comDiferenca)} dica="viram ajuste ao fechar" tom={resumo.comDiferenca ? 'aviso' : undefined} />
        <Card rotulo="Faltas" valor={fmtR(resumo.faltas)} dica="a custo médio" tom={resumo.faltas < 0 ? 'erro' : undefined} icone={<TrendingDown className="size-4" />} />
        <Card rotulo="Sobras" valor={fmtR(resumo.sobras)} dica={`saldo líquido ${fmtR(resumo.liquido)}`} icone={<TrendingUp className="size-4" />} />
      </div>

      {!fechado && resumo.semMotivo > 0 && (
        <div className="flex items-start gap-2 rounded-[var(--r-lg)] bg-warn/10 p-3 text-[13px] text-text">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
          <span>{resumo.semMotivo} item(ns) com diferença acima de {fmtR(limite)} precisam de um motivo antes de fechar.</span>
        </div>
      )}

      <section className="overflow-hidden rounded-[var(--r-lg)] bg-surface u-card">
        <div className="hidden grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,0.8fr))_minmax(0,0.9fr)_minmax(0,1.6fr)] gap-3 border-b border-[var(--border)] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-muted md:grid">
          <span>Produto</span><span className="text-right">Sistema</span><span className="text-right">Contado</span><span className="text-right">Diferença</span><span className="text-right">Valor</span><span>Motivo</span>
        </div>
        <ul className="divide-y divide-[var(--border)]">
          {linhas.map((l) => {
            const falta = l.exigeMotivo && l.delta !== 0 && !(l.motivo ?? '').trim()
            return (
              <li key={l.codigoProduto} className={`grid gap-x-3 gap-y-1 px-4 py-3 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,0.8fr))_minmax(0,0.9fr)_minmax(0,1.6fr)] md:items-center ${l.delta === 0 ? 'opacity-60' : ''}`}>
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-medium text-text">{l.descricao}</div>
                  <div className="num text-[12px] text-text-muted">{l.codigo} · {l.unidade}</div>
                </div>
                <Celula rotulo="Sistema" valor={fmtQ(l.esperado)} />
                <Celula rotulo="Contado" valor={fmtQ(l.contado)} />
                <Celula rotulo="Diferença" valor={`${l.delta > 0 ? '+' : ''}${fmtQ(l.delta)}`} cor={l.delta < 0 ? 'text-err' : l.delta > 0 ? 'text-ok' : ''} forte />
                <Celula rotulo="Valor" valor={fmtR(l.valorDelta)} cor={l.valorDelta < 0 ? 'text-err' : ''} />
                <div>
                  {l.delta === 0 ? <span className="text-[12px] text-text-muted">—</span> : fechado
                    ? <span className="text-[13px] text-text">{l.motivo || <span className="text-text-muted">sem motivo</span>}</span>
                    : <input defaultValue={l.motivo ?? ''} onBlur={(e) => salvarMotivo(l, e.target.value)} placeholder={l.exigeMotivo ? 'Motivo obrigatório' : 'Motivo (opcional)'}
                        aria-label={`Motivo da diferença de ${l.descricao}`}
                        className={`w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-base text-text outline-none focus:ring-2 focus:ring-brand/40 md:text-[13px] ${falta ? 'ring-2 ring-warn/60' : ''}`} />}
                </div>
              </li>
            )
          })}
          {linhas.length === 0 && <li className="px-4 py-10 text-center text-[14px] text-text-muted">Ninguém contou nenhum item ainda.</li>}
        </ul>
      </section>

      {!fechado && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" className={btnClass('dangerSoft')} onClick={() => setConfirmar('cancelar')}>Cancelar contagem</button>
          <button type="button" className={btnClass('primary')} onClick={() => setConfirmar('fechar')} disabled={!ok}
            title={ok ? undefined : linhas.length ? 'Falta informar motivos' : 'Nenhum item contado'}><CheckCircle2 className="size-4" />Fechar e ajustar o estoque</button>
        </div>
      )}

      <Dialog open={confirmar != null} onOpenChange={(o) => !o && setConfirmar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmar === 'fechar' ? 'Fechar a contagem?' : 'Cancelar a contagem?'}</DialogTitle>
            <p className="text-[13px] text-text-muted">
              {confirmar === 'fechar'
                ? `${resumo.comDiferenca} ajuste(s) serão lançados no estoque, no valor líquido de ${fmtR(resumo.liquido)}. O custo médio não muda. Dá para estornar cada ajuste depois, mas não reabrir a contagem.`
                : 'Nada será ajustado e a contagem sai da lista de abertas.'}
            </p>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className={btnClass('outline')} onClick={() => setConfirmar(null)}>Voltar</button>
            <button type="button" className={btnClass(confirmar === 'cancelar' ? 'danger' : 'primary')} onClick={executar} disabled={pending}>
              {pending && <Spinner />}{confirmar === 'fechar' ? 'Fechar contagem' : 'Cancelar contagem'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Card({ rotulo, valor, dica, tom, icone }: { rotulo: string; valor: string; dica?: string; tom?: 'erro' | 'aviso'; icone?: React.ReactNode }) {
  const cor = tom === 'erro' ? 'text-err' : tom === 'aviso' ? 'text-warn' : 'text-text'
  return (
    <div className="rounded-[var(--r-lg)] bg-surface p-4 u-card">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-text-muted">{icone}{rotulo}</div>
      <div className={`num mt-2 text-[24px] font-semibold leading-none tracking-[-0.02em] ${cor}`}>{valor}</div>
      {dica && <div className="mt-1.5 text-[12px] text-text-muted">{dica}</div>}
    </div>
  )
}

function Celula({ rotulo, valor, cor = '', forte }: { rotulo: string; valor: string; cor?: string; forte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 md:block md:text-right">
      <span className="text-[11px] uppercase tracking-wide text-text-muted md:hidden">{rotulo}</span>
      <span className={`num text-[14px] ${forte ? 'font-semibold' : ''} ${cor}`}>{valor}</span>
    </div>
  )
}
