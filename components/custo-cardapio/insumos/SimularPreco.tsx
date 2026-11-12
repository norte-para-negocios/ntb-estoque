'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { lerPreco, simularPreco, type Uso } from '@/lib/custo-cardapio/insumos-puro'
import { brl, pct } from '@/lib/custo-cardapio/formato'
import { formatCustoUnit } from '@/lib/num-br'

export type UsoSimulavel = Uso & { descricao: string; preco: number | null; prato: boolean }

// "E se o preço mudar": digita o novo custo do insumo e vê quanto cada prato/preparação passa a custar e o CMV.
// Só conta, não grava nada (pura: simularPreco em lib/custo-cardapio/insumos-puro.ts).
export function SimularPreco({ usos, custoAtual, unidade, meta }: { usos: UsoSimulavel[]; custoAtual: number | null; unidade: string | null; meta: number }) {
  const [texto, setTexto] = useState('')
  const novo = lerPreco(texto)
  const sims = useMemo(() => {
    if (novo == null) return []
    const porRaiz = new Map(usos.map((u) => [u.raiz, u]))
    return simularPreco(usos, custoAtual, novo)
      .map((s) => ({ ...s, u: porRaiz.get(s.raiz)! }))
      .sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca))
  }, [usos, custoAtual, novo])
  const comPreco = sims.filter((s) => s.u.prato && s.cmvDepois != null)
  const acimaAntes = comPreco.filter((s) => (s.cmvAntes as number) > meta + 1e-9).length
  const acimaDepois = comPreco.filter((s) => (s.cmvDepois as number) > meta + 1e-9).length
  const variacao = novo != null && custoAtual != null && custoAtual > 0 ? novo / custoAtual - 1 : null
  const u = (unidade ?? '').toLowerCase()

  return (
    <section className="rounded-[var(--r-lg)] bg-surface p-5 shadow-[var(--shadow-sm)]">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-text">E se o preço mudar</h2>
      <p className="text-[13px] text-text-muted">Digite o novo custo e veja quanto cada prato passa a custar. Nada é salvo.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[14px] text-text">
          Novo custo{u ? ` por ${u}` : ''}
          <input inputMode="decimal" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={custoAtual != null ? custoAtual.toLocaleString('pt-BR', { maximumFractionDigits: 4 }) : '0,00'}
            className="num h-10 w-[140px] rounded-[var(--r-md)] bg-surface-2 px-3 text-right text-[15px] outline-none focus:ring-2 focus:ring-brand/40" />
        </label>
        <span className="text-[13px] text-text-muted">
          Hoje: {custoAtual != null ? formatCustoUnit(custoAtual, unidade) : 'sem custo'}
          {variacao != null && <span className={variacao > 0 ? ' text-err' : variacao < 0 ? ' text-ok' : ''}> ({variacao > 0 ? '+' : ''}{pct(variacao)})</span>}
        </span>
      </div>
      {texto.trim() !== '' && novo == null && <p className="mt-2 text-[13px] text-err">Digite um valor maior que zero, como 12,50.</p>}

      {sims.length > 0 && (
        <>
          {comPreco.length > 0 && (
            <p className="mt-4 text-[14px] text-text">
              {acimaDepois === acimaAntes
                ? `Nenhum prato muda de lado da meta de ${pct(meta, 0)}.`
                : acimaDepois > acimaAntes
                  ? `${acimaDepois - acimaAntes} ${acimaDepois - acimaAntes === 1 ? 'prato passa' : 'pratos passam'} da meta de ${pct(meta, 0)}.`
                  : `${acimaAntes - acimaDepois} ${acimaAntes - acimaDepois === 1 ? 'prato volta' : 'pratos voltam'} para dentro da meta de ${pct(meta, 0)}.`}
            </p>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead>
                <tr className="text-[12px] text-text-muted">
                  <th className="py-2 pr-2 font-medium">Prato ou preparação</th>
                  <th className="px-2 py-2 text-right font-medium">Custo hoje</th>
                  <th className="px-2 py-2 text-right font-medium">Custo novo</th>
                  <th className="px-2 py-2 text-right font-medium">CMV hoje</th>
                  <th className="py-2 pl-2 text-right font-medium">CMV novo</th>
                </tr>
              </thead>
              <tbody>
                {sims.map((s) => {
                  const passa = s.cmvDepois != null && s.cmvDepois > meta + 1e-9
                  return (
                    <tr key={s.raiz} className="border-t border-border/60">
                      <td className="py-2 pr-2"><Link href={`/cozinha/pratos/${s.raiz}`} className="text-text hover:text-brand">{s.u.descricao}</Link>{!s.u.prato && <span className="text-text-muted"> · preparação</span>}</td>
                      <td className="num whitespace-nowrap px-2 py-2 text-right text-text-muted">{brl(s.custoAntes)}</td>
                      <td className="num whitespace-nowrap px-2 py-2 text-right">{brl(s.custoDepois)} <span className={s.diferenca > 0.0049 ? 'text-err' : s.diferenca < -0.0049 ? 'text-ok' : 'text-text-muted'}>({s.diferenca >= 0 ? '+' : '−'}{brl(Math.abs(s.diferenca))})</span></td>
                      <td className="num whitespace-nowrap px-2 py-2 text-right text-text-muted">{s.u.prato ? pct(s.cmvAntes) : '—'}</td>
                      <td className={`num whitespace-nowrap py-2 pl-2 text-right font-semibold ${!s.u.prato || s.cmvDepois == null ? 'text-text-muted' : passa ? 'text-err' : 'text-ok'}`}>{s.u.prato ? pct(s.cmvDepois) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] text-text-muted">CMV com o preço de venda do cadastro; prato sem preço fica com —.</p>
        </>
      )}
    </section>
  )
}
