'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CookingPot, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { Combobox } from '@/components/ui-kit/Combobox'
import { Spinner } from '@/components/ui-kit/Spinner'
import { fmtBRL, fmtQtd } from '@/components/estoque-proprio/Apresentacao'
import { produzirLoteAction } from '@/lib/actions/ficha-tecnica'
import { previaProducao, type Ficha } from '@/lib/estoque/receita'

type ProdutoProduzivel = { codigoProduto: number; descricao: string; codigo: string; unidade: string; ficha: Ficha }
type Local = { codigoLocal: number; descricao: string; padrao: boolean }

const campo = 'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-sm text-text outline-none max-sm:text-base focus:ring-2 focus:ring-brand/40'

export function ProduzirLote({
  produtos, fichas, cmc, nomes, saldos, locais,
}: {
  produtos: ProdutoProduzivel[]
  fichas: Ficha[]
  cmc: [number, number][]
  nomes: { codigoProduto: number; descricao: string; unidade: string }[]
  saldos: { local: number; produto: number; saldo: number }[]
  locais: Local[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const padrao = locais.find((l) => l.padrao)?.codigoLocal ?? locais[0]?.codigoLocal ?? ''
  const [produto, setProduto] = useState('')
  const [qtd, setQtd] = useState('')
  const [consumo, setConsumo] = useState<number | ''>(padrao)
  const [destino, setDestino] = useState<number | ''>(padrao)
  const [obs, setObs] = useState('')
  // Uma chave por "tentativa": clique duplo reenvia a mesma e o banco devolve a mesma ordem.
  const [ref, setRef] = useState(() => `prod-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)

  const mapaFichas = useMemo(() => new Map(fichas.map((f) => [f.codigoProduto, f])), [fichas])
  const mapaCmc = useMemo(() => new Map(cmc), [cmc])
  const nome = useMemo(() => new Map(nomes.map((n) => [n.codigoProduto, n])), [nomes])
  const sel = produtos.find((p) => String(p.codigoProduto) === produto)
  const q = Number(qtd.replace(',', '.'))

  const previa = useMemo(() => {
    if (!sel || !(q > 0)) return null
    try { return previaProducao(mapaFichas, mapaCmc, sel.codigoProduto, q) } catch { return null }
  }, [sel, q, mapaFichas, mapaCmc])

  const linhas = (previa?.insumos ?? []).map((i) => {
    const saldo = consumo === '' ? 0 : saldos.find((s) => s.local === consumo && s.produto === i.codigoInsumo)?.saldo ?? 0
    return { ...i, saldo, faltara: saldo < i.quantidade }
  })
  const faltam = linhas.filter((l) => l.faltara).length

  function produzir() {
    if (!sel || !(q > 0) || consumo === '' || destino === '') { toast.error('Escolha o preparo, a quantidade e os locais'); return }
    start(async () => {
      const r = await produzirLoteAction({ codigoProduto: sel.codigoProduto, quantidade: q, localConsumo: consumo, localDestino: destino, obs, ref })
      if ('error' in r) { toast.error('Não foi possível produzir', { description: r.error }); return }
      toast.success(r.duplicado ? 'Este lote já tinha sido registrado' : 'Lote produzido', { description: `Custo por ${sel.unidade}: ${fmtBRL(r.custoUnitario)}` })
      setQtd(''); setObs(''); setProduto('')
      setRef(`prod-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
      router.refresh()
    })
  }

  if (!produtos.length) {
    return (
      <section className="rounded-[var(--r-lg)] bg-surface p-5 u-card">
        <div className="flex items-center gap-2 text-[15px] font-semibold"><CookingPot className="size-4 text-text-muted" />Produzir lote</div>
        <p className="mt-1 text-[13px] text-text-muted">Ainda não há nenhuma ficha técnica ativa. Monte a ficha de um molho ou preparo em Fichas técnicas.</p>
      </section>
    )
  }

  return (
    <section className="rounded-[var(--r-lg)] bg-surface p-4 u-card sm:p-5" aria-label="Produzir lote">
      <div className="flex items-center gap-2 text-[15px] font-semibold"><CookingPot className="size-4 text-text-muted" />Produzir lote</div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <label className="mb-1 block text-[13px] font-medium">Preparo</label>
          <Combobox options={produtos.map((p) => ({ value: String(p.codigoProduto), label: `${p.descricao} · ${p.codigo}` }))} value={produto} onChange={setProduto} placeholder="Escolha o preparo" />
        </div>
        <div>
          <label htmlFor="qtd-lote" className="mb-1 block text-[13px] font-medium">Quantidade</label>
          <div className="relative">
            <input id="qtd-lote" inputMode="decimal" className={`${campo} pr-12 num`} value={qtd} onChange={(e) => setQtd(e.target.value)} placeholder="0" />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-text-muted">{sel?.unidade ?? ''}</span>
          </div>
        </div>
        <div>
          <label htmlFor="loc-consumo" className="mb-1 block text-[13px] font-medium">Tira os insumos de</label>
          <select id="loc-consumo" className={campo} value={consumo} onChange={(e) => setConsumo(Number(e.target.value))}>
            {locais.map((l) => <option key={l.codigoLocal} value={l.codigoLocal}>{l.descricao}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="loc-destino" className="mb-1 block text-[13px] font-medium">Entrega o pronto em</label>
          <select id="loc-destino" className={campo} value={destino} onChange={(e) => setDestino(Number(e.target.value))}>
            {locais.map((l) => <option key={l.codigoLocal} value={l.codigoLocal}>{l.descricao}</option>)}
          </select>
        </div>
      </div>

      {previa && sel && (
        <div className="mt-4 rounded-[var(--r-md)] bg-surface-2 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold">Vai consumir</span>
            <span className="text-[13px] text-text-muted num">Custo do lote <b className="text-text">{fmtBRL(previa.custoTotal)}</b> · {fmtBRL(previa.custoUnitario)} por {sel.unidade}</span>
          </div>
          <ul className="mt-2 divide-y divide-[var(--border)] text-[13px]">
            {linhas.map((l) => {
              const n = nome.get(l.codigoInsumo)
              return (
                <li key={l.codigoInsumo} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate">{n?.descricao ?? l.codigoInsumo}</span>
                  <span className={`num whitespace-nowrap ${l.faltara ? 'font-semibold text-warn' : ''}`}>
                    {fmtQtd(l.quantidade)} {n?.unidade ?? ''} <span className="text-[12px] font-normal text-text-muted">(tem {fmtQtd(l.saldo)})</span>
                  </span>
                </li>
              )
            })}
          </ul>
          {faltam > 0 && (
            <p className="mt-2 flex items-start gap-1.5 text-[12px] text-warn"><TriangleAlert className="mt-px size-3.5 shrink-0" />{faltam} insumo{faltam === 1 ? '' : 's'} sem saldo suficiente neste local. O lote pode ser produzido: o saldo vai ficar negativo e entra no alerta de itens negativos.</p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input aria-label="Observação" className={`${campo} sm:max-w-[320px]`} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (opcional)" maxLength={200} />
        <button type="button" onClick={produzir} disabled={pending || !sel || !(q > 0)} className={btnClass('primary')}>
          {pending && <Spinner />}Produzir lote
        </button>
      </div>
    </section>
  )
}
