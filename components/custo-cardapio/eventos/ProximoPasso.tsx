'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, ClipboardCheck, Copy, ExternalLink, PackageMinus, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'
import { darBaixaEvento, definirStatusEvento, finalizarEvento, marcarConsumoLancado, reabrirEvento } from '@/lib/actions/cozinha-eventos'
import { ETAPAS_EVENTO, quantidadeTexto, type LinhaConsumo, type ProximoPasso as Passo } from '@/lib/custo-cardapio/eventos-puro'
import { lerPreco } from '@/lib/custo-cardapio/cardapios-puro'

type Local = { codigo: number; descricao: string }

const fmt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Bahia' }) : '')

// Etapas do evento + o único passo que importa agora, com finalizar (consumo real) e baixa no estoque.
export function ProximoPasso({ eventoId, passo, modo, consumo, finalizadoEm, finalizadoPor, baixaRef, locais, localPadrao, textoConsumo }: {
  eventoId: number
  passo: Passo
  modo: 'omie' | 'proprio'
  consumo: LinhaConsumo[]
  finalizadoEm: string | null
  finalizadoPor: string | null
  baixaRef: string | null
  locais: Local[]
  localPadrao: number | null
  textoConsumo: string
}) {
  const router = useRouter()
  const [pendente, start] = useTransition()
  const [dlg, setDlg] = useState<'finalizar' | 'baixa' | null>(null)
  const finalizado = !!finalizadoEm

  const rodar = (fn: () => Promise<{ ok: true } | { error: string }>, sucesso: string) =>
    start(async () => {
      const x = await fn()
      if ('error' in x) { toast.error(x.error); return }
      toast.success(sucesso)
      router.refresh()
    })

  const copiar = async () => {
    try { await navigator.clipboard.writeText(textoConsumo); toast.success('Lista copiada.') } catch { toast.error('Não deu para copiar.') }
  }

  const acaoPrincipal = (() => {
    switch (passo.acao) {
      case 'pratos': return <a href="#pratos" className={btnClass('primary')}>Escolher pratos <ArrowRight className="size-4" /></a>
      case 'preco': return <a href="#preco" className={btnClass('primary')}>Definir preço <ArrowRight className="size-4" /></a>
      case 'confirmar':
        return <button type="button" disabled={pendente} onClick={() => rodar(() => definirStatusEvento(eventoId, 'confirmado'), 'Evento confirmado')} className={btnClass('primary')}><Check className="size-4" /> Confirmar evento</button>
      case 'conflito':
      case 'comprar': return <a href="#compras" className={btnClass('primary')}>Ver o que comprar <ArrowRight className="size-4" /></a>
      case 'produzir': return <a href="#producao" className={btnClass('primary')}>Ver lista de produção <ArrowRight className="size-4" /></a>
      case 'finalizar': return <button type="button" onClick={() => setDlg('finalizar')} className={btnClass('primary')}><ClipboardCheck className="size-4" /> Finalizar evento</button>
      case 'baixa': return <button type="button" onClick={() => setDlg('baixa')} disabled={!locais.length} className={btnClass('primary')}><PackageMinus className="size-4" /> Dar baixa no estoque</button>
      case 'lancar_erp':
        return (
          <>
            <button type="button" onClick={copiar} className={btnClass('primary')}><Copy className="size-4" /> Copiar lista</button>
            <Link href="/estoque/ajustes" className={btnClass('outline')}><ExternalLink className="size-4" /> Abrir ajustes do estoque</Link>
            <button type="button" disabled={pendente} onClick={() => {
              if (window.confirm('Confirma que o consumo deste evento já foi lançado no estoque? Depois disso o evento não pode ser reaberto.')) rodar(() => marcarConsumoLancado(eventoId), 'Marcado como lançado')
            }} className={btnClass('outline')}><Check className="size-4" /> Já lancei</button>
          </>
        )
      default: return null
    }
  })()

  return (
    <section className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5">
      {passo.etapa >= 0 && (
        <ol className="mb-4 grid grid-cols-4 gap-1" aria-label="Etapas do evento">
          {ETAPAS_EVENTO.map((nome, i) => {
            const feita = i < passo.etapa || (passo.concluido && i === passo.etapa)
            const atual = i === passo.etapa && !passo.concluido
            return (
              <li key={nome} aria-current={atual ? 'step' : undefined} className="min-w-0">
                <div className={`h-1.5 rounded-full ${feita ? 'bg-brand-fill' : atual ? 'bg-brand/40' : 'bg-surface-2'}`} />
                <p className={`mt-1.5 flex items-center gap-1 truncate text-[12px] ${atual ? 'font-semibold text-text' : feita ? 'text-text' : 'text-text-muted'}`}>
                  {feita && <Check className="size-3.5 shrink-0 text-brand" />}{nome}
                </p>
              </li>
            )
          })}
        </ol>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-text-muted">{passo.concluido || passo.acao === 'cancelado' ? 'Situação' : 'Próximo passo'}</p>
          <p className="text-[19px] font-semibold tracking-[-0.01em]">{passo.titulo}</p>
          <p className="text-[13px] text-text-muted">{passo.texto}</p>
          {finalizado && (
            <p className="mt-1 text-[12px] text-text-muted">
              Finalizado em {dataHora(finalizadoEm)}{finalizadoPor ? ` por ${finalizadoPor}` : ''}.{baixaRef?.startsWith('EV-') ? ' Baixa feita no estoque.' : baixaRef ? ' Consumo marcado como lançado no ERP.' : ''}
            </p>
          )}
          {passo.acao === 'baixa' && !locais.length && <p className="mt-1 text-[12px] text-warn">Esta loja não tem local de estoque ativo. Cadastre um em Locais de estoque.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {acaoPrincipal}
          {finalizado && !baixaRef && (
            <button type="button" disabled={pendente} onClick={() => {
              if (window.confirm('Reabrir o evento? O consumo real informado é descartado.')) rodar(() => reabrirEvento(eventoId), 'Evento reaberto')
            }} className={btnClass('ghost')}><RotateCcw className="size-4" /> Reabrir</button>
          )}
        </div>
      </div>

      {finalizado && consumo.length > 0 && (
        <details className="mt-4 border-t border-border/60 pt-3" open={passo.acao === 'lancar_erp'}>
          <summary className="cursor-pointer text-[13px] font-semibold">Consumo real ({consumo.length} insumo{consumo.length === 1 ? '' : 's'})</summary>
          {passo.acao === 'lancar_erp' && (
            <p className="mt-2 text-[12px] text-text-muted">O Norte Cozinha não escreve no Omie. Lance cada linha como saída na tela de ajustes do estoque, no local de onde a cozinha consome, e depois toque em &ldquo;Já lancei&rdquo;.</p>
          )}
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[480px] text-[13px]">
              <thead><tr className="text-left text-text-muted [&_th]:pb-1 [&_th]:font-semibold"><th>Insumo</th><th className="text-right">Previsto</th><th className="text-right">Usado</th><th className="text-right">Diferença</th></tr></thead>
              <tbody>
                {consumo.map((l) => {
                  const d = l.usado - l.previsto
                  return (
                    <tr key={l.codigo} className="border-t border-border/60 [&_td]:py-1.5">
                      <td className="max-w-[260px] truncate pr-3"><span className="text-text-muted">{l.codigoTexto}</span> {l.descricao}</td>
                      <td className="num whitespace-nowrap text-right text-text-muted">{quantidadeTexto(l.previsto, l.unidade)}</td>
                      <td className="num whitespace-nowrap text-right font-semibold">{quantidadeTexto(l.usado, l.unidade)}</td>
                      <td className={`num whitespace-nowrap text-right ${Math.abs(d) < 1e-6 ? 'text-text-muted' : d > 0 ? 'text-err' : 'text-ok'}`}>{Math.abs(d) < 1e-6 ? '' : `${d > 0 ? '+' : '−'}${quantidadeTexto(Math.abs(d), l.unidade)}`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {dlg === 'finalizar' && <DialogFinalizar eventoId={eventoId} consumo={consumo} modo={modo} onFechar={() => setDlg(null)} />}
      {dlg === 'baixa' && <DialogBaixa eventoId={eventoId} consumo={consumo} locais={locais} localPadrao={localPadrao} onFechar={() => setDlg(null)} />}
    </section>
  )
}

function DialogFinalizar({ eventoId, consumo, modo, onFechar }: { eventoId: number; consumo: LinhaConsumo[]; modo: 'omie' | 'proprio'; onFechar: () => void }) {
  const router = useRouter()
  const [pendente, start] = useTransition()
  const [usado, setUsado] = useState<Record<number, string>>(() => Object.fromEntries(consumo.map((l) => [l.codigo, fmt(l.previsto)])))
  const ler = (c: number) => { const v = lerPreco(usado[c] ?? ''); return v == null ? 0 : v }
  const invalidos = consumo.filter((l) => { const v = lerPreco(usado[l.codigo] ?? ''); return v != null && (Number.isNaN(v) || v < 0) })

  const salvar = () => {
    if (invalidos.length) { toast.error(`Quantidade inválida em ${invalidos[0].descricao}.`); return }
    start(async () => {
      const r = await finalizarEvento(eventoId, consumo.map((l) => ({ codigo: l.codigo, quantidade: ler(l.codigo) })))
      if ('error' in r) { toast.error(r.error); return }
      toast.success('Evento finalizado')
      onFechar()
      router.refresh()
    })
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar() }}>
      <DialogContent className="bg-surface sm:max-w-2xl">
        <DialogTitle>Quanto saiu do estoque?</DialogTitle>
        <DialogDescription>
          Comece pelo previsto (já com a folga) e corrija o que foi diferente. {modo === 'proprio' ? 'Depois você dá baixa no estoque com esses números.' : 'Depois você lança esses números no estoque do Omie.'}
        </DialogDescription>
        <div className="flex justify-end">
          <button type="button" className="text-[13px] font-semibold text-brand hover:underline" onClick={() => setUsado(Object.fromEntries(consumo.map((l) => [l.codigo, fmt(l.previsto)])))}>Usei tudo como planejado</button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-surface"><tr className="text-left text-text-muted [&_th]:pb-2 [&_th]:font-semibold"><th>Insumo</th><th className="text-right">Previsto</th><th className="w-[140px] text-right">Usado de verdade</th></tr></thead>
            <tbody>
              {consumo.map((l) => {
                const v = lerPreco(usado[l.codigo] ?? '')
                const ruim = v != null && (Number.isNaN(v) || v < 0)
                return (
                  <tr key={l.codigo} className="border-t border-border/60 [&_td]:py-1.5">
                    <td className="pr-3"><span className="block truncate">{l.descricao}</span></td>
                    <td className="num whitespace-nowrap text-right text-text-muted">{quantidadeTexto(l.previsto, l.unidade)}</td>
                    <td className="text-right">
                      <label className="inline-flex items-center gap-1.5">
                        <span className="sr-only">Usado de {l.descricao}</span>
                        <input inputMode="decimal" value={usado[l.codigo] ?? ''} onChange={(e) => setUsado((s) => ({ ...s, [l.codigo]: e.target.value }))}
                          className={`num h-9 w-24 rounded-[var(--r-md)] bg-surface-2 px-2.5 text-right text-[14px] outline-none focus:ring-2 focus:ring-brand/40 ${ruim ? 'ring-2 ring-err/50' : ''}`} />
                        <span className="w-6 text-left text-[12px] text-text-muted">{(l.unidade ?? '').toLowerCase()}</span>
                      </label>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-text-muted">Vazio conta como zero. Finalizar não mexe no estoque ainda; enquanto não houver baixa dá para reabrir.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnClass('outline')} onClick={onFechar}>Cancelar</button>
          <button type="button" disabled={pendente} onClick={salvar} className={btnClass('primary')}>{pendente ? 'Salvando…' : 'Finalizar evento'}</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DialogBaixa({ eventoId, consumo, locais, localPadrao, onFechar }: { eventoId: number; consumo: LinhaConsumo[]; locais: Local[]; localPadrao: number | null; onFechar: () => void }) {
  const router = useRouter()
  const [pendente, start] = useTransition()
  const [local, setLocal] = useState<number>(localPadrao ?? locais[0]?.codigo ?? 0)
  const saem = consumo.filter((l) => l.usado > 0)

  const confirmar = () => start(async () => {
    const r = await darBaixaEvento(eventoId, local)
    if ('error' in r) { toast.error(r.error); router.refresh(); return }
    toast.success(`Baixa feita: ${r.itens} insumo${r.itens === 1 ? '' : 's'} saíram do estoque.`)
    onFechar()
    router.refresh()
  })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar() }}>
      <DialogContent className="bg-surface sm:max-w-lg">
        <DialogTitle>Dar baixa no estoque</DialogTitle>
        <DialogDescription>Lança uma saída por insumo com o consumo real. Não dá para desfazer por aqui (só estornando em Movimentações).</DialogDescription>
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium">Sai do local</span>
          <select value={local} onChange={(e) => setLocal(Number(e.target.value))} className="h-10 w-full rounded-[var(--r-md)] bg-surface-2 px-3 text-[15px] outline-none focus:ring-2 focus:ring-brand/40">
            {locais.map((l) => <option key={l.codigo} value={l.codigo}>{l.descricao}{l.codigo === localPadrao ? ' (cozinha)' : ''}</option>)}
          </select>
        </label>
        <ul className="max-h-[40vh] divide-y divide-border/60 overflow-y-auto text-[13px]">
          {saem.map((l) => (
            <li key={l.codigo} className="flex justify-between gap-3 py-1.5"><span className="min-w-0 truncate">{l.descricao}</span><span className="num shrink-0 font-semibold">− {quantidadeTexto(l.usado, l.unidade)}</span></li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnClass('outline')} onClick={onFechar}>Cancelar</button>
          <button type="button" disabled={pendente || !local || !saem.length} onClick={confirmar} className={btnClass('primary')}>{pendente ? 'Lançando…' : `Dar baixa em ${saem.length} insumo${saem.length === 1 ? '' : 's'}`}</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
