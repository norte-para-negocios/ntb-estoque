'use client'

import { Fragment, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { ESTADOS, MODULOS, estadoEfetivo, estadoPadrao, type Estado, type ModuloId } from '@/lib/plataforma/modulos-puro'
import { PLANOS_VENDAS } from '@/lib/plataforma/admin-puro'
import { salvarAssinatura } from '@/lib/actions/plataforma-modulos'
import { IDENTIDADE } from './simbolos'
import { COR_ESTADO, ROTULO_ESTADO } from './estados'

// Matriz lojas × módulos (protótipo aprovado, tela "Administração"). Cada célula = estado efetivo num seletor em pílula
// com a cor do estado; "padrão" quando a loja não tem linha gravada. Mudou aqui, muda na hora o que a loja enxerga.

export type LojaLinha = { id: number; nome: string; is_test: boolean }
export type Gravada = { estado: Estado; plano_id: string | null; preco_combinado: number | null }
type Gravadas = Record<string, Gravada> // chave `${lojaId}:${modulo}`

const PADRAO = '__padrao'
const chave = (l: number, m: ModuloId) => `${l}:${m}`

function Celula({ loja, modulo, gravada, desabilitado, onSalvar }: {
  loja: LojaLinha
  modulo: ModuloId
  gravada: Gravada | undefined
  desabilitado: boolean
  onSalvar: (estado: Estado | null, planoId: string | null) => void
}) {
  const efetivo = estadoEfetivo(gravada?.estado, modulo, loja.id)
  const nomeModulo = MODULOS.find((m) => m.id === modulo)!.nome
  return (
    <div className="flex flex-col items-start gap-1.5">
      <span className={`relative inline-flex rounded-full ${COR_ESTADO[efetivo]}`}>
        <select
          aria-label={`${nomeModulo} na ${loja.nome}`}
          value={gravada ? gravada.estado : PADRAO}
          disabled={desabilitado}
          onChange={(e) => onSalvar(e.target.value === PADRAO ? null : (e.target.value as Estado), gravada?.plano_id ?? null)}
          className="h-8 cursor-pointer appearance-none rounded-full bg-transparent pl-3 pr-7 text-[13px] font-semibold text-current outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value={PADRAO}>{gravada ? 'Voltar ao padrão' : ROTULO_ESTADO[efetivo]}</option>
          {ESTADOS.map((e) => <option key={e} value={e}>{ROTULO_ESTADO[e]}</option>)}
        </select>
        <svg viewBox="0 0 10 6" aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-2.5 -translate-y-1/2 opacity-70">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {!gravada && <span className="pl-1 text-[11px] text-text-muted">padrão</span>}
      {modulo === 'vendas' && (
        <select
          aria-label={`Plano do Norte Vendas na ${loja.nome}`}
          value={gravada?.plano_id ?? ''}
          disabled={desabilitado}
          onChange={(e) => onSalvar(gravada?.estado ?? efetivo, e.target.value || null)}
          className="h-7 max-w-full cursor-pointer appearance-none rounded-full bg-transparent pl-1 pr-1 text-[12px] text-text-muted underline decoration-[var(--border)] underline-offset-4 hover:text-text focus-visible:outline-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed"
        >
          <option value="">Sem plano</option>
          {PLANOS_VENDAS.map((p) => <option key={p.id} value={p.id}>Plano {p.nome.toLowerCase()}</option>)}
        </select>
      )}
    </div>
  )
}

export function MatrizModulos({ lojas, gravadas: inicial, desabilitado }: { lojas: LojaLinha[]; gravadas: Gravadas; desabilitado: boolean }) {
  const [gravadas, setGravadas] = useState(inicial)
  const [, iniciar] = useTransition()
  const [salvando, setSalvando] = useState<string | null>(null)

  function salvar(loja: LojaLinha, modulo: ModuloId, estado: Estado | null, planoId: string | null) {
    const k = chave(loja.id, modulo)
    const antes = gravadas[k]
    const depois: Gravadas = { ...gravadas }
    if (estado === null) delete depois[k]
    else depois[k] = { estado, plano_id: planoId, preco_combinado: antes?.preco_combinado ?? null }
    setGravadas(depois)
    setSalvando(k)
    iniciar(async () => {
      const r = await salvarAssinatura(loja.id, modulo, { estado, planoId: estado === null ? null : planoId, precoCombinado: estado === null ? null : antes?.preco_combinado ?? null })
      setSalvando(null)
      if ('error' in r) {
        setGravadas((g) => {
          const v = { ...g }
          if (antes) v[k] = antes
          else delete v[k]
          return v
        })
        toast.error(r.error)
      } else {
        const nome = MODULOS.find((m) => m.id === modulo)!.nome
        toast.success(estado === null
          ? `${nome} na ${loja.nome} voltou ao padrão (${ROTULO_ESTADO[estadoPadrao(modulo, loja.id)].toLowerCase()}).`
          : `${nome} na ${loja.nome}: ${ROTULO_ESTADO[estado].toLowerCase()}.`)
      }
    })
  }

  const teste = lojas.findIndex((l) => l.is_test)

  return (
    <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="text-[12px] font-semibold text-text-muted">
            <th scope="col" className="sticky left-0 z-10 bg-surface px-5 pb-3 pt-4 font-semibold">Loja</th>
            {MODULOS.map((m) => {
              const { cor, Simbolo } = IDENTIDADE[m.id]
              return (
                <th key={m.id} scope="col" className="px-3 pb-3 pt-4 font-semibold">
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <span className="grid size-5 shrink-0 place-items-center rounded-[6px] text-white" style={{ background: cor }} aria-hidden="true">
                      <Simbolo className="size-3" />
                    </span>
                    {m.nome}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {lojas.map((l, i) => (
            <Fragment key={l.id}>
            {i === teste && (
              <tr className="border-t border-[var(--border)] bg-surface-2/60">
                <th scope="rowgroup" colSpan={MODULOS.length + 1} className="sticky left-0 px-5 py-2 text-left text-[12px] font-semibold text-text-muted">Lojas de teste</th>
              </tr>
            )}
            <tr className="border-t border-[var(--border)]">
              <th scope="row" className="sticky left-0 z-10 bg-surface px-5 py-4 align-top font-normal">
                <b className="block max-w-[200px] truncate text-[14px] font-semibold text-text" title={l.nome}>{l.nome}</b>
                <small className="num block text-[12px] text-text-muted">Loja {l.id}{l.is_test ? ' · teste' : ''}</small>
              </th>
              {MODULOS.map((m) => {
                const k = chave(l.id, m.id)
                return (
                  <td key={m.id} className="px-3 py-4 align-top" aria-busy={salvando === k}>
                    <Celula loja={l} modulo={m.id} gravada={gravadas[k]} desabilitado={desabilitado || salvando === k}
                      onSalvar={(estado, planoId) => salvar(l, m.id, estado, planoId)} />
                  </td>
                )
              })}
            </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
