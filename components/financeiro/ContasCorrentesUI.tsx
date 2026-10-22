'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useCriarDaCentral } from '@/lib/use-criar-da-central'
import Link from 'next/link'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'
import { Money } from '@/components/ui-kit/Money'
import { Spinner } from '@/components/ui-kit/Spinner'
import { salvarContaCorrente } from '@/lib/actions/financeiro'
import type { ContaCorrente } from '@/lib/financeiro/dados'
import { campo, dataBR, PreviaMoeda, rotulo } from './comum'

const TIPOS = { caixa: 'Caixa', banco: 'Banco', outro: 'Outra' } as const

export function FormConta({ conta, hoje, children }: { conta?: ContaCorrente; hoje: string; children: React.ReactNode }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  useCriarDaCentral(() => setAberto(true), !conta)
  const [nome, setNome] = useState(conta?.nome ?? '')
  const [tipo, setTipo] = useState<'caixa' | 'banco' | 'outro'>(conta?.tipo ?? 'banco')
  const [banco, setBanco] = useState(conta?.banco ?? '')
  const [agencia, setAgencia] = useState(conta?.agencia ?? '')
  const [numero, setNumero] = useState(conta?.numero_conta ?? '')
  const [saldo, setSaldo] = useState(conta ? String(conta.saldo_inicial).replace('.', ',') : '')
  const [data, setData] = useState(conta?.data_saldo_inicial ?? hoje)
  const [ativa, setAtiva] = useState(conta?.ativa ?? true)
  const [obs, setObs] = useState(conta?.observacao ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [pend, start] = useTransition()

  function reiniciar() {
    setNome(conta?.nome ?? ''); setTipo(conta?.tipo ?? 'banco'); setBanco(conta?.banco ?? ''); setAgencia(conta?.agencia ?? ''); setNumero(conta?.numero_conta ?? '')
    setSaldo(conta ? String(conta.saldo_inicial).replace('.', ',') : ''); setData(conta?.data_saldo_inicial ?? hoje); setAtiva(conta?.ativa ?? true)
    setObs(conta?.observacao ?? ''); setErro(null)
  }
  // Com lançamentos, o saldo inicial e a data não mudam mais (o servidor também recusa).
  const travado = (conta?.lancamentos ?? 0) > 0

  function salvar() {
    setErro(null)
    start(async () => {
      const r = await salvarContaCorrente({ id: conta?.id ?? null, nome, tipo, banco, agencia, numeroConta: numero, saldoInicial: saldo, dataSaldoInicial: data, ativa, observacao: obs })
      if ('error' in r) { setErro(r.error); return }
      toast.success(conta ? 'Conta atualizada' : 'Conta criada')
      setAberto(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!pend) { if (o) reiniciar(); setAberto(o); setErro(null) } }}>
      <DialogTrigger render={<button type="button" className={conta ? 'text-[13px] font-medium text-brand hover:underline' : btnClass('primary')}>{children}</button>} />
      <DialogContent>
        <DialogHeader><DialogTitle>{conta ? 'Editar conta corrente' : 'Nova conta corrente'}</DialogTitle></DialogHeader>
        <div className="max-h-[65vh] space-y-3 overflow-auto text-[13px]">
          <label className={rotulo}><span>Nome</span><input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} placeholder="Ex.: Caixa da loja, Banco principal" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className={rotulo}><span>Tipo</span>
              <select className={campo} value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
                {Object.entries(TIPOS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className={rotulo}><span>Banco</span><input className={campo} value={banco} onChange={(e) => setBanco(e.target.value)} maxLength={80} disabled={tipo === 'caixa'} /></label>
            <label className={rotulo}><span>Agência</span><input className={campo} value={agencia} onChange={(e) => setAgencia(e.target.value)} maxLength={20} disabled={tipo === 'caixa'} /></label>
            <label className={rotulo}><span>Conta</span><input className={campo} value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={30} disabled={tipo === 'caixa'} /></label>
            <label className={rotulo}><span>Saldo inicial (R$)</span><input inputMode="decimal" className={campo} value={saldo} onChange={(e) => setSaldo(e.target.value)} placeholder="0,00" disabled={travado} /><PreviaMoeda texto={saldo} /></label>
            <label className={rotulo}><span>Saldo válido desde</span><input type="date" className={campo} value={data} max={hoje} onChange={(e) => setData(e.target.value)} disabled={travado} /></label>
          </div>
          <p className="rounded-[var(--r-md)] bg-surface-2 p-2 text-text-muted">
            O saldo inicial vale a partir da data “Saldo válido desde”: <strong className="text-text">não dá para registrar pagamento com data anterior a ela</strong>.
            Se você precisa lançar pagamentos mais antigos, informe aqui a data em que começa o controle da conta e o saldo que ela tinha nesse dia.
            {travado && ' Esta conta já tem lançamentos: o saldo inicial e a data não mudam mais.'}
          </p>
          <label className={rotulo}><span>Observação</span><input className={campo} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={300} /></label>
          {conta && (
            <label className="flex items-center gap-2"><input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} /> Conta ativa (inativa não recebe pagamentos)</label>
          )}
          {erro && <p className="rounded-[var(--r-md)] bg-surface-2 p-2 font-medium text-err">{erro}</p>}
        </div>
        <DialogFooter>
          <button type="button" className={btnClass('primary')} disabled={pend || nome.trim().length < 2} onClick={salvar}>{pend && <Spinner />}Salvar</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ListaContas({ contas, hoje }: { contas: ContaCorrente[]; hoje: string }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {contas.map((c) => (
        <li key={c.id} className={`space-y-2 rounded-[var(--r-lg)] bg-surface p-4 text-[13px] u-card ${c.ativa ? '' : 'opacity-60'}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[16px] font-semibold text-text">{c.nome}</p>
              <p className="text-text-muted">{TIPOS[c.tipo]}{c.banco ? ` · ${c.banco}` : ''}{c.agencia ? ` · ag. ${c.agencia}` : ''}{c.numero_conta ? ` · c/c ${c.numero_conta}` : ''}{c.ativa ? '' : ' · inativa'}</p>
            </div>
            <FormConta conta={c} hoje={hoje}>Editar</FormConta>
          </div>
          <div>
            <p className="text-text-muted">Saldo atual</p>
            <p className={`text-[24px] font-semibold tracking-[-0.02em] ${c.saldo_atual < 0 ? 'text-err' : 'text-text'}`}><Money value={c.saldo_atual} /></p>
            <p className="text-text-muted">Saldo inicial <Money value={c.saldo_inicial} /> em {dataBR(c.data_saldo_inicial)} · {c.lancamentos} lançamento(s)</p>
          </div>
          <Link href={`/financeiro/extrato?conta=${c.id}`} className="inline-block font-medium text-brand hover:underline">Ver extrato</Link>
        </li>
      ))}
    </ul>
  )
}
