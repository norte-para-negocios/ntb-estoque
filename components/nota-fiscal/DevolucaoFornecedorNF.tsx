'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { cancelarDevolucao, registrarDevolucao } from '@/lib/actions/devolucao-fornecedor'
import { rotuloSituacaoDevolucao, validarDevolucao } from '@/lib/compras/devolucao-puro'
import type { DevolucoesDaNota } from '@/lib/compras/devolucao-loader'

const q = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const lerNum = (t: string) => {
  const s = t.trim()
  if (!s) return 0
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
}
const th = 'whitespace-nowrap px-2.5 py-2 text-left text-[12px] font-semibold text-text-muted'

// Seção da nota (estoque próprio): devolver itens ao fornecedor. Sai do estoque na hora (ao custo da entrada) e fica
// "Devolução a emitir": a NF-e de devolução ainda não é emitida pelo Norte Estoque.
export function DevolucaoFornecedorNF({ compraId, dados, pode }: { compraId: number; dados: DevolucoesDaNota; pode: boolean }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [qtd, setQtd] = useState<Record<number, string>>({})
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [pend, start] = useTransition()
  const [chave] = useState(() => `dev-${compraId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  const temDisponivel = dados.itens.some((i) => i.disponivel > 0)

  const escolhidos = useMemo(() => dados.itens.map((i) => ({ compraItemId: i.compraItemId, quantidade: lerNum(qtd[i.compraItemId] ?? '') }))
    .filter((i) => Number.isFinite(i.quantidade) && i.quantidade !== 0), [dados.itens, qtd])
  const invalido = validarDevolucao(escolhidos, new Map(dados.itens.map((i) => [i.compraItemId, i.disponivel])), motivo)
  const valor = escolhidos.reduce((s, e) => s + e.quantidade * (dados.itens.find((i) => i.compraItemId === e.compraItemId)?.custoUnitario ?? 0), 0)

  function registrar() {
    setErro(null)
    start(async () => {
      const r = await registrarDevolucao({ compraId, itens: escolhidos, motivo, chave })
      if ('error' in r) { setErro(r.error); return }
      toast.success(`Devolução nº ${r.numero} registrada`, { description: 'Os itens saíram do estoque. A NF-e de devolução ainda precisa ser emitida.' })
      setAberto(false); setQtd({}); setMotivo('')
      router.refresh()
    })
  }

  if (!dados.devolucoes.length && !temDisponivel) return null
  return (
    <section className="space-y-3 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-text">Devolução ao fornecedor</h2>
        {pode && temDisponivel && (
          <Dialog open={aberto} onOpenChange={(o) => { if (!pend) { setAberto(o); setErro(null) } }}>
            <DialogTrigger render={<button type="button" className={btnClass('outline')}>Devolver itens</button>} />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Devolver itens ao fornecedor</DialogTitle>
                <p className="text-[13px] text-text-muted">Os itens saem do estoque agora, pelo custo da entrada. A NF-e de devolução não é emitida por aqui: a devolução fica &quot;a emitir&quot;.</p>
              </DialogHeader>
              <div className="max-h-[50vh] space-y-3 overflow-auto text-[13px]">
                <table className="w-full">
                  <thead><tr><th className={th}>Item</th><th className={`${th} text-right`}>Pode devolver</th><th className={`${th} text-right`}>Devolver</th></tr></thead>
                  <tbody>
                    {dados.itens.map((i) => (
                      <tr key={i.compraItemId} className="border-t border-[var(--border)]">
                        <td className="px-2.5 py-1.5">{i.linha}. {i.descricao}</td>
                        <td className="num px-2.5 py-1.5 text-right">{q(i.disponivel)} {i.unidade}</td>
                        <td className="px-2.5 py-1.5 text-right">
                          <input inputMode="decimal" disabled={i.disponivel <= 0} aria-label={`Quantidade a devolver do item ${i.linha}`}
                            className="w-24 rounded-[var(--r-md)] bg-surface-2 px-2 py-1 text-right" value={qtd[i.compraItemId] ?? ''}
                            onChange={(e) => setQtd((s) => ({ ...s, [i.compraItemId]: e.target.value }))} placeholder="0" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <label className="block space-y-1">
                  <span>Motivo da devolução</span>
                  <input className="w-full rounded-[var(--r-md)] bg-surface-2 px-3 py-2" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: produto vencido, avariado, veio a mais" />
                </label>
                <p className="text-text-muted">Valor que sai do estoque: <b className="num text-text">{brl(valor)}</b></p>
                {escolhidos.length > 0 && invalido && <p className="text-warn">{invalido}</p>}
                {erro && <p className="rounded-[var(--r-md)] bg-surface-2 p-2 font-medium text-err">{erro}</p>}
              </div>
              <DialogFooter>
                <button type="button" className={btnClass('primary')} disabled={pend || !!invalido} onClick={registrar}>{pend && <Spinner />}Registrar devolução</button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      {dados.devolucoes.length === 0 && <p className="text-[13px] text-text-muted">Nenhuma devolução desta nota.</p>}
      <ul className="divide-y divide-[var(--border)]">
        {dados.devolucoes.map((d) => <LinhaDevolucao key={d.id} d={d} pode={pode} />)}
      </ul>
    </section>
  )
}

function LinhaDevolucao({ d, pode }: { d: DevolucoesDaNota['devolucoes'][number]; pode: boolean }) {
  const router = useRouter()
  const [pend, start] = useTransition()
  const [motivo, setMotivo] = useState('')
  const [abrir, setAbrir] = useState(false)
  const cor = d.situacao === 'a_emitir' ? 'text-warn' : d.situacao === 'cancelada' ? 'text-text-muted' : 'text-ok'
  return (
    <li className="space-y-1 py-2 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-text">Nº {d.numero} · {d.data.split('-').reverse().join('/')} · <span className={cor}>{rotuloSituacaoDevolucao(d.situacao)}</span></span>
        <span className="num text-text-muted">custo {brl(d.valorCusto)} · valor na nota {brl(d.valorFiscal)}</span>
      </div>
      <p className="text-text-muted">Motivo: {d.motivo}{d.criadoPor ? ` · por ${d.criadoPor}` : ''}</p>
      <ul className="pl-3 text-text-muted">
        {d.itens.map((i) => <li key={i.linha}>{i.linha}. {i.descricao}: {q(i.quantidade)} a {brl(i.custoUnitario)}{i.cfop ? ` · CFOP ${i.cfop}` : ''}</li>)}
      </ul>
      {d.situacao === 'cancelada' && d.motivoCancelamento && <p className="text-text-muted">Cancelada{d.canceladoPor ? ` por ${d.canceladoPor}` : ''}: {d.motivoCancelamento}</p>}
      {pode && d.situacao === 'a_emitir' && (
        abrir ? (
          <div className="flex flex-wrap items-center gap-2">
            <input className="min-w-[220px] flex-1 rounded-[var(--r-md)] bg-surface-2 px-3 py-1.5" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo do cancelamento" />
            <button type="button" className={btnClass('outline')} disabled={pend || motivo.trim().length < 3} onClick={() => start(async () => {
              const r = await cancelarDevolucao(d.id, motivo)
              if ('error' in r) toast.error('Não foi possível cancelar', { description: r.error })
              else { toast.success('Devolução cancelada: os itens voltaram ao estoque'); router.refresh() }
            })}>{pend && <Spinner />}Confirmar cancelamento</button>
          </div>
        ) : <button type="button" className="text-[12px] font-medium text-brand hover:underline" onClick={() => setAbrir(true)}>Cancelar devolução</button>
      )}
    </li>
  )
}
