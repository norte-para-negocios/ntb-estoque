import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { carregarResumoDia, carregarPainelAcao, hojeBahia, type CategoriaKey, type Contagem, type Tom } from '@/lib/resumo-dia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { ResumoFiltros } from '@/components/resumo/ResumoFiltros'
import { ResumoGrafico } from '@/components/resumo/ResumoGrafico'
import { ErroDetalhe } from '@/components/resumo/ErroDetalhe'
import { SELO_CLASSE } from '@/lib/status-cor'
import { LayoutDashboard, Download, Inbox } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { PRODUTO_TIPO_ITEM, labelTipoItem } from '@/lib/constants-omie'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import { valoresMulti, type CampoFiltro } from '@/components/ui-kit/filtros-utils'

export const dynamic = 'force-dynamic'

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 12 })
const fmtMoeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Categorias do painel: cada uma é um filtro com a sua contagem e a sua lista.
const CATS: { key: CategoriaKey; label: string; valor: (c: Contagem) => string; sub?: (c: Contagem) => string | null }[] = [
  { key: 'notas', label: 'Notas Fiscais', valor: (c) => fmt(c.notas), sub: (c) => (c.valorNotas > 0 ? fmtMoeda(c.valorNotas) : null) },
  { key: 'transferencias', label: 'Transferências', valor: (c) => fmt(c.transferencias) },
  { key: 'inventarios', label: 'Inventários', valor: (c) => fmt(c.inventarios) },
  { key: 'producao', label: 'Produção', valor: (c) => fmt(c.opsConcluidas), sub: () => 'concluídas no período' },
  { key: 'etiquetas', label: 'Etiquetas', valor: (c) => fmt(c.etiquetas) },
  { key: 'erros', label: 'Erros', valor: (c) => fmt(c.erros) },
  { key: 'auditoria', label: 'Auditoria', valor: (c) => fmt(c.auditoria), sub: () => 'alterações' },
]
const KEYS = CATS.map((c) => c.key)

type PeriodoCob = 'dia' | 'semana' | 'mes'
type RowCobertura = { periodo_inicio: string; qtd_inventarios: number; produtos_contados: number; total_produtos: number }
type ProdutoSemContagem = { codigo: string; codigo_produto: number; descricao: string; tipo_item: string | null; descricao_familia: string | null }

export default async function ResumoPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string; loja?: string; cat?: string; periodo?: string; tipo?: string; local?: string }>
}) {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) notFound()

  const sp = await searchParams
  const hoje = hojeBahia()
  const data = sp.data && /^\d{4}-\d{2}-\d{2}$/.test(sp.data) && sp.data <= hoje ? sp.data : hoje
  const cat: CategoriaKey = KEYS.includes(sp.cat as CategoriaKey) ? (sp.cat as CategoriaKey) : 'notas'

  // Escopo: por padrão a LOJA ATUAL (igual ao resto do sistema). "todas" é opcional.
  const supabase = createServiceClient()
  const lojaAtual = await getCurrentLojaId()
  let lojaSel: number | null
  if (sp.loja === 'todas') lojaSel = null
  else if (sp.loja && ator.lojaIds.includes(Number(sp.loja))) lojaSel = Number(sp.loja)
  else lojaSel = ator.lojaIds.includes(lojaAtual) ? lojaAtual : (ator.lojaIds[0] ?? null)
  const lojaIdsEfetivos = lojaSel ? [lojaSel] : ator.lojaIds

  const { data: lojasRaw } = await supabase
    .from('lojas').select('id, nome, nome_fantasia').in('id', ator.lojaIds.length ? ator.lojaIds : [-1]).order('nome_fantasia')
  const lojas = (lojasRaw ?? []).map((l) => ({ id: l.id as number, nome: (l.nome_fantasia || l.nome || `Loja ${l.id}`) as string }))

  // Periodo GERAL do resumo (pedido reuniao 09/07: Augusto, gerente regional, quer
  // ver semanal/mensal, nao so diario) -- afeta TODAS as categorias, nao so a
  // auditoria (que ja usava esse mesmo periodo pra bucketing da cobertura desde
  // hoje de manha; unificado aqui num unico controle).
  const periodo: PeriodoCob = (['dia', 'semana', 'mes'] as const).includes(sp.periodo as PeriodoCob)
    ? (sp.periodo as PeriodoCob)
    : 'dia'
  const labelPeriodoResumo: Record<PeriodoCob, string> = { dia: 'Diário', semana: 'Semanal', mes: 'Mensal' }

  // carregarResumoDia e carregarPainelAcao nao dependem um do outro -- rodar
  // em paralelo evita pagar 2x a latencia Franca-Brasil (ver comentario em
  // lib/resumo-dia.ts:carregarPainelAcao).
  const [{ contagem, lista }, painelAcao] = await Promise.all([
    carregarResumoDia(lojaIdsEfetivos, data, cat, periodo),
    carregarPainelAcao(lojaIdsEfetivos),
  ])
  const catLabel = CATS.find((c) => c.key === cat)!.label

  const lojaParam = lojaSel != null ? String(lojaSel) : 'todas'
  const linkCat = (k: CategoriaKey) => `/resumo?data=${data}&loja=${lojaParam}&cat=${k}&periodo=${periodo}`
  const linkPeriodoResumo = (p: PeriodoCob) => `/resumo?data=${data}&loja=${lojaParam}&cat=${cat}&periodo=${p}`
  const pdfHref = `/resumo/imprimir?data=${data}&loja=${lojaParam}&cat=${cat}&periodo=${periodo}`

  const temStatus = lista.linhas.some((l) => l.status)
  const tomClasse: Record<Tom, string> = SELO_CLASSE as Record<Tom, string>

  let coberturaData: RowCobertura[] = []
  let produtosSemContagem: ProdutoSemContagem[] = []
  let totalSemContagem = 0
  let locaisOpcoes: { value: string; label: string }[] = []
  const tiposSel = valoresMulti(sp.tipo)
  const locaisSel = valoresMulti(sp.local).map(Number).filter((n) => !Number.isNaN(n))

  if (cat === 'auditoria' && lojaIdsEfetivos.length > 0) {
    const lojaIdCob = lojaIdsEfetivos[0]
    // Janela da barra de cobertura: 30d/12 semanas/12 meses
    const janelasDias: Record<PeriodoCob, number> = { dia: 30, semana: 84, mes: 365 }
    const dataIniCob = new Date(Date.now() - janelasDias[periodo] * 86400000).toISOString().slice(0, 10)

    // Cada inventário é feito num local de estoque específico (inventarios.codigo_local_estoque);
    // quando o filtro de local está ativo, só conta como "contado" o item cujo inventário
    // pai foi feito num dos locais selecionados.
    let recentsQuery = supabase
      .from('inventario_items')
      .select('produto_codigo_produto, inventarios!inner(codigo_local_estoque)')
      .eq('loja_id', lojaIdCob)
      .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())
    if (locaisSel.length) recentsQuery = recentsQuery.in('inventarios.codigo_local_estoque', locaisSel)

    const [cobRes, recentsRes, locaisRes] = await Promise.all([
      supabase.rpc('inventario_cobertura', {
        p_loja_id: lojaIdCob,
        p_ini: dataIniCob,
        p_fim: hoje,
        p_periodo: periodo,
      }),
      recentsQuery,
      supabase.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaIdCob).neq('inativo', 'S'),
    ])
    // Fix round 1 (achado da revisão): mesmo padrão de `.error` não checado já
    // corrigido em lib/resumo-dia.ts (carregarResumoDia/carregarPainelAcao) --
    // aqui uma falha transitória do Supabase fazia a barra de cobertura e a lista
    // "sem contagem" virarem silenciosamente "vazio"/0%, indistinguível de "não
    // tem dado de verdade". Só loga (não muda o comportamento em si).
    if (cobRes.error) console.error('resumo/page: falha ao carregar inventario_cobertura', cobRes.error)
    if (recentsRes.error) console.error('resumo/page: falha ao carregar inventario_items recentes', recentsRes.error)
    if (locaisRes.error) console.error('resumo/page: falha ao carregar local_estoques', locaisRes.error)

    coberturaData = (cobRes.data ?? []) as RowCobertura[]
    locaisOpcoes = (locaisRes.data ?? []).map((l) => ({
      value: String(l.codigo_local_estoque as number),
      label: (l.descricao as string | null) ?? String(l.codigo_local_estoque),
    }))

    const codigosRecentes = new Set(
      ((recentsRes.data ?? []) as { produto_codigo_produto: number | null }[])
        .map((r) => r.produto_codigo_produto)
        .filter((v): v is number => v != null)
    )

    let produtosQuery = supabase
      .from('produtos')
      .select('codigo, descricao, tipo_item, descricao_familia, codigo_produto')
      .eq('loja_id', lojaIdCob)
      .eq('inativo', false)
      .order('descricao')
      .limit(5000)
    if (tiposSel.length) produtosQuery = produtosQuery.in('tipo_item', tiposSel)

    const [produtosRawRes, posicaoRes] = await Promise.all([
      produtosQuery,
      // Restringe aos produtos que de fato têm posição num dos locais selecionados
      // (produto "não existe" nesse local não deveria aparecer como "não contado" nele).
      locaisSel.length
        ? supabase.from('posicao_estoques').select('codigo_produto').eq('loja_id', lojaIdCob).in('codigo_local_estoque', locaisSel)
        : Promise.resolve({ data: null, error: null }),
    ])
    const { data: produtosRaw, error: produtosErr } = produtosRawRes
    if (produtosErr) console.error('resumo/page: falha ao carregar produtos (sem contagem)', produtosErr)
    if (posicaoRes.error) console.error('resumo/page: falha ao carregar posicao_estoques', posicaoRes.error)

    const codigosNoLocal = locaisSel.length
      ? new Set(((posicaoRes.data ?? []) as { codigo_produto: number }[]).map((p) => p.codigo_produto))
      : null

    const semContagem = ((produtosRaw ?? []) as ProdutoSemContagem[])
      .filter((p) => !codigosRecentes.has(p.codigo_produto))
      .filter((p) => !codigosNoLocal || codigosNoLocal.has(p.codigo_produto))

    totalSemContagem = semContagem.length
    // codigo_produto (nao codigo) na key do React abaixo: "codigo" (SKU) NAO e
    // unico por loja -- achado real desta auditoria, produtos distintos (ex.:
    // variantes/kits) podem compartilhar o mesmo codigo (ver AGENTS.md, mesmo tipo
    // de achado ja visto em faturamento.ts com chave composta por string). Sem
    // isso o React colidia key duplicada e podia renderizar a linha errada.
    produtosSemContagem = semContagem.slice(0, 100).map(({ codigo, codigo_produto, descricao, tipo_item, descricao_familia }) => ({
      codigo, codigo_produto, descricao, tipo_item, descricao_familia,
    }))
  }

  const auditoriaCampos: CampoFiltro[] = [
    { tipo: 'multi-select', nome: 'tipo', label: 'Tipo de produto', opcoes: PRODUTO_TIPO_ITEM },
    { tipo: 'multi-select', nome: 'local', label: 'Local de estoque', opcoes: locaisOpcoes },
  ]
  const auditoriaDefaults = { data, loja: lojaParam, cat, periodo, tipo: sp.tipo ?? '', local: sp.local ?? '' }

  const labelJanela: Record<PeriodoCob, string> = { dia: 'últimos 30 dias', semana: 'últimas 12 semanas', mes: 'últimos 12 meses' }

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Resumo Operacional"
          icon={LayoutDashboard}
          description="O que aconteceu, por categoria — diário, semanal ou mensal"
          actions={
            <a href={pdfHref} target="_blank" rel="noopener noreferrer" className={btnClass('outline')}>
              <Download className="size-4" /> PDF
            </a>
          }
        />
        <ResumoFiltros data={data} lojaSel={lojaSel} lojas={lojas} hoje={hoje} cat={cat} />
      </ListaHeader>

      {painelAcao.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold text-text">Precisa de ação</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {painelAcao.map((it) => (
              <Link
                key={it.titulo}
                href={it.href}
                className={`flex items-center justify-between rounded-lg border p-3 text-sm hover:opacity-80 ${
                  it.tom === 'err' ? 'border-err/30 bg-err/10 text-err' : it.tom === 'warn' ? 'border-warn/30 bg-warn/10 text-warn' : 'border-info/30 bg-info/10 text-info'
                }`}
              >
                <span>{it.titulo}</span>
                <span className="num text-lg font-bold">{it.contagem}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Período GERAL: afeta todos os cards e a lista abaixo, não só a auditoria
          (pedido reuniao 09/07 -- Augusto, gerente regional, quer ver semanal/mensal). */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-text-muted">Período:</span>
        {(['dia', 'semana', 'mes'] as const).map((p) => (
          <Link
            key={p}
            href={linkPeriodoResumo(p)}
            className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
              periodo === p
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-border bg-surface text-text-muted hover:border-brand/40 hover:text-text'
            }`}
          >
            {labelPeriodoResumo[p]}
          </Link>
        ))}
      </div>

      {/* FILTRO POR CATEGORIA: cada tile mostra a contagem e seleciona a lista */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
        {CATS.map((c) => {
          const sel = c.key === cat
          const sub = c.sub?.(contagem)
          return (
            <Link
              key={c.key}
              href={linkCat(c.key)}
              aria-current={sel ? 'true' : undefined}
              className={`rounded-lg border px-4 py-3 u-motion u-press-sm ${
                sel ? 'border-brand bg-brand-soft' : 'border-border bg-surface hover:bg-surface-2'
              }`}
            >
              <div className="eyebrow">{c.label}</div>
              <div className={`num mt-1 text-2xl font-semibold tracking-tight ${sel ? 'text-brand' : 'text-text'}`}>
                {c.valor(contagem)}
              </div>
              {sub && <div className="mt-0.5 truncate text-[11px] text-text-muted">{sub}</div>}
            </Link>
          )
        })}
      </div>

      {/* GRÁFICO DA CATEGORIA (visão visual) */}
      {lista.grafico && lista.grafico.itens.length > 0 && <ResumoGrafico grafico={lista.grafico} />}

      {/* PAINEL DE INVENTÁRIO (só quando cat=auditoria) */}
      {cat === 'auditoria' && (
        <div className="space-y-3">
          {/* Chips de período (mesmo controle global do topo -- filtram tambem a lista "Sem contagem") */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-text-muted">Cobertura:</span>
            {(['dia', 'semana', 'mes'] as const).map((p) => (
              <Link
                key={p}
                href={linkPeriodoResumo(p)}
                className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                  periodo === p
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-border bg-surface text-text-muted hover:border-brand/40 hover:text-text'
                }`}
              >
                {labelPeriodoResumo[p]}
              </Link>
            ))}
            <span className="mx-1 h-4 w-px bg-border" />
            <FiltrosGaveta basePath="/resumo" campos={auditoriaCampos} defaults={auditoriaDefaults} naoContar={['data', 'loja', 'cat', 'periodo']} />
          </div>
          <ChipsFiltrosAtivos basePath="/resumo" campos={auditoriaCampos} />

          {/* Barra de cobertura por período */}
          {coberturaData.length > 0 ? (
            <div className="overflow-clip rounded-lg border border-border bg-surface">
              <div className="border-b border-border bg-surface-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Cobertura de contagem ({labelJanela[periodo]})
              </div>
              <div className="divide-y divide-border">
                {coberturaData.map((row) => {
                  const pct = row.total_produtos > 0
                    ? Math.round((Number(row.produtos_contados) / Number(row.total_produtos)) * 100)
                    : 0
                  const d = new Date(row.periodo_inicio + 'T12:00:00')
                  const label =
                    periodo === 'dia'
                      ? d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
                      : periodo === 'semana'
                      ? `Sem. de ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
                      : d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
                  return (
                    <div key={row.periodo_inicio} className="flex items-center gap-3 px-4 py-2">
                      <span className="w-40 shrink-0 text-[13px] capitalize text-text-muted">{label}</span>
                      <div className="min-w-0 flex-1">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                          <div
                            className={`h-full rounded-full transition-all ${pct >= 80 ? 'bg-ok' : pct >= 40 ? 'bg-warn' : 'bg-err/60'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <span className="w-20 shrink-0 text-right text-[12px] text-text-muted num">
                        {row.produtos_contados}/{row.total_produtos}
                      </span>
                      <span className={`w-10 shrink-0 text-right num text-[12px] font-medium ${pct >= 80 ? 'text-ok' : pct >= 40 ? 'text-warn' : 'text-err'}`}>
                        {pct}%
                      </span>
                      <span className="hidden w-20 shrink-0 text-right text-[11px] text-text-muted sm:block">
                        {row.qtd_inventarios} {Number(row.qtd_inventarios) === 1 ? 'inv.' : 'invs.'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-text-muted">
              Nenhum inventário encontrado no período.
            </div>
          )}

          {/* Produtos sem contagem nos últimos 30 dias */}
          {totalSemContagem > 0 && (
            <div className="overflow-clip rounded-lg border border-border bg-surface">
              <div className="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  Sem contagem nos últimos 30 dias
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${totalSemContagem > 0 ? 'bg-err/10 text-err' : 'bg-ok/10 text-ok'}`}>
                  {totalSemContagem} produto{totalSemContagem !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="divide-y divide-border">
                {produtosSemContagem.map((p) => (
                  <div key={p.codigo_produto} className="flex items-center gap-3 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-text">{formatarNomeProduto(p.descricao)}</p>
                      <div className="mt-0.5 flex gap-2">
                        <span className="num text-[11px] text-text-muted">{p.codigo}</span>
                        {p.descricao_familia && (
                          <span className="text-[11px] text-text-muted">{p.descricao_familia}</span>
                        )}
                      </div>
                    </div>
                    {p.tipo_item && (
                      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted">{labelTipoItem(p.tipo_item)}</span>
                    )}
                  </div>
                ))}
              </div>
              {totalSemContagem > 100 && (
                <div className="border-t border-border px-4 py-2 text-center text-[12px] text-text-muted">
                  Mostrando 100 de {totalSemContagem}. Acesse a tela de Inventários para ver todos.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* LISTA DA CATEGORIA SELECIONADA (detalhe) */}
      <div className="overflow-clip rounded-lg border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-text">
            {catLabel} <span className="text-text-muted">· {fmt(lista.total)}</span>
          </span>
          {lista.linhas.length < lista.total && (
            <span className="text-[11px] text-text-muted">mostrando {fmt(lista.linhas.length)} de {fmt(lista.total)}</span>
          )}
        </div>

        {lista.linhas.length === 0 ? (
          <EmptyState icon={Inbox} title={`Nenhum registro de ${catLabel.toLowerCase()} neste dia`} hint="Troque a categoria, a data ou a loja acima." />
        ) : (
          <table data-sticky-table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                {lista.colunas.map((col, i) => (
                  <th key={i} className={`px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted ${col.alinharDir ? 'text-right' : 'text-left'}`}>
                    {col.label}
                  </th>
                ))}
                {temStatus && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {lista.linhas.map((linha, ri) => (
                <tr key={ri} className="border-t border-border/60 even:bg-surface-2/30 hover:bg-surface-2/60">
                  {linha.celulas.map((cel, ci) => (
                    <td key={ci} className={`px-4 py-2 ${lista.colunas[ci]?.alinharDir ? 'num text-right' : 'text-text'} ${ci === 3 && cat === 'erros' ? 'max-w-xs truncate text-text-muted' : ''}`}>
                      {cel ?? '-'}
                    </td>
                  ))}
                  {temStatus && (
                    <td className="px-4 py-2 text-right">
                      {linha.status && (
                        cat === 'erros' && linha.detalhe ? (
                          <ErroDetalhe
                            label={linha.status.label}
                            tomClasse={tomClasse[linha.status.tom]}
                            mensagem={linha.detalhe}
                            titulo={linha.celulas[2] ?? 'Detalhe do erro'}
                          />
                        ) : (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tomClasse[linha.status.tom]}`}>
                            {linha.status.label}
                          </span>
                        )
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
