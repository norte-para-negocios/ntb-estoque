import Link from 'next/link'
import { Carrot } from 'lucide-react'
import { getCurrentLojaId } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { DataTable } from '@/components/ui-kit/DataTable'
import { CartaoResumo } from '@/components/faturamento/CartaoResumo'
import { dataCurta, dataLonga } from '@/components/custo-cardapio/inicio/Secao'
import { comprasRecentes, custoDeAntes, dadosInsumos, variacoes } from '@/lib/custo-cardapio/insumos'
import { pct } from '@/lib/custo-cardapio/formato'
import { formatCustoUnit } from '@/lib/num-br'

// Norte Cozinha, Insumos: tudo o que entra nas fichas (folhas), com custo médio, quanto mudou no mês,
// em quantos pratos entra e de quem foi comprado por último. Só leitura.
// Consultas: carregarBase (cache), custoDeAntes (foto de ~30 dias) e a função da Sugestão de compra (1 RPC).

type Sp = { q?: string; familia?: string; filtro?: string; ord?: string }
const FILTROS = [
  { v: '', rotulo: 'Todos' },
  { v: 'subiu', rotulo: 'Subiu no mês' },
  { v: 'sem_custo', rotulo: 'Sem custo' },
  { v: 'conferir', rotulo: 'Custo a conferir' },
] as const
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default async function InsumosPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams
  const lojaId = await getCurrentLojaId()
  const d = await dadosInsumos(lojaId)
  if (!d) {
    return (
      <div className="space-y-4">
        <PageHeader title="Insumos" icon={Carrot} />
        <EmptyState icon={Carrot} title="Esta loja não controla estoque" hint="Os insumos saem das fichas técnicas e do custo do estoque, que esta loja não tem." />
      </div>
    )
  }
  const { base } = d
  const [antes, compras] = await Promise.all([custoDeAntes(lojaId, base.modo, base.dataCusto), comprasRecentes(lojaId, base.modo)])
  const vars = variacoes(d, antes)

  const ativos = d.insumos.filter((i) => !i.inativo)
  const familias = [...new Set(ativos.map((i) => i.familia).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const familia = sp.familia && familias.includes(sp.familia) ? sp.familia : null
  const daFamilia = familia ? ativos.filter((i) => i.familia === familia) : ativos
  const filtro = FILTROS.some((f) => f.v === sp.filtro) ? (sp.filtro as string) : ''
  const termo = sp.q?.trim() ? norm(sp.q.trim()) : null
  const subiu = (cod: number) => (vars.get(cod) ?? 0) >= 0.03
  let lista = daFamilia.filter((i) =>
    (!termo || norm(i.descricao).includes(termo) || i.codigoTexto.toLowerCase().includes(termo)) &&
    (filtro === '' || (filtro === 'sem_custo' ? i.custo == null : filtro === 'conferir' ? i.suspeito : subiu(i.codigo))))
  const ord = ['custo', 'variacao', 'uso'].includes(sp.ord ?? '') ? sp.ord! : filtro === 'subiu' ? 'variacao' : 'nome'
  lista = [...lista].sort((a, b) =>
    ord === 'custo' ? (b.custo ?? -1) - (a.custo ?? -1)
      : ord === 'variacao' ? (vars.get(b.codigo) ?? -9) - (vars.get(a.codigo) ?? -9)
        : ord === 'uso' ? b.pratos + b.preparacoes - (a.pratos + a.preparacoes)
          : a.descricao.localeCompare(b.descricao, 'pt-BR'))

  const params: Record<string, string> = { filtro, familia: familia ?? '', q: sp.q ?? '', ord: sp.ord && ord !== 'nome' ? ord : '' }
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...params, ...over })) if (v) q.set(k, v)
    return `/cozinha/insumos${q.size ? `?${q}` : ''}`
  }
  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chip = (ativo: boolean) => `${chipBase} ${ativo ? 'bg-brand-fill text-white' : 'bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text'}`
  const subiram = daFamilia.filter((i) => subiu(i.codigo)).length

  return (
    <div className="space-y-4">
      <PageHeader title="Insumos" icon={Carrot}
        description="Tudo o que entra nas fichas técnicas: quanto custa, quanto mudou no mês e em quantos pratos entra." />
      {base.avisos.map((a) => <p key={a} className="rounded-[var(--r-md)] bg-warn/10 px-3 py-2 text-[13px] text-warn">{a}</p>)}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CartaoResumo titulo="Insumos nas fichas" valor={daFamilia.length} sub={`custo ${base.modo === 'omie' ? `médio do Omie${base.dataCusto ? ` em ${dataLonga(base.dataCusto)}` : ''}` : 'médio do estoque'}`} />
        <CartaoResumo titulo="Subiram no mês" valor={antes ? subiram : '—'} sub={antes ? `3% ou mais desde ${dataLonga(antes.data)}` : 'sem foto de 30 dias atrás'} />
        <CartaoResumo titulo="Sem custo" valor={daFamilia.filter((i) => i.custo == null).length} sub="o prato que usa fica mais barato do que é" />
        <CartaoResumo titulo="Custo a conferir" valor={daFamilia.filter((i) => i.suspeito).length} sub="custo fora do normal para a unidade" />
      </div>

      <form action="/cozinha/insumos" className="flex flex-wrap items-center gap-2">
        {Object.entries(params).filter(([k, v]) => v && k !== 'q').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Buscar insumo ou código"
          className="h-9 w-full max-w-[320px] rounded-full bg-surface-2 px-4 text-[14px] outline-none focus:ring-2 focus:ring-brand/40" />
        <div className="flex gap-2 overflow-x-auto">
          {FILTROS.map((f) => <Link key={f.v} href={href({ filtro: f.v, ord: '' })} className={chip(filtro === f.v)}>{f.rotulo}</Link>)}
        </div>
      </form>

      {familias.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <Link href={href({ familia: '' })} className={chip(!familia)}>Todas as famílias</Link>
          {familias.map((f) => <Link key={f} href={href({ familia: f })} className={chip(familia === f)}>{f}</Link>)}
        </div>
      )}

      {compras.erro && <p className="text-[12px] text-text-muted">Não deu para ler o último fornecedor agora.</p>}

      {lista.length === 0 ? (
        <EmptyState icon={Carrot} title={ativos.length ? 'Nada com esse filtro' : 'Nenhum insumo nas fichas'}
          hint={ativos.length ? 'Tire um filtro ou mude a busca.' : 'As fichas técnicas ficam no cadastro do produto (Estrutura).'} />
      ) : (
        <DataTable minLargura="max-2xl:min-w-[1000px]">
          <thead>
            <tr>
              <th className="w-[32%]"><Link href={href({ ord: '' })} className="hover:text-text">Insumo</Link></th>
              <th className="w-[14%] text-right"><Link href={href({ ord: 'custo' })} className="hover:text-text">Custo médio</Link></th>
              <th className="w-[11%] text-right"><Link href={href({ ord: 'variacao' })} className="hover:text-text">No mês</Link></th>
              <th className="w-[12%] text-right"><Link href={href({ ord: 'uso' })} className="hover:text-text">Usado em</Link></th>
              <th className="w-[31%]">Última compra</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((i) => {
              const v = vars.get(i.codigo)
              const c = compras.porProduto.get(i.codigo)
              return (
                <tr key={i.codigo}>
                  <td>
                    <Link href={`/cozinha/insumos/${i.codigo}`} className="block min-w-0 hover:text-brand">
                      <span className="block truncate font-medium text-text">{i.descricao}</span>
                      <span className="block truncate text-[12px] text-text-muted">{i.codigoTexto}{i.familia ? ` · ${i.familia}` : ''}{i.unidade ? ` · ${i.unidade.toLowerCase()}` : ''}</span>
                    </Link>
                  </td>
                  <td className={`num text-right ${i.custo == null || i.suspeito ? 'text-warn' : ''}`} title={i.suspeito ? 'Custo fora do normal para a unidade: confira a última entrada' : undefined}>
                    {i.custo == null ? 'sem custo' : formatCustoUnit(i.custo, i.unidade)}
                    {i.suspeito && <span className="block text-[12px]">conferir</span>}
                  </td>
                  <td className={`num text-right ${v == null ? 'text-text-muted' : v >= 0.03 ? 'text-err' : v <= -0.03 ? 'text-ok' : 'text-text-muted'}`}>
                    {v == null ? '—' : `${v > 0 ? '+' : ''}${pct(v)}`}
                  </td>
                  <td className="num text-right text-text-muted">
                    {i.pratos} {i.pratos === 1 ? 'prato' : 'pratos'}
                    {i.preparacoes > 0 && <span className="block text-[12px]">{i.preparacoes} {i.preparacoes === 1 ? 'preparação' : 'preparações'}</span>}
                  </td>
                  <td className="min-w-0">
                    {c?.fornecedor || c?.ultimoCusto ? (
                      <>
                        <span className="block truncate text-text">{c.fornecedor ?? 'Fornecedor não informado'}</span>
                        <span className="num block truncate text-[12px] text-text-muted">{c.ultimoCusto != null ? formatCustoUnit(c.ultimoCusto, i.unidade) : '—'}{c.ultimaCompra ? ` · ${dataCurta(c.ultimaCompra)}/${c.ultimaCompra.slice(2, 4)}` : ''}</span>
                      </>
                    ) : <span className="text-text-muted">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </DataTable>
      )}
      <p className="text-[12px] text-text-muted">
        Insumo = produto usado em alguma ficha técnica que não tem ficha própria. &quot;No mês&quot; compara o custo médio de hoje com o de{' '}
        {antes ? dataLonga(antes.data) : '30 dias atrás'}; saltos de 5 vezes ou mais ficam de fora (quase sempre unidade trocada na entrada).
        Último custo = valor da nota ÷ quantidade que entrou no estoque.
      </p>
    </div>
  )
}
