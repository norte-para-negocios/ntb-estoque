'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'
import { Money } from '@/components/ui-kit/Money'
import { Spinner } from '@/components/ui-kit/Spinner'
import { estornarRecebimento, gerarContasReceberVendas, registrarRecebimento, salvarFormaRecebimento } from '@/lib/actions/financeiro-receber'
import { paraCentavos } from '@/lib/financeiro/titulo-puro'
import { ROTULO_FORMA, type FormaRecebimento } from '@/lib/financeiro/receber-vendas-puro'
import { campo, chaveNova, dataBR, PreviaMoeda, rotulo } from './comum'

// Contas a receber das vendas (migration 380). Telas só dev: /financeiro/contas-receber e /financeiro/formas-recebimento.
type OpcaoConta = { id: number; nome: string }
const numTxt = (n: number) => String(n).replace('.', ',')

/** "Gerar agora" do período de vendas (o cron faz o mesmo de hora em hora nos últimos 7 dias). */
export function GerarReceber({ de, ate, ligada }: { de: string; ate: string; ligada: boolean }) {
  const [ini, setIni] = useState(de)
  const [fim, setFim] = useState(ate)
  const [pend, start] = useTransition()
  const router = useRouter()
  if (!ligada) return <p className="text-[13px] text-text-muted">A geração automática está desligada nesta loja (chave da loja).</p>
  return (
    <div className="flex flex-wrap items-end gap-2 text-[13px]">
      <label className={rotulo}><span>Vendas de</span><input type="date" className={campo} value={ini} max={fim} onChange={(e) => setIni(e.target.value)} /></label>
      <label className={rotulo}><span>até</span><input type="date" className={campo} value={fim} max={ate} onChange={(e) => setFim(e.target.value)} /></label>
      <button type="button" className={btnClass('outline')} disabled={pend} onClick={() => start(async () => {
        const r = await gerarContasReceberVendas(ini, fim)
        if ('error' in r) { toast.error(r.error); return }
        const partes = [r.criados && `${r.criados} novas`, r.atualizados && `${r.atualizados} atualizadas`, r.cancelados && `${r.cancelados} canceladas`].filter(Boolean)
        toast.success(partes.length ? `Contas a receber: ${partes.join(', ')}.` : 'Nada mudou: as contas já seguem as vendas.')
        if (r.divergentes) toast.warning(`${r.divergentes} conta(s) já recebida(s) com venda alterada depois. Confira.`)
        router.refresh()
      })}>{pend && <Spinner />}Gerar agora</button>
    </div>
  )
}

/** Baixa: quanto caiu na conta e quando. Vazio = o líquido previsto. */
export function BotaoReceber({ tituloId, rotuloTitulo, previsto, contaPadrao, contas, hoje }: {
  tituloId: number; rotuloTitulo: string; previsto: number; contaPadrao: number | null; contas: OpcaoConta[]; hoje: string
}) {
  const router = useRouter()
  const inicialConta = contaPadrao && contas.some((c) => c.id === contaPadrao) ? String(contaPadrao) : contas[0] ? String(contas[0].id) : ''
  const [aberto, setAberto] = useState(false)
  const [conta, setConta] = useState(inicialConta)
  const [data, setData] = useState(hoje)
  const [valor, setValor] = useState(numTxt(previsto))
  const [obs, setObs] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [pend, start] = useTransition()
  // Uma chave por abertura do diálogo: repetir o clique (rede caiu) não baixa duas vezes; a baixa feita fecha o diálogo.
  const [chave, setChave] = useState(() => chaveNova('rc'))

  const cent = valor.trim() ? paraCentavos(valor) : Math.round(previsto * 100)
  const dif = Number.isNaN(cent) ? null : (cent - Math.round(previsto * 100)) / 100

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!pend) { if (o) { setConta(inicialConta); setData(hoje); setValor(numTxt(previsto)); setObs(''); setErro(null); setChave(chaveNova('rc')) } setAberto(o) } }}>
      <DialogTrigger render={<button type="button" className="text-[13px] font-medium text-brand hover:underline">Dar baixa</button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar recebimento</DialogTitle>
          <p className="text-[13px] text-text-muted">{rotuloTitulo} · previsto <Money value={previsto} />. Só registra: confira no extrato do banco ou da maquininha.</p>
        </DialogHeader>
        <div className="space-y-3 text-[13px]">
          {contas.length === 0 && <p className="rounded-[var(--r-md)] bg-surface-2 p-2 text-warn">Cadastre uma conta corrente ativa antes. <Link href="/financeiro/contas-correntes?criar=1" className="font-medium underline">Nova conta corrente</Link></p>}
          <label className={rotulo}><span>Caiu em qual conta</span>
            <select className={campo} value={conta} onChange={(e) => setConta(e.target.value)}>
              {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={rotulo}><span>Data do recebimento</span><input type="date" className={campo} value={data} max={hoje} onChange={(e) => setData(e.target.value)} /></label>
            <label className={rotulo}><span>Valor recebido (R$)</span><input inputMode="decimal" className={campo} value={valor} onChange={(e) => setValor(e.target.value)} /><PreviaMoeda texto={valor} /></label>
          </div>
          <label className={rotulo}><span>Observação</span><input className={campo} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={300} /></label>
          {dif !== null && dif !== 0 && <p className="rounded-[var(--r-md)] bg-surface-2 p-2">Diferença para o previsto: <strong><Money value={dif} /></strong> (fica registrada).</p>}
          {erro && <p className="rounded-[var(--r-md)] bg-surface-2 p-2 font-medium text-err">{erro}</p>}
        </div>
        <DialogFooter>
          <button type="button" className={btnClass('primary')} disabled={pend || !conta || dif === null} onClick={() => {
            setErro(null)
            start(async () => {
              const r = await registrarRecebimento({ tituloId, contaId: Number(conta), dataRecebimento: data, valorRecebido: valor, observacao: obs, chave })
              if ('error' in r) { setErro(r.error); return }
              toast.success('Recebimento registrado.')
              setAberto(false)
              router.refresh()
            })
          }}>{pend && <Spinner />}Registrar recebimento</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function EstornarRecebimento({ recebimentoId }: { recebimentoId: number }) {
  const [pend, start] = useTransition()
  const router = useRouter()
  return (
    <button type="button" className="text-[13px] text-text-muted hover:underline" disabled={pend} onClick={() => {
      const motivo = window.prompt('Por que estornar este recebimento? A conta volta a ficar a receber.')
      if (motivo === null) return
      start(async () => {
        const r = await estornarRecebimento(recebimentoId, motivo)
        if ('error' in r) { toast.error(r.error); return }
        toast.success('Recebimento estornado.')
        router.refresh()
      })
    }}>{pend ? 'Estornando…' : 'Estornar'}</button>
  )
}

export type LinhaForma = {
  forma: FormaRecebimento; cadastrada: boolean; adquirente: string | null; taxa_percentual: number; taxa_fixa: number
  prazo_dias: number; dias_uteis: boolean; conta_id: number | null; observacao: string | null
}

/** Uma linha editável do cadastro de formas de recebimento. */
export function LinhaFormaRecebimento({ f, contas }: { f: LinhaForma; contas: OpcaoConta[] }) {
  const [adq, setAdq] = useState(f.adquirente ?? '')
  const [pct, setPct] = useState(f.cadastrada ? numTxt(f.taxa_percentual) : '')
  const [fixa, setFixa] = useState(f.cadastrada && f.taxa_fixa ? numTxt(f.taxa_fixa) : '')
  const [prazo, setPrazo] = useState(f.cadastrada ? String(f.prazo_dias) : '')
  const [uteis, setUteis] = useState(f.dias_uteis)
  const [conta, setConta] = useState(f.conta_id ? String(f.conta_id) : '')
  const [pend, start] = useTransition()
  const router = useRouter()
  return (
    <tr className="border-t border-[var(--border)] align-top">
      <td className="px-4 py-2">
        <span className="font-medium text-text">{ROTULO_FORMA[f.forma]}</span>
        {!f.cadastrada && <p className="text-warn">Configurar: sem cadastro, a conta sai com taxa 0 e prazo 0.</p>}
      </td>
      <td className="px-2 py-2"><input aria-label="Adquirente" className={campo} value={adq} maxLength={60} placeholder="Stone, Cielo, iFood…" onChange={(e) => setAdq(e.target.value)} /></td>
      <td className="px-2 py-2"><input aria-label="Taxa (%)" inputMode="decimal" className={`${campo} w-20`} value={pct} placeholder="0" onChange={(e) => setPct(e.target.value)} /></td>
      <td className="px-2 py-2"><input aria-label="Taxa fixa (R$)" inputMode="decimal" className={`${campo} w-20`} value={fixa} placeholder="0,00" onChange={(e) => setFixa(e.target.value)} /></td>
      <td className="px-2 py-2">
        <input aria-label="Prazo (dias)" inputMode="numeric" className={`${campo} w-16`} value={prazo} placeholder="0" onChange={(e) => setPrazo(e.target.value)} />
        <label className="mt-1 flex items-center gap-1 text-text-muted"><input type="checkbox" checked={uteis} onChange={(e) => setUteis(e.target.checked)} /> dias úteis</label>
      </td>
      <td className="px-2 py-2">
        <select aria-label="Conta de destino" className={campo} value={conta} onChange={(e) => setConta(e.target.value)}>
          <option value="">A definir</option>
          {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </td>
      <td className="px-4 py-2 text-right">
        <button type="button" className={btnClass('outline')} disabled={pend} onClick={() => start(async () => {
          const r = await salvarFormaRecebimento({ forma: f.forma, adquirente: adq, taxaPercentual: pct, taxaFixa: fixa, prazoDias: prazo, diasUteis: uteis, contaId: conta ? Number(conta) : null })
          if ('error' in r) { toast.error(r.error); return }
          toast.success(r.mudou ? 'Forma salva. As contas em aberto seguem o cadastro novo na próxima geração.' : 'Nada mudou.')
          router.refresh()
        })}>{pend && <Spinner />}Salvar</button>
      </td>
    </tr>
  )
}

export const rotuloTituloReceber = (dataVenda: string, forma: FormaRecebimento) => `Vendas de ${dataBR(dataVenda)} · ${ROTULO_FORMA[forma]}`
