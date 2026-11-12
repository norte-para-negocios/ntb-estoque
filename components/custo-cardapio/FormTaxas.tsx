'use client'

import { useState, useTransition } from 'react'
import { salvarTaxasCardapio } from '@/lib/actions/custo-cardapio'
import { btnClass } from '@/components/ui-kit/Button'
import { precoSugeridoDelivery, precoSugeridoSalao, type Taxas } from '@/lib/custo-cardapio/preco-puro'
import { brl } from '@/lib/custo-cardapio/formato'

// Meta de CMV e taxas da loja, com o exemplo de um prato de R$ 10 de custo mudando enquanto digita.
const CAMPOS: { k: keyof Taxas; rotulo: string; dica: string; pct: boolean }[] = [
  { k: 'metaCmv', rotulo: 'Meta de CMV', dica: 'Quanto do preço pode ir para os ingredientes.', pct: true },
  { k: 'impostoPct', rotulo: 'Imposto sobre a venda', dica: 'Simples ou outro regime, em % do faturamento.', pct: true },
  { k: 'taxaCartaoPct', rotulo: 'Taxa do cartão', dica: 'Média das maquininhas.', pct: true },
  { k: 'taxaDeliveryPct', rotulo: 'Comissão do app de entrega', dica: 'iFood e parecidos, com a taxa de pagamento online.', pct: true },
  { k: 'embalagem', rotulo: 'Embalagem por pedido', dica: 'Em reais, somada ao custo no delivery.', pct: false },
]
const mostrar = (v: number, pct: boolean) => (pct ? (v * 100) : v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const ler = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'))

export function FormTaxas({ inicial, gravavel }: { inicial: Taxas; gravavel: boolean }) {
  const [txt, setTxt] = useState<Record<keyof Taxas, string>>(() =>
    Object.fromEntries(CAMPOS.map((c) => [c.k, mostrar(inicial[c.k], c.pct)])) as Record<keyof Taxas, string>)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [salvando, start] = useTransition()
  const taxas = Object.fromEntries(CAMPOS.map((c) => [c.k, c.pct ? ler(txt[c.k]) / 100 : ler(txt[c.k])])) as Taxas
  const valido = CAMPOS.every((c) => Number.isFinite(taxas[c.k]))

  return (
    <form className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"
      onSubmit={(e) => {
        e.preventDefault()
        setMsg(null)
        start(async () => {
          const r = await salvarTaxasCardapio(taxas)
          setMsg('error' in r ? { ok: false, texto: r.error } : { ok: true, texto: 'Salvo. Os preços sugeridos já usam os valores novos.' })
        })
      }}>
      <div className="space-y-4 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5">
        {CAMPOS.map((c) => (
          <label key={c.k} className="grid items-center gap-1 sm:grid-cols-[minmax(0,1fr)_140px] sm:gap-4">
            <span>
              <span className="block text-[14px] font-medium">{c.rotulo}</span>
              <span className="block text-[12px] text-text-muted">{c.dica}</span>
            </span>
            <span className="flex items-center gap-1.5">
              {!c.pct && <span className="text-[13px] text-text-muted">R$</span>}
              <input inputMode="decimal" value={txt[c.k]} onChange={(e) => setTxt((t) => ({ ...t, [c.k]: e.target.value }))}
                className="num h-10 w-full rounded-[var(--r-md)] bg-surface-2 px-3 text-right text-[15px] outline-none focus:ring-2 focus:ring-brand/40" />
              {c.pct && <span className="text-[13px] text-text-muted">%</span>}
            </span>
          </label>
        ))}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button type="submit" disabled={salvando || !valido || !gravavel} className={btnClass('primary')}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          {msg && <span className={`text-[13px] ${msg.ok ? 'text-ok' : 'text-err'}`}>{msg.texto}</span>}
          {!gravavel && <span className="text-[13px] text-warn">Ainda não dá para salvar nesta base (migration 473 pendente).</span>}
        </div>
      </div>
      <aside className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5 lg:self-start">
        <p className="text-[13px] text-text-muted">Exemplo: prato que custa R$ 10,00</p>
        <dl className="mt-3 space-y-2 text-[14px]">
          <div className="flex justify-between"><dt>No salão</dt><dd className="num font-semibold">{valido ? brl(precoSugeridoSalao(10, taxas)) : '—'}</dd></div>
          <div className="flex justify-between"><dt>No delivery</dt><dd className="num font-semibold">{valido ? brl(precoSugeridoDelivery(10, taxas)) : '—'}</dd></div>
        </dl>
        <p className="mt-3 text-[12px] text-text-muted">O delivery fica mais caro porque o app, o cartão e o imposto saem do preço, e a embalagem entra no custo.</p>
      </aside>
    </form>
  )
}
