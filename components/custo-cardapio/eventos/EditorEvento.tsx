'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Trash2, UtensilsCrossed, X } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { SegmentedControl } from '@/components/ui-kit/SegmentedControl'
import { SeletorPratos, type OpcaoPrato } from '@/components/custo-cardapio/cardapios/SeletorPratos'
import { adicionarItemEvento, definirPorcoesItemEvento, excluirEvento, removerItemEvento, salvarEvento } from '@/lib/actions/cozinha-eventos'
import { NOME_STATUS, porcoesNoEvento, resumoEvento, STATUS_EVENTO, type StatusEvento } from '@/lib/custo-cardapio/eventos-puro'
import { lerPreco } from '@/lib/custo-cardapio/cardapios-puro'
import { brl, pct } from '@/lib/custo-cardapio/formato'

export type ItemEventoEditor = {
  itemId: number
  codigo: number
  descricao: string
  tipo: 'prato' | 'preparacao'
  unidade: string | null
  porcoesPorConvidado: number
  custoPorPorcao: number
  semCusto: number
  semFicha: boolean
}

export type CabecalhoEvento = {
  id: number
  nome: string
  dataEvento: string | null
  convidados: number
  status: StatusEvento
  precoPorPessoa: number | null
  obs: string | null
}

const fmtNum = (v: number | null, casas = 2) => (v == null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas }))
const fmtPreco = (v: number | null) => (v == null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const campo = 'h-10 w-full rounded-[var(--r-md)] bg-surface-2 px-3 text-[15px] outline-none focus:ring-2 focus:ring-brand/40'

export function EditorEvento({ evento, itens, opcoes, metaCmv }: { evento: CabecalhoEvento; itens: ItemEventoEditor[]; opcoes: OpcaoPrato[]; metaCmv: number }) {
  const router = useRouter()
  const [f, setF] = useState({
    nome: evento.nome, data: evento.dataEvento ?? '', convidados: String(evento.convidados), status: evento.status,
    preco: fmtPreco(evento.precoPorPessoa), obs: evento.obs ?? '',
  })
  const [porcoes, setPorcoes] = useState<Record<number, string>>({})
  const [pendente, start] = useTransition()

  const convidados = Math.max(Math.floor(Number(f.convidados) || 0), 0)
  const precoLido = lerPreco(f.preco)
  const preco = precoLido != null && !Number.isNaN(precoLido) && precoLido > 0 ? precoLido : null
  const lerPorcao = (i: ItemEventoEditor) => {
    const t = porcoes[i.itemId]
    if (t == null) return i.porcoesPorConvidado
    const v = lerPreco(t)
    return v != null && !Number.isNaN(v) && v > 0 ? v : 0
  }
  const contas = itens.filter((i) => !i.semFicha).map((i) => ({ porcoesPorConvidado: lerPorcao(i), custoPorPorcao: i.custoPorPorcao }))
  const r = resumoEvento(convidados, contas, metaCmv, preco)
  const mudouCabecalho = f.nome !== evento.nome || (f.data || null) !== evento.dataEvento || convidados !== evento.convidados || f.status !== evento.status
    || preco !== evento.precoPorPessoa || (f.obs.trim() || null) !== evento.obs
  const semCusto = useMemo(() => itens.reduce((a, i) => a + i.semCusto, 0), [itens])
  const acima = r.cmv != null && r.cmv > metaCmv + 1e-9

  const rodar = (fn: () => Promise<{ ok: true } | { error: string }>, sucesso?: string, depois?: () => void) =>
    start(async () => {
      const x = await fn()
      if ('error' in x) toast.error(x.error)
      else { if (sucesso) toast.success(sucesso); depois?.() }
    })

  const salvar = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (f.preco.trim() && (precoLido == null || Number.isNaN(precoLido))) { toast.error('Preço por pessoa inválido.'); return }
    rodar(() => salvarEvento(evento.id, { nome: f.nome, dataEvento: f.data || null, convidados, status: f.status, precoPorPessoa: preco, obs: f.obs }), 'Evento salvo')
  }

  const salvarPorcao = (i: ItemEventoEditor) => {
    const t = porcoes[i.itemId]
    if (t == null) return
    const v = lerPreco(t)
    const limpar = () => setPorcoes((p) => { const n = { ...p }; delete n[i.itemId]; return n })
    if (v == null || Number.isNaN(v) || v <= 0 || v > 100) { toast.error('Porções por convidado: use um número maior que zero (ex.: 0,5).'); limpar(); return }
    if (Math.abs(v - i.porcoesPorConvidado) < 1e-9) { limpar(); return }
    rodar(() => definirPorcoesItemEvento(i.itemId, v), undefined, limpar)
  }

  const excluir = () => {
    if (!window.confirm(`Excluir o evento “${evento.nome}”? Os pratos e fichas continuam como estão.`)) return
    start(async () => {
      const x = await excluirEvento(evento.id)
      if ('error' in x) { toast.error(x.error); return }
      toast.success('Evento excluído')
      router.push('/cozinha/eventos')
    })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <form onSubmit={salvar} className="grid gap-4 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:grid-cols-2 sm:p-5">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[13px] font-medium">Nome do evento</span>
            <input required maxLength={120} value={f.nome} onChange={(e) => setF((s) => ({ ...s, nome: e.target.value }))} className={campo} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium">Data</span>
            <input type="date" value={f.data} onChange={(e) => setF((s) => ({ ...s, data: e.target.value }))} className={campo} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium">Convidados</span>
            <input inputMode="numeric" value={f.convidados} onChange={(e) => setF((s) => ({ ...s, convidados: e.target.value.replace(/\D/g, '') }))} className={`${campo} num text-right`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium">Preço por pessoa</span>
            <input inputMode="decimal" value={f.preco} onChange={(e) => setF((s) => ({ ...s, preco: e.target.value }))} placeholder={r.precoSugeridoPorPessoa > 0 ? fmtPreco(r.precoSugeridoPorPessoa) : '0,00'} className={`${campo} num text-right`} />
            <span className="mt-1 block text-[12px] text-text-muted">O que o cliente paga por convidado.</span>
          </label>
          <div>
            <span className="mb-1 block text-[13px] font-medium">Situação</span>
            <SegmentedControl aria-label="Situação" value={f.status} onChange={(v) => setF((s) => ({ ...s, status: v as StatusEvento }))}
              opcoes={STATUS_EVENTO.map((s) => ({ value: s, label: NOME_STATUS[s] }))} />
          </div>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[13px] font-medium">Observações</span>
            <textarea rows={3} maxLength={2000} value={f.obs} onChange={(e) => setF((s) => ({ ...s, obs: e.target.value }))} placeholder="Local, horário, restrições…"
              className="w-full rounded-[var(--r-md)] bg-surface-2 px-3 py-2 text-[15px] outline-none focus:ring-2 focus:ring-brand/40" />
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button type="submit" disabled={pendente || !mudouCabecalho || !f.nome.trim() || convidados < 1} className={btnClass('primary')}>{pendente ? 'Salvando…' : 'Salvar'}</button>
            {mudouCabecalho && <span className="text-[13px] text-warn">Alterações não salvas. As listas abaixo usam o que está salvo.</span>}
            <button type="button" onClick={excluir} disabled={pendente} className={`${btnClass('dangerSoft')} ml-auto`}><Trash2 className="size-4" /> Excluir</button>
          </div>
        </form>

        <section className="rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-5">
            <div>
              <h2 className="text-[17px] font-semibold">O que vai ser servido</h2>
              <p className="text-[13px] text-text-muted">Porções por convidado: 1 = um prato por pessoa; 0,5 = metade dos convidados come.</p>
            </div>
            <SeletorPratos opcoes={opcoes} usados={itens.map((i) => i.codigo)} comPreparacoes rotulo="Adicionar prato"
              onEscolher={async (codigo) => {
                const x = await adicionarItemEvento(evento.id, codigo, 1)
                if ('error' in x) { toast.error(x.error); return false }
                return true
              }} />
          </div>
          {itens.length === 0 ? (
            <EmptyState icon={UtensilsCrossed} title="Nenhum prato ainda" hint="Adicione os pratos do evento para ver o custo por pessoa." />
          ) : (
            <ul className="mt-3 divide-y divide-border/60">
              {itens.map((i) => {
                const ppc = lerPorcao(i)
                const total = porcoesNoEvento(convidados, ppc)
                return (
                  <li key={i.itemId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_120px_110px_auto] sm:px-5">
                    <div className="min-w-0">
                      <Link href={`/cozinha/pratos/${i.codigo}`} className="block truncate font-medium hover:text-brand">{i.descricao}</Link>
                      <p className="truncate text-[12px] text-text-muted">
                        {i.semFicha ? <span className="text-warn">sem ficha ou inativo: fora da conta</span>
                          : <>{i.tipo === 'preparacao' ? 'preparação · ' : ''}<span className="num">{brl(i.custoPorPorcao)}</span> por {i.tipo === 'preparacao' ? (i.unidade ?? 'un').toLowerCase() : 'porção'} · <span className="num">{fmtNum(total, 1)}</span> no total</>}
                        {i.semCusto > 0 && !i.semFicha ? <span className="text-warn"> · {i.semCusto} insumo{i.semCusto > 1 ? 's' : ''} sem custo</span> : ''}
                      </p>
                    </div>
                    <button type="button" aria-label={`Tirar ${i.descricao} do evento`} disabled={pendente} onClick={() => rodar(() => removerItemEvento(i.itemId), `${i.descricao} saiu do evento`)}
                      className="flex size-8 items-center justify-center rounded-full text-text-muted hover:bg-surface-2 hover:text-err sm:order-last">
                      <X className="size-4" />
                    </button>
                    <label className="block">
                      <span className="sr-only">Porções por convidado de {i.descricao}</span>
                      <input inputMode="decimal" value={porcoes[i.itemId] ?? fmtNum(i.porcoesPorConvidado, 3)}
                        onChange={(e) => setPorcoes((p) => ({ ...p, [i.itemId]: e.target.value }))} onBlur={() => salvarPorcao(i)}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        className="num h-9 w-full rounded-[var(--r-md)] bg-surface-2 px-2.5 text-right text-[14px] outline-none focus:ring-2 focus:ring-brand/40" />
                      <span className="mt-0.5 block text-right text-[11px] text-text-muted">por convidado</span>
                    </label>
                    <p className="num text-right text-[13px]">
                      {i.semFicha ? '—' : brl(ppc * i.custoPorPorcao)}
                      <span className="block text-[11px] text-text-muted">por pessoa</span>
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="h-3" />
        </section>
      </div>

      <aside className="lg:sticky lg:top-4 lg:self-start">
        <section className="rounded-[var(--r-lg)] bg-surface p-5 shadow-[var(--shadow-sm)]">
          <p className="text-[13px] text-text-muted">Custo por pessoa</p>
          <p className="num mt-1 text-[36px] font-semibold leading-none tracking-[-0.03em]">{brl(r.custoPorPessoa)}</p>
          <p className="mt-1.5 text-[12px] text-text-muted">custo total <span className="num">{brl(r.custoTotal)}</span> para {convidados} convidado{convidados === 1 ? '' : 's'}</p>
          {semCusto > 0 && <p className="mt-1.5 text-[12px] text-warn">Algum insumo está sem custo: o custo real é maior.</p>}

          <div className="mt-4 border-t border-border/60 pt-4">
            <p className="text-[13px] text-text-muted">Preço sugerido por pessoa (meta {pct(metaCmv, 0)})</p>
            <div className="mt-1 flex items-end justify-between gap-3">
              <p className="num text-[24px] font-semibold tracking-[-0.02em]">{r.precoSugeridoPorPessoa > 0 ? brl(r.precoSugeridoPorPessoa) : '—'}</p>
              {r.precoSugeridoPorPessoa > 0 && Math.abs((preco ?? 0) - r.precoSugeridoPorPessoa) > 0.004 && (
                <button type="button" onClick={() => setF((s) => ({ ...s, preco: fmtPreco(r.precoSugeridoPorPessoa) }))} className="text-[13px] font-semibold text-brand hover:underline">Usar</button>
              )}
            </div>
          </div>

          <dl className="mt-4 space-y-2 border-t border-border/60 pt-4 text-[14px]">
            <div className="flex justify-between gap-3"><dt className="text-text-muted">Preço por pessoa</dt><dd className="num">{brl(preco)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-text-muted">Margem</dt>
              <dd className={`num font-semibold ${r.margem == null ? '' : acima ? 'text-err' : 'text-ok'}`}>{pct(r.margem)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-text-muted">CMV</dt><dd className={`num ${acima ? 'text-err' : ''}`}>{pct(r.cmv)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-text-muted">Receita</dt><dd className="num">{brl(r.receita)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-text-muted">Sobra depois da comida</dt><dd className="num font-semibold">{brl(r.sobra)}</dd></div>
          </dl>
          <p className="mt-3 text-[12px] text-text-muted">{r.margem == null ? 'Defina o preço por pessoa para ver a margem.' : acima ? `CMV acima da meta de ${pct(metaCmv, 0)}.` : `Dentro da meta de ${pct(metaCmv, 0)}.`} A sobra ainda paga equipe, impostos e custo fixo.</p>
        </section>
      </aside>
    </div>
  )
}
