'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDownToLine, ArrowLeftRight, BellRing, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { btnClass, btnLinhaClass, RotuloAcao, type BtnVariant } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { ajusteManual, definirMinimo, entradaManual, transferirEntreLocais } from '@/lib/actions/estoque-proprio'

export type ProdutoAcao = { codigoProduto: number; codigo: string; descricao: string; unidade: string }
export type LocalAcao = { codigoLocal: number; descricao: string }
export type SaldoAcao = { codigoLocal: number; saldo: number; minimo: number | null }

const campo =
  'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-sm text-text outline-none max-sm:text-base focus:ring-2 focus:ring-brand/40'

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

function CampoComUnidade({ unidade, children }: { unidade: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-text-muted">{unidade}</span>
    </div>
  )
}

function SelectLocal({ locais, value, onChange, saldos, unidade, id }: {
  locais: LocalAcao[]; value: number | ''; onChange: (v: number) => void; saldos: SaldoAcao[]; unidade: string; id?: string
}) {
  return (
    <select id={id} className={campo} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      <option value="" disabled>Escolha o local</option>
      {locais.map((l) => {
        const s = saldos.find((x) => x.codigoLocal === l.codigoLocal)?.saldo ?? 0
        return <option key={l.codigoLocal} value={l.codigoLocal}>{l.descricao} · saldo {fmt(s)} {unidade}</option>
      })}
    </select>
  )
}

function Moldura({
  titulo, produto, gatilho, children, rodape, open, onOpenChange,
}: {
  titulo: string; produto: ProdutoAcao; gatilho: React.ReactNode; children: React.ReactNode; rodape: React.ReactNode
  open: boolean; onOpenChange: (o: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={gatilho as React.ReactElement} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <p className="text-[13px] text-text-muted">
            {produto.descricao} <span className="num">· {produto.codigo}</span> <span>· {produto.unidade}</span>
          </p>
        </DialogHeader>
        <div className="space-y-4">{children}</div>
        <DialogFooter>{rodape}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type Gatilho = { variante?: BtnVariant; compacto?: boolean }

function botao(rotulo: string, icone: React.ReactNode, { variante = 'outline', compacto }: Gatilho) {
  return compacto ? (
    <button type="button" aria-label={rotulo} title={rotulo} className={btnLinhaClass(variante)}>
      {icone}<RotuloAcao>{rotulo}</RotuloAcao>
    </button>
  ) : (
    <button type="button" className={btnClass(variante)}>{icone}{rotulo}</button>
  )
}

function useEnvio(onDone: () => void) {
  const [pending, start] = useTransition()
  const router = useRouter()
  function enviar(fn: () => Promise<{ error: string } | { ok: true; saldo?: number; negativo?: boolean; aviso?: string }>, sucesso: string) {
    start(async () => {
      const r = await fn()
      if ('error' in r) { toast.error('Não foi possível salvar', { description: r.error }); return }
      toast.success(sucesso, { description: r.aviso ?? (r.negativo ? 'Atenção: o saldo ficou negativo.' : undefined) })
      onDone()
      router.refresh()
    })
  }
  return { pending, enviar }
}

export function ModalEntrada({ produto, locais, saldos, localInicial, ...g }: { produto: ProdutoAcao; locais: LocalAcao[]; saldos: SaldoAcao[]; localInicial?: number } & Gatilho) {
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<number | ''>(localInicial ?? (locais.length === 1 ? locais[0].codigoLocal : ''))
  const [qtd, setQtd] = useState('')
  const [custo, setCusto] = useState('')
  const [obs, setObs] = useState('')
  const { pending, enviar } = useEnvio(() => { setOpen(false); setQtd(''); setCusto(''); setObs('') })

  function salvar() {
    if (local === '') return toast.error('Escolha o local')
    enviar(() => entradaManual({ codigoProduto: produto.codigoProduto, codigoLocal: local, quantidade: qtd, custo, obs }), 'Entrada registrada')
  }
  return (
    <Moldura open={open} onOpenChange={setOpen} titulo="Entrada de estoque" produto={produto}
      gatilho={botao('Entrada', <ArrowDownToLine className="size-4" />, { variante: 'primary', ...g })}
      rodape={<button type="button" className={btnClass('primary')} onClick={salvar} disabled={pending}>{pending && <Spinner />}Registrar entrada</button>}>
      <div className="space-y-2"><Label>Local</Label><SelectLocal locais={locais} value={local} onChange={setLocal} saldos={saldos} unidade={produto.unidade} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2"><Label>Quantidade</Label>
          <CampoComUnidade unidade={produto.unidade}><input inputMode="decimal" className={`${campo} pr-12`} value={qtd} onChange={(e) => setQtd(e.target.value)} placeholder="0" /></CampoComUnidade></div>
        <div className="space-y-2"><Label>Custo unitário (opcional)</Label>
          <CampoComUnidade unidade={`R$/${produto.unidade}`}><input inputMode="decimal" className={`${campo} pr-16`} value={custo} onChange={(e) => setCusto(e.target.value)} placeholder="0,00" /></CampoComUnidade></div>
      </div>
      <p className="text-[12px] text-text-muted">Sem custo, a entrada não altera o custo médio do produto.</p>
      <div className="space-y-2"><Label>Observação (opcional)</Label><input className={campo} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: nota 1234, compra do mercado" /></div>
    </Moldura>
  )
}

export function ModalAjuste({ produto, locais, saldos, localInicial, ...g }: { produto: ProdutoAcao; locais: LocalAcao[]; saldos: SaldoAcao[]; localInicial?: number } & Gatilho) {
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<number | ''>(localInicial ?? (locais.length === 1 ? locais[0].codigoLocal : ''))
  const [modo, setModo] = useState<'contagem' | 'diferenca'>('contagem')
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const { pending, enviar } = useEnvio(() => { setOpen(false); setValor(''); setMotivo('') })
  const atual = saldos.find((s) => s.codigoLocal === local)?.saldo ?? 0
  const n = Number(valor.replace(',', '.'))
  const previa = valor !== '' && Number.isFinite(n) ? (modo === 'contagem' ? n - atual : n) : null

  function salvar() {
    if (local === '') return toast.error('Escolha o local')
    enviar(() => ajusteManual({
      codigoProduto: produto.codigoProduto, codigoLocal: local, motivo,
      ...(modo === 'contagem' ? { novoSaldo: valor } : { diferenca: valor }),
    }), 'Ajuste registrado')
  }
  return (
    <Moldura open={open} onOpenChange={setOpen} titulo="Ajuste de estoque" produto={produto}
      gatilho={botao('Ajuste', <SlidersHorizontal className="size-4" />, g)}
      rodape={<button type="button" className={btnClass('primary')} onClick={salvar} disabled={pending}>{pending && <Spinner />}Registrar ajuste</button>}>
      <div className="space-y-2"><Label>Local</Label><SelectLocal locais={locais} value={local} onChange={setLocal} saldos={saldos} unidade={produto.unidade} /></div>
      <div className="inline-flex rounded-[10px] bg-surface-2 p-0.5 text-[13px] font-medium">
        {(['contagem', 'diferenca'] as const).map((m) => (
          <button key={m} type="button" onClick={() => setModo(m)}
            className={`rounded-[8px] px-3 py-1 u-motion ${modo === m ? 'bg-surface text-text shadow-[var(--shadow-sm)]' : 'text-text-muted'}`}>
            {m === 'contagem' ? 'Saldo contado' : 'Diferença'}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        <Label>{modo === 'contagem' ? 'Quanto tem de verdade' : 'Quanto sobra (+) ou falta (−)'}</Label>
        <CampoComUnidade unidade={produto.unidade}><input inputMode="decimal" className={`${campo} pr-12`} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0" /></CampoComUnidade>
        {previa != null && local !== '' && (
          <p className="text-[12px] text-text-muted num">
            Saldo atual {fmt(atual)} {produto.unidade} → {fmt(atual + previa)} {produto.unidade} ({previa >= 0 ? '+' : ''}{fmt(previa)})
          </p>
        )}
      </div>
      <div className="space-y-2"><Label>Motivo</Label><input className={campo} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: contagem do mês, quebra, perda" /></div>
    </Moldura>
  )
}

export function ModalTransferencia({ produto, locais, saldos, localInicial, ...g }: { produto: ProdutoAcao; locais: LocalAcao[]; saldos: SaldoAcao[]; localInicial?: number } & Gatilho) {
  const [open, setOpen] = useState(false)
  const [de, setDe] = useState<number | ''>(localInicial ?? '')
  const [para, setPara] = useState<number | ''>('')
  const [qtd, setQtd] = useState('')
  const [obs, setObs] = useState('')
  const { pending, enviar } = useEnvio(() => { setOpen(false); setQtd(''); setObs('') })

  function salvar() {
    if (de === '' || para === '') return toast.error('Escolha origem e destino')
    enviar(() => transferirEntreLocais({ codigoProduto: produto.codigoProduto, de, para, quantidade: qtd, obs }), 'Transferência registrada')
  }
  return (
    <Moldura open={open} onOpenChange={setOpen} titulo="Transferir entre locais" produto={produto}
      gatilho={botao('Transferir', <ArrowLeftRight className="size-4" />, g)}
      rodape={<button type="button" className={btnClass('primary')} onClick={salvar} disabled={pending}>{pending && <Spinner />}Transferir</button>}>
      <div className="space-y-2"><Label>De</Label><SelectLocal locais={locais} value={de} onChange={setDe} saldos={saldos} unidade={produto.unidade} /></div>
      <div className="space-y-2"><Label>Para</Label><SelectLocal locais={locais.filter((l) => l.codigoLocal !== de)} value={para} onChange={setPara} saldos={saldos} unidade={produto.unidade} /></div>
      <div className="space-y-2"><Label>Quantidade</Label>
        <CampoComUnidade unidade={produto.unidade}><input inputMode="decimal" className={`${campo} pr-12`} value={qtd} onChange={(e) => setQtd(e.target.value)} placeholder="0" /></CampoComUnidade></div>
      <p className="text-[12px] text-text-muted">A transferência não muda o custo médio. Se a origem não tiver saldo, ela fica negativa e o gerente é avisado.</p>
      <div className="space-y-2"><Label>Observação (opcional)</Label><input className={campo} value={obs} onChange={(e) => setObs(e.target.value)} /></div>
    </Moldura>
  )
}

export function ModalMinimo({ produto, locais, saldos, localInicial, ...g }: { produto: ProdutoAcao; locais: LocalAcao[]; saldos: SaldoAcao[]; localInicial?: number } & Gatilho) {
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<number | ''>(localInicial ?? (locais.length === 1 ? locais[0].codigoLocal : ''))
  const [minimo, setMinimo] = useState('')
  const { pending, enviar } = useEnvio(() => { setOpen(false); setMinimo('') })
  function salvar() {
    if (local === '') return toast.error('Escolha o local')
    enviar(() => definirMinimo({ codigoProduto: produto.codigoProduto, codigoLocal: local, minimo }), 'Mínimo salvo')
  }
  return (
    <Moldura open={open} onOpenChange={setOpen} titulo="Estoque mínimo" produto={produto}
      gatilho={botao('Mínimo', <BellRing className="size-4" />, g)}
      rodape={<button type="button" className={btnClass('primary')} onClick={salvar} disabled={pending}>{pending && <Spinner />}Salvar mínimo</button>}>
      <div className="space-y-2"><Label>Local</Label><SelectLocal locais={locais} value={local} onChange={(v) => { setLocal(v); setMinimo(String(saldos.find((s) => s.codigoLocal === v)?.minimo ?? '')) }} saldos={saldos} unidade={produto.unidade} /></div>
      <div className="space-y-2"><Label>Avisar quando ficar abaixo de</Label>
        <CampoComUnidade unidade={produto.unidade}><input inputMode="decimal" className={`${campo} pr-12`} value={minimo} onChange={(e) => setMinimo(e.target.value)} placeholder="Deixe vazio para não avisar" /></CampoComUnidade></div>
    </Moldura>
  )
}

/** As quatro ações de um produto, na ordem de uso. */
export function AcoesProduto(props: { produto: ProdutoAcao; locais: LocalAcao[]; saldos: SaldoAcao[]; localInicial?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ModalEntrada {...props} />
      <ModalAjuste {...props} />
      <ModalTransferencia {...props} />
      <ModalMinimo {...props} />
    </div>
  )
}
