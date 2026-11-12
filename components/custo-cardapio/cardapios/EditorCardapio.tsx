'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, ChefHat, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { BarraCmv } from '@/components/custo-cardapio/BarraCmv'
import { btnClass } from '@/components/ui-kit/Button'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { definirPrecoItemCardapio, definirPrecosCardapio, adicionarPratoCardapio, moverItemCardapio, removerItemCardapio } from '@/lib/actions/cozinha-cardapios'
import { contaDoItem, lerPreco, resumoDoCardapio, type CanalCardapio } from '@/lib/custo-cardapio/cardapios-puro'
import type { Taxas } from '@/lib/custo-cardapio/preco-puro'
import { brl, pct } from '@/lib/custo-cardapio/formato'
import { SeletorPratos, type OpcaoPrato } from './SeletorPratos'

export type ItemEditor = {
  itemId: number
  codigo: number
  codigoTexto: string
  descricao: string
  familia: string | null
  custo: number
  semCusto: number
  suspeitos: number
  semFicha: boolean
  precoCadastro: number | null
  precoProprio: number | null
}

const fmt = (v: number | null) => (v == null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export function EditorCardapio({ cardapioId, canal, itens, taxas, opcoes }: {
  cardapioId: number
  canal: CanalCardapio
  itens: ItemEditor[]
  taxas: Taxas
  opcoes: OpcaoPrato[]
}) {
  // Texto digitado por item (só enquanto difere do salvo).
  const [rascunho, setRascunho] = useState<Record<number, string>>({})
  const [pendente, start] = useTransition()
  const delivery = canal === 'delivery'

  const linhas = useMemo(() => itens.map((i) => {
    const txt = rascunho[i.itemId]
    const lido = txt == null ? i.precoProprio : lerPreco(txt)
    const precoProprio = lido != null && Number.isNaN(lido) ? null : lido
    return { i, conta: contaDoItem({ custo: i.custo, semCusto: i.semFicha ? 1 : i.semCusto, suspeitos: i.suspeitos, precoCadastro: i.precoCadastro, precoProprio }, canal, taxas) }
  }), [itens, rascunho, canal, taxas])
  const resumo = useMemo(() => resumoDoCardapio(linhas.map((l) => ({ conta: l.conta, custo: l.i.custo })), canal, taxas), [linhas, canal, taxas])

  const rodar = (f: () => Promise<{ ok: true } | { error: string }>, sucesso?: string, depois?: () => void) =>
    start(async () => {
      const r = await f()
      if ('error' in r) toast.error(r.error)
      else { if (sucesso) toast.success(sucesso); depois?.() }
    })

  const limparRascunho = (id: number) => setRascunho((r) => { const n = { ...r }; delete n[id]; return n })

  const salvarPreco = (i: ItemEditor) => {
    const txt = rascunho[i.itemId]
    if (txt == null) return
    const v = lerPreco(txt)
    if (v != null && (Number.isNaN(v) || v < 0.1)) { toast.error('Preço inválido.'); limparRascunho(i.itemId); return }
    const novo = v == null ? null : Math.round(v * 100) / 100
    if (novo === i.precoProprio) { limparRascunho(i.itemId); return }
    rodar(() => definirPrecoItemCardapio(i.itemId, novo), undefined, () => limparRascunho(i.itemId))
  }

  const usarSugerido = (i: ItemEditor, sugerido: number) => {
    setRascunho((r) => ({ ...r, [i.itemId]: fmt(sugerido) }))
    rodar(() => definirPrecoItemCardapio(i.itemId, sugerido), `Preço de ${i.descricao} neste cardápio: ${brl(sugerido)}`, () => limparRascunho(i.itemId))
  }

  const reprecar = resumo.reprecar.map((idx) => linhas[idx]).filter((l) => l.conta.sugerido > 0)
  const usarTodos = () => {
    if (!reprecar.length) return
    if (!window.confirm(`Usar o preço sugerido em ${reprecar.length} prato${reprecar.length > 1 ? 's' : ''}? Só muda o preço deste cardápio, nada no Omie nem no cadastro.`)) return
    rodar(() => definirPrecosCardapio(cardapioId, reprecar.map((l) => ({ itemId: l.i.itemId, preco: l.conta.sugerido }))), 'Preços sugeridos aplicados')
  }

  const melhor = resumo.melhor != null ? linhas[resumo.melhor] : null
  const pior = resumo.pior != null ? linhas[resumo.pior] : null
  const campo = 'num h-9 w-full rounded-[var(--r-md)] px-2.5 text-right text-[14px] outline-none focus:ring-2 focus:ring-brand/40'

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-5">
          <div>
            <h2 className="text-[17px] font-semibold">Pratos <span className="num font-normal text-text-muted">{itens.length}</span></h2>
            <p className="text-[13px] text-text-muted">Preço em branco usa o do cadastro. O preço daqui vale só para este cardápio.</p>
          </div>
          <SeletorPratos opcoes={opcoes} usados={itens.map((i) => i.codigo)} metaCmv={taxas.metaCmv}
            onEscolher={async (codigo) => {
              const r = await adicionarPratoCardapio(cardapioId, codigo)
              if ('error' in r) { toast.error(r.error); return false }
              return true
            }} />
        </div>

        {itens.length === 0 ? (
          <EmptyState icon={ChefHat} title="Nenhum prato ainda" hint="Adicione os pratos que entram neste cardápio para ver o CMV dele." />
        ) : (
          <ul className="mt-3 divide-y divide-border/60">
            {linhas.map(({ i, conta }, idx) => {
              const proprio = rascunho[i.itemId] ?? fmt(i.precoProprio)
              const mudouPreco = conta.fontePreco === 'proprio'
              return (
                <li key={i.itemId} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4 md:grid-cols-[auto_minmax(0,1fr)_84px_112px_170px_auto]">
                  <div className="flex flex-col">
                    <button type="button" aria-label={`Subir ${i.descricao}`} disabled={pendente || idx === 0} onClick={() => rodar(() => moverItemCardapio(i.itemId, 'cima'))}
                      className="flex size-6 items-center justify-center rounded-full text-text-muted enabled:hover:bg-surface-2 enabled:hover:text-text disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                    <button type="button" aria-label={`Descer ${i.descricao}`} disabled={pendente || idx === itens.length - 1} onClick={() => rodar(() => moverItemCardapio(i.itemId, 'baixo'))}
                      className="flex size-6 items-center justify-center rounded-full text-text-muted enabled:hover:bg-surface-2 enabled:hover:text-text disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                  </div>
                  <div className="min-w-0">
                    <Link href={`/cozinha/pratos/${i.codigo}`} className="block truncate font-medium hover:text-brand">{i.descricao}</Link>
                    <p className="truncate text-[12px] text-text-muted">
                      {i.semFicha ? <span className="text-warn">sem ficha ou inativo: fora da conta</span>
                        : <>custo <span className="num">{brl(i.custo)}</span>{delivery ? ` + embalagem ${brl(taxas.embalagem)}` : ''}{i.familia ? ` · ${i.familia}` : ''}</>}
                      {i.semCusto > 0 && !i.semFicha ? <span className="text-warn"> · {i.semCusto} insumo{i.semCusto > 1 ? 's' : ''} sem custo</span> : ''}
                    </p>
                  </div>
                  <button type="button" aria-label={`Tirar ${i.descricao} do cardápio`} disabled={pendente}
                    onClick={() => rodar(() => removerItemCardapio(i.itemId), `${i.descricao} saiu do cardápio`)}
                    className="col-start-3 row-start-1 flex size-8 items-center justify-center rounded-full text-text-muted hover:bg-surface-2 hover:text-err md:col-start-6">
                    <X className="size-4" />
                  </button>
                  <div className="col-span-3 grid grid-cols-[84px_112px_minmax(0,1fr)] items-center gap-3 md:col-span-3 md:col-start-3 md:row-start-1 md:grid-cols-[84px_112px_170px]">
                    <div className="text-right text-[12px] text-text-muted">
                      <span className="block">{delivery ? 'Sobra/pedido' : 'Sobra/venda'}</span>
                      <span className={`num block text-[13px] font-semibold ${conta.sobra != null && conta.sobra < 0 ? 'text-err' : 'text-text'}`}>{brl(conta.sobra)}</span>
                    </div>
                    <label className="block">
                      <span className="sr-only">Preço de {i.descricao} neste cardápio</span>
                      <input inputMode="decimal" value={proprio} placeholder={i.precoCadastro != null ? fmt(i.precoCadastro) : 'sem preço'}
                        onChange={(e) => setRascunho((r) => ({ ...r, [i.itemId]: e.target.value }))}
                        onBlur={() => salvarPreco(i)}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') limparRascunho(i.itemId) }}
                        className={`${campo} ${mudouPreco ? 'bg-brand-soft font-semibold text-brand' : 'bg-surface-2'}`} />
                      <span className="mt-0.5 block text-right text-[11px] text-text-muted">{mudouPreco ? (i.precoCadastro != null ? `cadastro ${brl(i.precoCadastro)}` : 'preço deste cardápio') : 'preço do cadastro'}</span>
                    </label>
                    <div className="min-w-0">
                      <BarraCmv cmv={conta.cmv} meta={taxas.metaCmv} situacao={conta.situacao} />
                      {conta.sugerido > 0 && (conta.situacao === 'acima' || conta.situacao === 'atencao' || conta.situacao === 'sem_preco') ? (
                        <button type="button" disabled={pendente} onClick={() => usarSugerido(i, conta.sugerido)}
                          className="num mt-1 block text-[12px] font-semibold text-brand hover:underline">Usar {brl(conta.sugerido)}</button>
                      ) : conta.sugerido > 0 ? <span className="num mt-1 block text-[12px] text-text-muted">meta: {brl(conta.sugerido)}</span> : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <p className="px-4 pb-4 pt-2 text-[12px] text-text-muted sm:px-5">
          {delivery
            ? `CMV no delivery = (custo + embalagem) ÷ o que sobra do preço depois do app ${pct(taxas.taxaDeliveryPct, 0)}, cartão ${pct(taxas.taxaCartaoPct, 0)} e imposto ${pct(taxas.impostoPct, 0)}. Meta ${pct(taxas.metaCmv, 0)}.`
            : `CMV = custo ÷ preço. Meta ${pct(taxas.metaCmv, 0)}. Sobra = preço menos imposto ${pct(taxas.impostoPct, 0)}, cartão ${pct(taxas.taxaCartaoPct, 0)} e custo.`}
        </p>
      </section>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <section className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5">
          <p className="text-[13px] text-text-muted">CMV do cardápio</p>
          <p className={`num mt-1 text-[36px] font-semibold leading-none tracking-[-0.03em] ${resumo.cmvCardapio == null ? 'text-text-muted' : resumo.cmvCardapio > taxas.metaCmv ? 'text-err' : 'text-ok'}`}>{pct(resumo.cmvCardapio)}</p>
          <p className="mt-1.5 text-[12px] text-text-muted">um de cada prato · prato típico {pct(resumo.cmvTipico)} · meta {pct(taxas.metaCmv, 0)}</p>
          <dl className="mt-4 space-y-2 text-[13px]">
            <div className="flex justify-between gap-3"><dt className="text-text-muted">Acima da meta</dt><dd className={`num font-semibold ${resumo.acima ? 'text-err' : ''}`}>{resumo.acima}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-text-muted">Perto do limite</dt><dd className={`num font-semibold ${resumo.atencao ? 'text-warn' : ''}`}>{resumo.atencao}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-text-muted">Sem preço</dt><dd className="num font-semibold">{resumo.semPreco}</dd></div>
            {resumo.aConferir > 0 && <div className="flex justify-between gap-3"><dt className="text-text-muted">Custo a conferir</dt><dd className="num font-semibold text-warn">{resumo.aConferir}</dd></div>}
          </dl>
          {(melhor || pior) && (
            <dl className="mt-4 space-y-2 border-t border-border/60 pt-4 text-[13px]">
              {melhor && <div><dt className="text-text-muted">Melhor prato</dt><dd className="flex justify-between gap-2"><span className="truncate">{melhor.i.descricao}</span><span className="num shrink-0 text-ok">{pct(melhor.conta.cmv)}</span></dd></div>}
              {pior && <div><dt className="text-text-muted">Pior prato</dt><dd className="flex justify-between gap-2"><span className="truncate">{pior.i.descricao}</span><span className={`num shrink-0 ${pior.conta.cmv != null && pior.conta.cmv > taxas.metaCmv ? 'text-err' : ''}`}>{pct(pior.conta.cmv)}</span></dd></div>}
            </dl>
          )}
        </section>

        {reprecar.length > 0 && (
          <section className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5">
            <h3 className="text-[15px] font-semibold">Para repreçar</h3>
            <p className="text-[12px] text-text-muted">Acima ou perto da meta, do pior para o menos ruim.</p>
            <ul className="mt-3 space-y-2 text-[13px]">
              {reprecar.slice(0, 8).map(({ i, conta }) => (
                <li key={i.itemId} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{i.descricao}</span>
                  <span className="num shrink-0 text-text-muted">{brl(conta.preco)} → <span className="font-semibold text-text">{brl(conta.sugerido)}</span></span>
                </li>
              ))}
              {reprecar.length > 8 && <li className="text-[12px] text-text-muted">e mais {reprecar.length - 8}</li>}
            </ul>
            <button type="button" disabled={pendente} onClick={usarTodos} className={`${btnClass('outline')} mt-3 w-full`}>
              <Sparkles className="size-4" /> Usar os preços sugeridos
            </button>
            <p className="mt-2 text-[11px] text-text-muted">Muda só o preço deste cardápio. O cadastro e o Omie ficam como estão.</p>
          </section>
        )}
      </aside>
    </div>
  )
}
