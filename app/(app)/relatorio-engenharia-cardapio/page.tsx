import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LayoutGrid } from 'lucide-react'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { exigirDev } from '@/lib/recursos-dev'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { lerPeriodo } from '@/lib/faturamento-periodo'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { createServiceClient } from '@/lib/supabase/server'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { PeriodoBar } from '@/components/faturamento/PeriodoBar'
import { CartaoResumo } from '@/components/faturamento/CartaoResumo'
import { CLASSES, engenhariaCardapio, type ClasseCardapio, type LinhaVendida } from '@/lib/relatorios/engenharia-cardapio-puro'

// Fase 8, só desenvolvedor: matriz popularidade × margem dos pratos vendidos (base: lucro_proprio por produto).
type Sp = { ini?: string; fim?: string; mes?: string; ver?: string; familia?: string }

const n = (v: unknown) => Number(v) || 0
const fmtQtd = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
const fmtPct = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const COR: Record<ClasseCardapio, string> = {
  estrela: 'text-ok', carro_chefe: 'text-warn', oportunidade: 'text-brand', rever: 'text-err',
}

export default async function EngenhariaCardapioPage({ searchParams }: { searchParams: Promise<Sp> }) {
  await exigirDev()
  if (!(await getAtorGestao()).podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  const sp = await searchParams
  const hoje = hojeBahiaISO()
  const p = lerPeriodo(sp, hoje, 366)
  const ver = CLASSES.some((c) => c.classe === sp.ver) ? (sp.ver as ClasseCardapio) : null

  let erro: string | null = null
  const supabase = createServiceClient()
  const [linhas, prods] = await Promise.all([
    rpcTodos<Record<string, unknown>>(supabase, 'lucro_proprio',
      { p_loja: lojaId, p_ini: p.ini, p_fim: p.fim, p_dim: 'produto' }, (e) => { erro = e.message }),
    buscarTodasLinhas<{ descricao: string | null; descricao_familia: string | null }>((from, to) =>
      supabase.from('produtos').select('descricao, descricao_familia').eq('loja_id', lojaId).order('codigo_produto').range(from, to)),
  ])
  // O método compara pratos da mesma categoria (cerveja com cerveja, prato com prato): filtro por família.
  // lucro_proprio devolve a descrição do produto como rótulo; a família vem do cadastro pela mesma descrição.
  const familiaDe = new Map<string, string>()
  for (const x of prods ?? []) if (x.descricao) familiaDe.set(x.descricao, x.descricao_familia?.trim() || 'Sem família')
  const todas = ((linhas ?? []) as Record<string, unknown>[]).map((x) => ({ ...x, familia: familiaDe.get(String(x.rotulo ?? '')) ?? 'Sem família' }))
  const familias = [...new Set(todas.map((x) => x.familia))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const familia = sp.familia && familias.includes(sp.familia) ? sp.familia : null
  const r = engenhariaCardapio(todas.filter((x) => !familia || x.familia === familia).map((x): LinhaVendida => ({
    rotulo: String(x.rotulo ?? ''), quantidade: n(x.quantidade), faturamento: n(x.faturamento), cmv: n(x.cmv),
    itens_sem_baixa: n(x.itens_sem_baixa), itens_sem_custo: n(x.itens_sem_custo),
  })))
  const lista = ver ? r.itens.filter((i) => i.classe === ver) : r.itens
  const conta = (c: ClasseCardapio) => r.itens.filter((i) => i.classe === c)

  const base: Record<string, string> = { ini: p.ini, fim: p.fim, ver: ver ?? '', familia: familia ?? '' }
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) q.set(k, v)
    return `/relatorio-engenharia-cardapio${q.size ? `?${q}` : ''}`
  }
  const lucroHref = (rotulo: string) => `/relatorio-lucro?${new URLSearchParams({ data_inicio: p.ini, data_final: p.fim, dim: 'produto', q: rotulo })}`
  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chip = (ativo: boolean) => `${chipBase} ${ativo ? 'bg-brand-fill text-white' : 'bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text'}`
  const th = 'whitespace-nowrap px-3 py-2 text-[13px] font-semibold text-text-muted'

  return (
    <div className="space-y-4">
      <PageHeader title="Engenharia de cardápio" icon={LayoutGrid} voltarHref="/relatorios"
        description="Cada prato vendido no período, pela quantidade que sai e pelo lucro que deixa em cada unidade." />
      <PeriodoBar basePath="/relatorio-engenharia-cardapio" params={base} ini={p.ini} fim={p.fim} hoje={hoje} />
      {familias.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[13px] text-text-muted">Família:</span>
          <Link href={href({ familia: '', ver: '' })} className={chip(familia == null)}>Todas</Link>
          {familias.map((f) => <Link key={f} href={href({ familia: f, ver: '' })} className={chip(familia === f)}>{f}</Link>)}
        </div>
      )}
      {familia == null && familias.length > 1 && <p className="text-[13px] text-text-muted">Para comparar do jeito certo, escolha uma família: bebida se compara com bebida, prato com prato.</p>}

      {erro ? (
        <p role="alert" className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-err shadow-[var(--shadow-sm)]">Não foi possível carregar as vendas: {erro}</p>
      ) : r.itens.length === 0 ? (
        <EmptyState icon={LayoutGrid} title="Nenhum prato com custo vendido no período" hint={r.semCusto.length ? `${r.semCusto.length} prato(s) vendido(s) sem custo: lance a ficha técnica ou a nota do insumo.` : 'Escolha outro período.'} />
      ) : (
        <>
          <p className="text-[13px] text-text-muted">
            Vende muito = pelo menos {fmtQtd(r.corteQuantidade)} un. no período (70% da média por prato).
            Lucra bem = mais de <Money value={r.corteMargemUnit} /> por unidade (a média do cardápio).
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CLASSES.map((c) => {
              const itens = conta(c.classe)
              return (
                <Link key={c.classe} href={href({ ver: ver === c.classe ? '' : c.classe })}
                  className={`block rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] u-motion u-press-sm ${ver === c.classe ? 'ring-2 ring-brand' : ''}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className={`text-[15px] font-semibold ${COR[c.classe]}`}>{c.titulo}</h2>
                    <span className="num text-[22px] font-semibold text-text">{itens.length}</span>
                  </div>
                  <p className="mt-1 text-[13px] text-text-muted">{c.acao}</p>
                  <p className="mt-2 text-[12px] text-text-muted">
                    Lucro no período: <Money value={itens.reduce((s, i) => s + i.lucro, 0)} />
                    {itens.length ? ` · ${itens.slice(0, 3).map((i) => i.rotulo).join(', ')}${itens.length > 3 ? '…' : ''}` : ''}
                  </p>
                </Link>
              )
            })}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <CartaoResumo titulo="Pratos na conta" valor={r.itens.length.toLocaleString('pt-BR')} sub={`${fmtQtd(r.totalQuantidade)} un. vendidas`} />
            <CartaoResumo titulo="Lucro dos pratos" valor={<Money value={r.totalLucro} />} />
            <CartaoResumo titulo="Fora da conta" valor={r.semCusto.length.toLocaleString('pt-BR')} sub="vendidos sem custo" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={href({ ver: '' })} className={chip(ver == null)}>Todos</Link>
            {CLASSES.map((c) => <Link key={c.classe} href={href({ ver: c.classe })} className={chip(ver === c.classe)}>{c.titulo}</Link>)}
          </div>
          <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead><tr className="border-b border-border">
                <th className={`text-left ${th}`}>Prato</th><th className={`text-left ${th}`}>Grupo</th>
                <th className={`text-right ${th}`}>Vendidos</th><th className={`text-right ${th}`}>% das vendas</th>
                <th className={`text-right ${th}`}>Faturamento</th><th className={`text-right ${th}`}>Lucro por un.</th>
                <th className={`text-right ${th}`}>Margem</th><th className={`text-right ${th}`}>Lucro</th>
              </tr></thead>
              <tbody>
                {lista.map((i) => (
                  <tr key={i.rotulo} className="border-t border-border/60">
                    <td className="px-3 py-2">
                      <Link href={lucroHref(i.rotulo)} className="block max-w-[280px] truncate text-text hover:underline" title={i.rotulo}>{i.rotulo}</Link>
                      {i.custoIncompleto && <div className="text-[12px] text-warn">Parte das vendas sem custo: o lucro pode estar maior que o real</div>}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-2 text-[13px] font-medium ${COR[i.classe]}`}>{CLASSES.find((c) => c.classe === i.classe)!.titulo}</td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right text-text">{fmtQtd(i.quantidade)}</td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{fmtPct(i.participacao)}</td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right text-text"><Money value={i.faturamento} /></td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right text-text"><Money value={i.margemUnit} /></td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{fmtPct(i.margemPct)}</td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right font-medium text-text"><Money value={i.lucro} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.semCusto.length > 0 && (
            <details className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
              <summary className="cursor-pointer text-[14px] font-semibold text-text">{r.semCusto.length} prato(s) vendido(s) sem custo, fora da conta</summary>
              <p className="mt-1 text-[13px] text-text-muted">Sem ficha técnica ou sem nota do insumo, o lucro sairia 100%. Lance o custo e eles entram na matriz.</p>
              <ul className="mt-2 grid gap-1 text-[13px] sm:grid-cols-2">
                {r.semCusto.map((s) => (
                  <li key={s.rotulo} className="flex justify-between gap-2"><Link href={lucroHref(s.rotulo)} className="truncate text-text hover:underline">{s.rotulo}</Link><span className="num text-text-muted">{fmtQtd(s.quantidade)} un. · <Money value={s.faturamento} /></span></li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  )
}
