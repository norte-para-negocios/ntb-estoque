'use client'

import { useMemo, useState } from 'react'
import { ChevronRight, RotateCcw } from 'lucide-react'
import type { NoTela } from '@/lib/custo-cardapio/carregar'
import { arredondarPreco, cmv as calcCmv, precoSugeridoDelivery, precoSugeridoSalao, situacao, sobraPorVenda, type Taxas } from '@/lib/custo-cardapio/preco-puro'
import { brl, pct, qtd } from '@/lib/custo-cardapio/formato'
import { BarraCmv } from './BarraCmv'

// Painel do prato: custo pela ficha, CMV e o "e se" (mudar preço ou quantidade sem salvar nada).
// A ficha continua sendo editada na Estrutura do produto; aqui é só conta.

const lerNum = (s: string) => { const v = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(v) ? v : NaN }
const fmtCampo = (v: number | null) => (v == null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export function PainelPrato({ itens, taxas, precoCadastro, semCusto, suspeitos }: { itens: NoTela[]; taxas: Taxas; precoCadastro: number | null; semCusto: number; suspeitos: number }) {
  const [preco, setPreco] = useState(fmtCampo(precoCadastro))
  const [precoDelivery, setPrecoDelivery] = useState('')
  const [fator, setFator] = useState<Record<number, string>>({})
  const [aberto, setAberto] = useState<Record<string, boolean>>({})

  const linhas = useMemo(() => itens.map((n, i) => {
    const f = fator[i] != null ? lerNum(fator[i]) : n.quantidade
    const escala = n.quantidade > 0 && Number.isFinite(f) && f >= 0 ? f / n.quantidade : 1
    return { n, i, quantidade: Number.isFinite(f) ? f : n.quantidade, custo: n.custo * escala, mudou: fator[i] != null && Math.abs(escala - 1) > 1e-9 }
  }), [itens, fator])
  const custo = linhas.reduce((a, l) => a + l.custo, 0)
  const simulando = linhas.some((l) => l.mudou)
  const p = lerNum(preco)
  const pv = Number.isFinite(p) && p > 0 ? p : null
  const pd = lerNum(precoDelivery)
  const pdv = Number.isFinite(pd) && pd > 0 ? pd : null
  const c = calcCmv(custo, pv)
  const sit = situacao(custo, pv, semCusto, taxas)
  const sugSalao = arredondarPreco(precoSugeridoSalao(custo, taxas))
  const sugDelivery = arredondarPreco(precoSugeridoDelivery(custo, taxas))
  const maior = Math.max(...linhas.map((l) => l.custo), 0.0001)
  const campo = 'num h-10 w-full rounded-[var(--r-md)] bg-surface-2 px-3 text-right text-[15px] outline-none focus:ring-2 focus:ring-brand/40'

  const Filhos = ({ nos, nivel, chave }: { nos: NoTela[]; nivel: number; chave: string }) => (
    <ul className="space-y-1 border-l border-border pl-3" style={{ marginLeft: nivel * 4 }}>
      {nos.map((f, j) => {
        const k = `${chave}.${j}`
        return (
          <li key={k}>
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <button type="button" disabled={!f.filhos.length} onClick={() => setAberto((a) => ({ ...a, [k]: !a[k] }))}
                className="flex min-w-0 items-center gap-1 text-left text-text-muted enabled:hover:text-text">
                {f.filhos.length > 0 && <ChevronRight className={`size-3.5 shrink-0 u-motion ${aberto[k] ? 'rotate-90' : ''}`} />}
                <span className="truncate">{f.descricao}</span>
                <span className="num shrink-0">· {qtd(f.quantidade, f.unidade)}</span>
              </button>
              <span className={`num shrink-0 ${f.semCusto || f.suspeito ? 'text-warn' : 'text-text-muted'}`}>{f.semCusto ? 'sem custo' : f.suspeito ? `${brl(f.custo)} · conferir` : brl(f.custo)}</span>
            </div>
            {aberto[k] && f.filhos.length > 0 && <div className="mt-1"><Filhos nos={f.filhos} nivel={nivel + 1} chave={k} /></div>}
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold">Ficha técnica</h2>
            <p className="text-[13px] text-text-muted">Mude uma quantidade para ver o efeito no custo. Nada é salvo.</p>
          </div>
          {simulando && (
            <button type="button" onClick={() => setFator({})} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand hover:underline">
              <RotateCcw className="size-3.5" /> Voltar à ficha
            </button>
          )}
        </div>
        <ul className="divide-y divide-border/60">
          {linhas.map(({ n, i, quantidade, custo: ci, mudou }) => (
            <li key={i} className="py-2.5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_112px_96px]">
                <div className="col-span-2 min-w-0 sm:col-span-1">
                  <button type="button" disabled={!n.filhos.length} onClick={() => setAberto((a) => ({ ...a, [i]: !a[i] }))}
                    className="flex max-w-full items-center gap-1 text-left font-medium text-text enabled:hover:text-brand">
                    {n.filhos.length > 0 && <ChevronRight className={`size-4 shrink-0 text-text-muted u-motion ${aberto[i] ? 'rotate-90' : ''}`} />}
                    <span className="truncate">{n.descricao}</span>
                  </button>
                  <div className="mt-1 h-1 rounded-full bg-surface-2" aria-hidden>
                    <div className="h-full rounded-full bg-brand/70" style={{ width: `${(ci / maior) * 100}%` }} />
                  </div>
                  <p className="mt-1 text-[12px] text-text-muted">
                    {n.temFicha ? 'preparação' : n.semCusto ? <span className="text-warn">sem custo médio: não entra na conta</span>
                      : n.suspeito ? <span className="text-warn">{brl(n.custoUnitarioCmc)} por {(n.unidade ?? 'un').toLowerCase()}: custo médio fora do normal, confira as entradas</span>
                        : `${brl(n.custoUnitarioCmc)} por ${(n.unidade ?? 'un').toLowerCase()}`}
                    {custo > 0 ? ` · ${pct(ci / custo, 0)} do prato` : ''}
                  </p>
                </div>
                <label className="block max-w-[160px] sm:max-w-none">
                  <span className="sr-only">Quantidade de {n.descricao}</span>
                  <div className="flex items-center gap-1">
                    <input inputMode="decimal" value={fator[i] ?? String(n.quantidade).replace('.', ',')}
                      onChange={(e) => setFator((f) => ({ ...f, [i]: e.target.value }))}
                      className={`num h-9 w-full rounded-[var(--r-md)] px-2 text-right text-[14px] outline-none focus:ring-2 focus:ring-brand/40 ${mudou ? 'bg-brand-soft text-brand' : 'bg-surface-2'}`} />
                    <span className="w-6 text-[12px] text-text-muted">{(n.unidade ?? '').toLowerCase()}</span>
                  </div>
                  <span className="num block text-right text-[11px] text-text-muted">{qtd(quantidade, n.unidade)}</span>
                </label>
                <span className={`num text-right text-[14px] ${mudou ? 'font-semibold text-brand' : ''}`}>{n.semCusto ? '—' : brl(ci)}</span>
              </div>
              {aberto[i] && n.filhos.length > 0 && <div className="mt-2"><Filhos nos={n.filhos} nivel={1} chave={String(i)} /></div>}
            </li>
          ))}
        </ul>
      </section>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <section className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5">
          <p className="text-[13px] text-text-muted">{simulando ? 'Custo simulado' : 'Custo do prato'}</p>
          <p className={`num mt-0.5 text-[32px] font-semibold leading-none tracking-[-0.02em] ${simulando ? 'text-brand' : ''}`}>{brl(custo)}</p>
          {suspeitos > 0 && <p className="mt-1.5 text-[12px] text-warn">{suspeitos} insumo{suspeitos > 1 ? 's' : ''} com custo médio fora do normal: este custo não é confiável.</p>}
          {semCusto > 0 && <p className="mt-1.5 text-[12px] text-warn">{semCusto} insumo{semCusto > 1 ? 's' : ''} sem custo médio: o custo real é maior.</p>}

          <label className="mt-4 block">
            <span className="mb-1 block text-[13px] font-medium">Preço no salão</span>
            <input inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} placeholder="0,00" className={campo} />
          </label>
          <div className="mt-3"><BarraCmv cmv={c} meta={taxas.metaCmv} situacao={sit} /></div>
          <dl className="mt-3 space-y-1.5 text-[13px]">
            <div className="flex justify-between"><dt className="text-text-muted">Sobra por venda</dt><dd className="num font-semibold">{pv ? brl(sobraPorVenda(pv, custo, taxas, 'salao')) : '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-text-muted">Preço para a meta de {pct(taxas.metaCmv, 0)}</dt>
              <dd><button type="button" onClick={() => setPreco(fmtCampo(sugSalao))} className="num font-semibold text-brand hover:underline">{brl(sugSalao)}</button></dd></div>
          </dl>
          {precoCadastro != null && pv != null && Math.abs(pv - precoCadastro) > 0.004 && (
            <p className="mt-2 text-[12px] text-text-muted">Preço cadastrado: {brl(precoCadastro)}. <button type="button" className="text-brand hover:underline" onClick={() => setPreco(fmtCampo(precoCadastro))}>Voltar</button></p>
          )}
        </section>

        <section className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5">
          <h3 className="text-[15px] font-semibold">Delivery</h3>
          <p className="text-[12px] text-text-muted">App {pct(taxas.taxaDeliveryPct, 0)} + cartão {pct(taxas.taxaCartaoPct, 0)} + imposto {pct(taxas.impostoPct, 0)}, embalagem {brl(taxas.embalagem)}.</p>
          <label className="mt-3 block">
            <span className="mb-1 block text-[13px] font-medium">Preço no app</span>
            <input inputMode="decimal" value={precoDelivery} onChange={(e) => setPrecoDelivery(e.target.value)} placeholder={fmtCampo(sugDelivery)} className={campo} />
          </label>
          <dl className="mt-3 space-y-1.5 text-[13px]">
            <div className="flex justify-between"><dt className="text-text-muted">Sobra por pedido</dt><dd className="num font-semibold">{brl(sobraPorVenda(pdv ?? sugDelivery, custo, taxas, 'delivery'))}</dd></div>
            <div className="flex justify-between"><dt className="text-text-muted">Preço para a meta</dt>
              <dd><button type="button" onClick={() => setPrecoDelivery(fmtCampo(sugDelivery))} className="num font-semibold text-brand hover:underline">{brl(sugDelivery)}</button></dd></div>
          </dl>
        </section>
      </aside>
    </div>
  )
}
