'use client'

import { useState, useTransition } from 'react'
import { salvarTaxasCardapio } from '@/lib/actions/custo-cardapio'
import { btnClass } from '@/components/ui-kit/Button'
import { precoSugeridoDelivery, precoSugeridoSalao, type Taxas } from '@/lib/custo-cardapio/preco-puro'
import { brl } from '@/lib/custo-cardapio/formato'
import { COBERTURA_MAX, COBERTURA_MIN, DIAS_SEMANA, montarWhatsapp, separarWhatsapp, validarConfigCompras, whatsappLegivel, type ConfigCompras } from '@/lib/custo-cardapio/config-puro'

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

export function FormTaxas({ inicial, gravavel, compras, comprasGravavel = false }: {
  inicial: Taxas; gravavel: boolean; compras?: ConfigCompras; comprasGravavel?: boolean
}) {
  const wa0 = separarWhatsapp(compras?.whatsappCompras ?? null)
  const [cobertura, setCobertura] = useState(String(compras?.coberturaDias ?? 7))
  const [ddi, setDdi] = useState(wa0.ddi)
  const [numero, setNumero] = useState(wa0.numero)
  const [dia, setDia] = useState(compras?.diaContagem == null ? '' : String(compras.diaContagem))
  const configCompras: ConfigCompras = {
    coberturaDias: Number(cobertura.trim()), whatsappCompras: montarWhatsapp(ddi, numero), diaContagem: dia === '' ? null : Number(dia),
  }
  const errosCompras = comprasGravavel ? validarConfigCompras(configCompras) : []
  const [txt, setTxt] = useState<Record<keyof Taxas, string>>(() =>
    Object.fromEntries(CAMPOS.map((c) => [c.k, mostrar(inicial[c.k], c.pct)])) as Record<keyof Taxas, string>)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [salvando, start] = useTransition()
  const taxas = Object.fromEntries(CAMPOS.map((c) => [c.k, c.pct ? ler(txt[c.k]) / 100 : ler(txt[c.k])])) as Taxas
  const valido = CAMPOS.every((c) => Number.isFinite(taxas[c.k])) && errosCompras.length === 0
  const campo = 'h-10 rounded-[var(--r-md)] bg-surface-2 px-3 text-[15px] outline-none focus:ring-2 focus:ring-brand/40'

  return (
    <form className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"
      onSubmit={(e) => {
        e.preventDefault()
        setMsg(null)
        start(async () => {
          const r = await salvarTaxasCardapio(taxas, comprasGravavel ? configCompras : null)
          setMsg('error' in r ? { ok: false, texto: r.error } : { ok: true, texto: 'Salvo. Os preços sugeridos e a lista de compras já usam os valores novos.' })
        })
      }}>
      <div className="min-w-0 space-y-4">
      <div className="space-y-4 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Meta e taxas</h2>
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
      </div>
      <div className="space-y-4 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Compras e contagem</h2>
          <p className="text-[12px] text-text-muted">Usados na lista de compras do Estoque e no lembrete da contagem no Início.</p>
        </div>
        {!comprasGravavel && <p className="text-[13px] text-warn">Ainda não dá para salvar estes campos nesta base (migration 474 pendente).</p>}
        <label className="grid items-center gap-1 sm:grid-cols-[minmax(0,1fr)_140px] sm:gap-4">
          <span>
            <span className="block text-[14px] font-medium">Cobertura da compra</span>
            <span className="block text-[12px] text-text-muted">A lista sugere o suficiente para o consumo destes dias, de {COBERTURA_MIN} a {COBERTURA_MAX}.</span>
          </span>
          <span className="flex items-center gap-1.5">
            <input inputMode="numeric" value={cobertura} disabled={!comprasGravavel} onChange={(e) => setCobertura(e.target.value.replace(/\D/g, ''))}
              className={`num w-full text-right ${campo}`} />
            <span className="text-[13px] text-text-muted">dias</span>
          </span>
        </label>
        <div className="grid items-center gap-1 sm:grid-cols-[minmax(0,1fr)_260px] sm:gap-4">
          <span>
            <span className="block text-[14px] font-medium">WhatsApp de compras</span>
            <span className="block text-[12px] text-text-muted">Quem recebe a lista. Em branco, o WhatsApp pergunta o contato a cada envio.</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-[13px] text-text-muted">+</span>
            <input aria-label="Código do país" inputMode="numeric" value={ddi} disabled={!comprasGravavel} maxLength={3}
              onChange={(e) => setDdi(e.target.value.replace(/\D/g, ''))} className={`num w-[56px] text-center ${campo}`} />
            <input aria-label="DDD e número" inputMode="tel" value={numero} disabled={!comprasGravavel} placeholder="71 99999-9999"
              onChange={(e) => setNumero(e.target.value)} className={`num min-w-0 flex-1 ${campo}`} />
          </span>
        </div>
        {configCompras.whatsappCompras && !errosCompras.some((e) => e.startsWith('O WhatsApp')) && (
          <p className="-mt-2 text-right text-[12px] text-text-muted">Vai para {whatsappLegivel(configCompras.whatsappCompras)}</p>
        )}
        <label className="grid items-center gap-1 sm:grid-cols-[minmax(0,1fr)_200px] sm:gap-4">
          <span>
            <span className="block text-[14px] font-medium">Dia da contagem semanal</span>
            <span className="block text-[12px] text-text-muted">A partir deste dia o Início lembra de contar, até a contagem da semana ser feita.</span>
          </span>
          <select value={dia} disabled={!comprasGravavel} onChange={(e) => setDia(e.target.value)} className={`w-full ${campo}`}>
            <option value="">Desligada</option>
            {DIAS_SEMANA.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </label>
        {errosCompras.length > 0 && <p className="text-[13px] text-err">{errosCompras[0]}</p>}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button type="submit" disabled={salvando || !valido || !gravavel} className={btnClass('primary')}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          {msg && <span className={`text-[13px] ${msg.ok ? 'text-ok' : 'text-err'}`}>{msg.texto}</span>}
          {!gravavel && <span className="text-[13px] text-warn">Ainda não dá para salvar nesta base (migration 473 pendente).</span>}
        </div>
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
