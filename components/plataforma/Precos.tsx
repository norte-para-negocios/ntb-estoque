'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { MODULOS, type ModuloId } from '@/lib/plataforma/modulos-puro'
import { PLANOS, lerValorBR as lerValor } from '@/lib/plataforma/admin-puro'
import { salvarPrecoPlano } from '@/lib/actions/plataforma-modulos'
import { IDENTIDADE } from './simbolos'

// Preço mensal de cada plano (vazio = "definir"). Só a equipe da Norte vê; nunca vai para o site nem para o cliente.

const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function CampoPreco({ planoId, rotulo, inicial, desabilitado }: { planoId: string; rotulo: string; inicial: number | null; desabilitado: boolean }) {
  const [salvo, setSalvo] = useState(inicial)
  const [texto, setTexto] = useState(inicial == null ? '' : brl(inicial))
  const [pendente, iniciar] = useTransition()

  function salvar() {
    const v = lerValor(texto)
    if (v === salvo || (v != null && salvo != null && Math.abs(v - salvo) < 0.005)) {
      setTexto(salvo == null ? '' : brl(salvo))
      return
    }
    if (v != null && (Number.isNaN(v) || v < 0)) {
      toast.error('Digite um valor em reais, por exemplo 70 ou 70,00.')
      setTexto(salvo == null ? '' : brl(salvo))
      return
    }
    iniciar(async () => {
      const r = await salvarPrecoPlano(planoId, v)
      if ('error' in r) {
        toast.error(r.error)
        setTexto(salvo == null ? '' : brl(salvo))
        return
      }
      setSalvo(v)
      setTexto(v == null ? '' : brl(v))
      toast.success(v == null ? `${rotulo}: sem preço.` : `${rotulo}: R$ ${brl(v)} por mês.`)
    })
  }

  return (
    <label className="mt-3 block text-[12px] text-text-muted">
      {rotulo}
      <span className="mt-1 flex h-10 items-center gap-1.5 rounded-[var(--r-md)] bg-surface-2 px-3 focus-within:outline-2 focus-within:outline-[var(--brand)]">
        <span className="text-[13px] text-text-muted">R$</span>
        <input
          inputMode="decimal"
          value={texto}
          placeholder="definir"
          disabled={desabilitado || pendente}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={salvar}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="num w-full min-w-0 bg-transparent text-[15px] text-text outline-none placeholder:text-text-muted/70 disabled:opacity-60"
        />
        <span className="whitespace-nowrap text-[12px] text-text-muted">por mês</span>
      </span>
    </label>
  )
}

export function Precos({ precos, desabilitado }: { precos: Record<string, number | null>; desabilitado: boolean }) {
  const modulos = MODULOS.filter((m) => PLANOS.some((p) => p.modulo === m.id))
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {modulos.map((m) => {
        const { cor, Simbolo } = IDENTIDADE[m.id as ModuloId]
        return (
          <section key={m.id} className="rounded-[var(--r-lg)] bg-surface p-5 shadow-[var(--shadow-sm)]">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold text-text">
              <span className="grid size-6 place-items-center rounded-[7px] text-white" style={{ background: cor }} aria-hidden="true">
                <Simbolo className="size-3.5" />
              </span>
              {m.nome}
            </h3>
            {PLANOS.filter((p) => p.modulo === m.id).map((p) => (
              <CampoPreco key={p.id} planoId={p.id} rotulo={p.nome} inicial={precos[p.id] ?? null} desabilitado={desabilitado} />
            ))}
          </section>
        )
      })}
    </div>
  )
}
