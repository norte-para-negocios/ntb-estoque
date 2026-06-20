import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { carregarResumoDia, hojeBahia, type CategoriaKey, type Contagem, type Tom } from '@/lib/resumo-dia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { ResumoFiltros } from '@/components/resumo/ResumoFiltros'
import { SELO_CLASSE } from '@/lib/status-cor'
import { LayoutDashboard, Download, Inbox } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'

export const dynamic = 'force-dynamic'

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 12 })
const fmtMoeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Categorias do painel: cada uma é um filtro com a sua contagem e a sua lista.
const CATS: { key: CategoriaKey; label: string; valor: (c: Contagem) => string; sub?: (c: Contagem) => string | null }[] = [
  { key: 'notas', label: 'Notas Fiscais', valor: (c) => fmt(c.notas), sub: (c) => (c.valorNotas > 0 ? fmtMoeda(c.valorNotas) : null) },
  { key: 'transferencias', label: 'Transferências', valor: (c) => fmt(c.transferencias) },
  { key: 'inventarios', label: 'Inventários', valor: (c) => fmt(c.inventarios) },
  { key: 'producao', label: 'Produção', valor: (c) => fmt(c.opsConcluidas), sub: (c) => `${fmt(c.opsPrevistas)} previstas` },
  { key: 'movimentacoes', label: 'Movimentações', valor: (c) => fmt(c.movEntradas + c.movSaidas), sub: (c) => `${fmt(c.movEntradas)} E · ${fmt(c.movSaidas)} S` },
  { key: 'etiquetas', label: 'Etiquetas', valor: (c) => fmt(c.etiquetas) },
  { key: 'erros', label: 'Erros', valor: (c) => fmt(c.erros) },
]
const KEYS = CATS.map((c) => c.key)

export default async function ResumoPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string; loja?: string; cat?: string }>
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

  const { contagem, lista } = await carregarResumoDia(lojaIdsEfetivos, data, cat)
  const catLabel = CATS.find((c) => c.key === cat)!.label

  const lojaParam = lojaSel != null ? String(lojaSel) : 'todas'
  const linkCat = (k: CategoriaKey) => `/resumo?data=${data}&loja=${lojaParam}&cat=${k}`
  const pdfHref = `/resumo/imprimir?data=${data}&loja=${lojaParam}&cat=${cat}`

  const temStatus = lista.linhas.some((l) => l.status)
  const tomClasse: Record<Tom, string> = SELO_CLASSE as Record<Tom, string>

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Resumo do dia"
          icon={LayoutDashboard}
          description="O que aconteceu no dia, por categoria"
          actions={
            <a href={pdfHref} target="_blank" rel="noopener noreferrer" className={btnClass('outline')}>
              <Download className="size-4" /> PDF do dia
            </a>
          }
        />
        <ResumoFiltros data={data} lojaSel={lojaSel} lojas={lojas} hoje={hoje} cat={cat} />
      </ListaHeader>

      {/* FILTRO POR CATEGORIA: cada tile mostra a contagem e seleciona a lista */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
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

      {/* LISTA DA CATEGORIA SELECIONADA */}
      <div className="rounded-lg border border-border bg-surface">
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
                    <td key={ci} className={`px-4 py-2 ${lista.colunas[ci]?.alinharDir ? 'num text-right' : 'text-text'}`}>
                      {cel ?? '-'}
                    </td>
                  ))}
                  {temStatus && (
                    <td className="px-4 py-2 text-right">
                      {linha.status && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tomClasse[linha.status.tom]}`}>
                          {linha.status.label}
                        </span>
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
