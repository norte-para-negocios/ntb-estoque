import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChefHat, Settings2 } from 'lucide-react'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { exigirDev } from '@/lib/recursos-dev'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { DataTable } from '@/components/ui-kit/DataTable'
import { btnClass } from '@/components/ui-kit/Button'
import { CartaoResumo } from '@/components/faturamento/CartaoResumo'
import { BarraCmv } from '@/components/custo-cardapio/BarraCmv'
import { carregarBase, linhasDoCardapio, type LinhaPrato } from '@/lib/custo-cardapio/carregar'
import { arredondarPreco, resumir } from '@/lib/custo-cardapio/preco-puro'
import { brl, pct } from '@/lib/custo-cardapio/formato'

// Custo e Cardápio (só dev): cada prato com ficha, o custo pela ficha, o CMV contra a meta e o preço que bate a meta.
type Sp = { ver?: string; filtro?: string; familia?: string; q?: string; ord?: string }
const FILTROS = [
  { v: '', rotulo: 'Todos' },
  { v: 'acima', rotulo: 'Acima da meta' },
  { v: 'atencao', rotulo: 'Perto do limite' },
  { v: 'sem_preco', rotulo: 'Sem preço' },
  { v: 'faltando', rotulo: 'Insumo sem custo' },
  { v: 'suspeito', rotulo: 'Custo a conferir' },
] as const

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default async function CustoCardapioPage({ searchParams }: { searchParams: Promise<Sp> }) {
  await exigirDev()
  if (!(await getAtorGestao()).podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  const sp = await searchParams
  const base = await carregarBase(lojaId)
  if (!base) {
    return (
      <div className="space-y-4">
        <PageHeader title="Custo e Cardápio" icon={ChefHat} />
        <EmptyState icon={ChefHat} title="Esta loja não controla estoque" hint="O custo do prato sai das fichas técnicas e do custo dos insumos, que esta loja não tem." />
      </div>
    )
  }

  const ver: LinhaPrato['tipo'] = sp.ver === 'preparacoes' ? 'preparacao' : 'prato'
  const todas = linhasDoCardapio(base).filter((l) => l.tipo === ver)
  const familias = [...new Set(todas.map((l) => l.familia).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const familia = sp.familia && familias.includes(sp.familia) ? sp.familia : null
  const daFamilia = familia ? todas.filter((l) => l.familia === familia) : todas
  const resumo = resumir(daFamilia)
  const semCustoN = daFamilia.filter((l) => l.semCusto > 0).length
  const termo = sp.q?.trim() ? norm(sp.q.trim()) : null
  const filtro = FILTROS.some((f) => f.v === sp.filtro) ? (sp.filtro as string) : ''
  let lista = daFamilia.filter((l) =>
    (!termo || norm(l.descricao).includes(termo) || l.codigoTexto.includes(termo)) &&
    (filtro === '' || (filtro === 'faltando' ? l.semCusto > 0 : filtro === 'suspeito' ? l.suspeitos > 0 : l.situacao === filtro)))
  const ord = sp.ord === 'nome' ? 'nome' : sp.ord === 'custo' ? 'custo' : 'cmv'
  lista = [...lista].sort((a, b) =>
    ord === 'nome' ? a.descricao.localeCompare(b.descricao, 'pt-BR')
      : ord === 'custo' ? b.custo - a.custo
        : (b.situacao === 'suspeito' ? -1 : b.cmv ?? -1) - (a.situacao === 'suspeito' ? -1 : a.cmv ?? -1))

  const params: Record<string, string> = { ver: ver === 'preparacao' ? 'preparacoes' : '', filtro, familia: familia ?? '', q: sp.q ?? '', ord: ord === 'cmv' ? '' : ord }
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...params, ...over })) if (v) q.set(k, v)
    return `/custo-cardapio${q.size ? `?${q}` : ''}`
  }
  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chip = (ativo: boolean) => `${chipBase} ${ativo ? 'bg-brand-fill text-white' : 'bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text'}`
  const t = base.taxas
  const pratos = ver === 'prato'

  return (
    <div className="space-y-4">
      <PageHeader title="Custo e Cardápio" icon={ChefHat}
        description={`Quanto custa cada ${pratos ? 'prato' : 'preparação'} pela ficha técnica, contra o preço de venda e a meta de CMV de ${pct(t.metaCmv, 0)}.`}
        actions={<Link href="/custo-cardapio/taxas" className={btnClass('outline')}><Settings2 className="size-4" /> Meta e taxas</Link>} />

      {base.avisos.map((a) => <p key={a} className="rounded-[var(--r-md)] bg-warn/10 px-3 py-2 text-[13px] text-warn">{a}</p>)}

      <div className="flex flex-wrap items-center gap-2">
        <Link href={href({ ver: '', filtro: '' })} className={chip(pratos)}>Pratos</Link>
        <Link href={href({ ver: 'preparacoes', filtro: '' })} className={chip(!pratos)}>Preparações</Link>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <span className="text-[13px] text-text-muted">
          Custo dos insumos: {base.modo === 'omie' ? `custo médio do Omie${base.dataCusto ? ` em ${base.dataCusto.split('-').reverse().join('/')}` : ''}` : 'custo médio do estoque'}
        </span>
      </div>

      {pratos ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <CartaoResumo titulo="CMV do prato típico" valor={<span className={resumo.cmvMedio != null && resumo.cmvMedio > t.metaCmv ? 'text-err' : ''}>{pct(resumo.cmvMedio)}</span>} sub={`meta ${pct(t.metaCmv, 0)} · metade dos pratos fica abaixo`} />
          <CartaoResumo titulo="Acima da meta" valor={resumo.acima} sub={`mais ${resumo.atencao} perto do limite`} />
          <CartaoResumo titulo="Custo a conferir" valor={resumo.suspeitos} sub={`insumo com custo médio fora do normal${base.modo === 'omie' ? ' no Omie' : ''}`} />
          <CartaoResumo titulo="Sem preço ou custo" valor={resumo.semPreco + semCustoN} sub={`${resumo.semPreco} sem preço · ${semCustoN} com insumo sem custo`} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <CartaoResumo titulo="Preparações com ficha" valor={resumo.pratos} sub="custo pela ficha, por unidade do rendimento" />
          <CartaoResumo titulo="Insumo sem custo" valor={semCustoN} sub="o custo real é maior que o mostrado" />
          <CartaoResumo titulo="Custo a conferir" valor={daFamilia.filter((l) => l.suspeitos > 0).length} sub={`insumo com custo médio fora do normal${base.modo === 'omie' ? ' no Omie' : ''}`} />
        </div>
      )}

      <form action="/custo-cardapio" className="flex flex-wrap items-center gap-2">
        {Object.entries(params).filter(([k, v]) => v && k !== 'q').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input name="q" defaultValue={sp.q ?? ''} placeholder={`Buscar ${pratos ? 'prato' : 'preparação'} ou código`}
          className="h-9 w-full max-w-[320px] rounded-full bg-surface-2 px-4 text-[14px] outline-none focus:ring-2 focus:ring-brand/40" />
        <div className="flex gap-2 overflow-x-auto">
          {FILTROS.filter((f) => pratos || (f.v !== 'acima' && f.v !== 'atencao' && f.v !== 'sem_preco')).map((f) => (
            <Link key={f.v} href={href({ filtro: f.v })} className={chip(filtro === f.v)}>{f.rotulo}</Link>
          ))}
        </div>
      </form>

      {familias.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <Link href={href({ familia: '' })} className={chip(!familia)}>Todas as famílias</Link>
          {familias.map((f) => <Link key={f} href={href({ familia: f })} className={chip(familia === f)}>{f}</Link>)}
        </div>
      )}

      {lista.length === 0 ? (
        <EmptyState icon={ChefHat} title={todas.length ? 'Nada com esse filtro' : `Nenhum${pratos ? ' prato' : 'a preparação'} com ficha técnica`}
          hint={todas.length ? 'Tire um filtro ou mude a busca.' : 'As fichas técnicas ficam no cadastro do produto (Estrutura).'} />
      ) : (
        <DataTable minLargura="max-2xl:min-w-[1080px]">
          <thead>
            <tr>
              <th className="w-[34%]"><Link href={href({ ord: 'nome' })} className="hover:text-text">{pratos ? 'Prato' : 'Preparação'}</Link></th>
              <th className="w-[11%] text-right"><Link href={href({ ord: 'custo' })} className="hover:text-text">Custo</Link></th>
              {pratos && <th className="w-[11%] text-right">Preço</th>}
              {pratos && <th className="w-[18%]"><Link href={href({ ord: '' })} className="hover:text-text">CMV</Link></th>}
              {pratos && <th className="w-[13%] text-right">Preço p/ meta</th>}
              {pratos && <th className="w-[13%] text-right">Delivery p/ meta</th>}
              {!pratos && <th className="w-[20%]">Unidade</th>}
            </tr>
          </thead>
          <tbody>
            {lista.map((l) => (
              <tr key={l.codigo}>
                <td>
                  <Link href={`/custo-cardapio/${l.codigo}`} className="block min-w-0 hover:text-brand">
                    <span className="block truncate font-medium text-text">{l.descricao}</span>
                    <span className="block truncate text-[12px] text-text-muted">
                      {l.codigoTexto}{l.familia ? ` · ${l.familia}` : ''}{l.suspeitos > 0 ? ' · custo de insumo a conferir' : ''}{l.semCusto > 0 ? ` · ${l.semCusto} insumo${l.semCusto > 1 ? 's' : ''} sem custo` : ''}{l.ciclo ? ' · ficha em ciclo' : ''}
                    </span>
                  </Link>
                </td>
                <td className="num text-right">{brl(l.custo)}</td>
                {pratos && <td className="num text-right">{brl(l.preco)}</td>}
                {pratos && <td><BarraCmv cmv={l.cmv} meta={t.metaCmv} situacao={l.situacao} /></td>}
                {pratos && <td className="num text-right text-text-muted">{l.custo > 0 ? brl(arredondarPreco(l.sugeridoSalao)) : '—'}</td>}
                {pratos && <td className="num text-right text-text-muted">{l.custo > 0 ? brl(arredondarPreco(l.sugeridoDelivery)) : '—'}</td>}
                {!pratos && <td className="text-text-muted">{base.produtos.get(l.codigo)?.unidade ?? '—'}</td>}
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      <p className="text-[12px] text-text-muted">
        Preço p/ meta = custo ÷ {pct(t.metaCmv, 0)}. Delivery p/ meta = (custo + embalagem {brl(t.embalagem)}) ÷ ({pct(t.metaCmv, 0)} × o que sobra depois do app {pct(t.taxaDeliveryPct, 0)}, cartão {pct(t.taxaCartaoPct, 0)} e imposto {pct(t.impostoPct, 0)}). Arredondados para ,90.
      </p>
    </div>
  )
}
