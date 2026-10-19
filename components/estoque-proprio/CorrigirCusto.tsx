'use client'

// Corrigir o custo de um ajuste no Omie ("nosso Omie" Fase 4): prévia (quantidade, custo atual, custo novo,
// impacto), confirmação explícita e, se o mês já foi enviado à contabilidade, uma segunda confirmação.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { impactoCorrecaoCusto, validarCustoNovo } from '@/lib/estoque/escrita-omie-puro'
import { situacaoDaData } from '@/lib/estoque/periodo-fechado-puro'
import { corrigirCustoAjuste, relancarCorrecaoCusto } from '@/lib/actions/estoque-omie'

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 })
const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

export function CorrigirCusto({ movimentoId, tipo, quantidade, custoAtual, dataISO, produto, unidade, hoje, fechadoAte, mesesFechados = [], simulado }: {
  movimentoId: number; tipo: 'ENT' | 'SAI'; quantidade: number; custoAtual: number; dataISO: string; produto: string; unidade: string
  hoje: string; fechadoAte: string | null; mesesFechados?: string[]; simulado: boolean
}) {
  const [open, setOpen] = useState(false)
  const [txt, setTxt] = useState('')
  const [ciente, setCiente] = useState(false)
  const [cienteMes, setCienteMes] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()

  // "12,50" e "1.234,50" (vírgula decimal) ou "12.5" (ponto decimal, sem vírgula).
  const t = txt.trim()
  const novo = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  const invalido = txt ? validarCustoNovo(novo, custoAtual) : 'Informe o custo novo.'
  const imp = !invalido ? impactoCorrecaoCusto({ tipo, quantidade, custoAtual, custoNovo: novo }) : null
  // Fase F: mês com fechamento formal trava; mês antigo (o aviso de sempre) pede a 2ª confirmação.
  const situacao = situacaoDaData(dataISO, hoje, mesesFechados, fechadoAte)
  const travado = situacao === 'fechado'
  const fechado = situacao === 'antigo'
  const mes = `${dataISO.slice(5, 7)}/${dataISO.slice(0, 4)}`

  function salvar() {
    setErro(null)
    start(async () => {
      const r = await corrigirCustoAjuste({ movimentoId, custoNovo: novo, custoAtualVisto: custoAtual, confirmarMesFechado: fechado && cienteMes })
      if ('error' in r) {
        setErro(r.error)
        if (r.pendente) router.refresh()
        return
      }
      toast.success(r.aviso)
      setOpen(false); setTxt(''); setCiente(false); setCienteMes(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!pending) { setOpen(o); setErro(null) } }}>
      <DialogTrigger render={<button type="button" className="mt-0.5 text-[11px] font-medium text-brand hover:underline">Corrigir custo</button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Corrigir o custo do ajuste</DialogTitle>
          <p className="text-[13px] text-text-muted">{produto} · {tipo === 'ENT' ? 'entrada' : 'saída'} de {qtd(Math.abs(quantidade))} {unidade} em {dataISO.split('-').reverse().join('/')}</p>
        </DialogHeader>
        <div className="space-y-3 text-[13px]">
          <label className="block space-y-1">
            <span>Custo unitário novo (R$ por {unidade})</span>
            <input inputMode="decimal" autoFocus className="w-full rounded-[var(--r-md)] bg-surface-2 px-3 py-2 text-sm" value={txt} onChange={(e) => setTxt(e.target.value)} placeholder={String(custoAtual).replace('.', ',')} />
          </label>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-[var(--r-md)] bg-surface-2 p-3">
            <dt className="text-text-muted">Quantidade</dt><dd className="num text-right">{qtd(Math.abs(quantidade))} {unidade}</dd>
            <dt className="text-text-muted">Custo atual</dt><dd className="num text-right">{brl(custoAtual)}</dd>
            <dt className="text-text-muted">Custo novo</dt><dd className="num text-right">{imp ? brl(novo) : '-'}</dd>
            <dt className="text-text-muted">Valor do lançamento</dt><dd className="num text-right">{imp ? `${brl(imp.valorAtual)} → ${brl(imp.valorNovo)}` : '-'}</dd>
            <dt className="text-text-muted">Efeito no valor do estoque</dt>
            <dd className={`num text-right font-semibold ${imp && imp.efeitoNoEstoque < 0 ? 'text-err' : ''}`}>{imp ? `${imp.efeitoNoEstoque >= 0 ? '+' : ''}${brl(imp.efeitoNoEstoque)}` : '-'}</dd>
          </dl>
          {txt && invalido && <p className="text-warn">{invalido}</p>}
          <p className="text-[12px] text-text-muted">Como o Omie não altera o custo de um ajuste, o ajuste é <b>excluído e lançado de novo</b> (mesmo produto, local, quantidade, data e tipo) com o custo novo. O Omie recalcula o custo médio dos movimentos seguintes.{simulado ? ' Loja de teste: nada é enviado ao Omie (simulado).' : ''}</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={ciente} onChange={(e) => setCiente(e.target.checked)} />
            Confirmo excluir este ajuste no Omie e relançar com o custo novo.
          </label>
          {travado && (
            <p className="rounded-[var(--r-md)] bg-surface-2 p-2 font-medium text-err">O mês {mes} está fechado. Para corrigir, quem tem a permissão &quot;Reabrir mês&quot; reabre em Contador → Fechamento.</p>
          )}
          {fechado && (
            <label className="flex items-start gap-2 rounded-[var(--r-md)] bg-surface-2 p-2 text-warn">
              <input type="checkbox" className="mt-0.5" checked={cienteMes} onChange={(e) => setCienteMes(e.target.checked)} />
              O mês {mes} já foi enviado à contabilidade. Sei que esta correção muda números já entregues.
            </label>
          )}
          {erro && <p className="rounded-[var(--r-md)] bg-surface-2 p-2 font-medium text-err">{erro}</p>}
        </div>
        <DialogFooter>
          <button type="button" className={btnClass('primary')} disabled={pending || travado || !!invalido || !ciente || (fechado && !cienteMes)} onClick={salvar}>
            {pending && <Spinner />}Excluir e relançar no Omie
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Botão "Refazer" de uma correção parada (relançamento que falhou depois da exclusão, ou travada). */
export function RefazerCorrecao({ id }: { id: number }) {
  const [pending, start] = useTransition()
  const router = useRouter()
  return (
    <button type="button" className={btnClass('outline')} disabled={pending} onClick={() => start(async () => {
      const r = await relancarCorrecaoCusto(id)
      if ('error' in r) toast.error('Não foi possível refazer', { description: r.error })
      else toast.success(r.aviso)
      router.refresh()
    })}>{pending && <Spinner />}Refazer</button>
  )
}
