import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Money } from '@/components/ui-kit/Money'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { btnClass } from '@/components/ui-kit/Button'
import { limiteJanelaQuente } from '@/lib/historico-contabo'
import { buscarItensNFFrio } from '@/lib/relatorio-frio-nf'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { ClipboardX, Download } from 'lucide-react'
import type { ReactNode } from 'react'

const th = 'whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted'
const TIPO_LABEL = new Map(PRODUTO_TIPO_ITEM.map((t) => [t.value, t.label]))

export default async function PendenciasClassificacaoPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) notFound()
  const supabase = createServiceClient()

  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini12m = `${Number(hojeISO.slice(0, 4)) - 1}${hojeISO.slice(4, 10)}`

  // Blocos 1 e 2: cadastro incompleto.
  const { data: prods } = await supabase
    .from('produtos')
    .select('codigo_produto, codigo, descricao, tipo_item, descricao_familia')
    .eq('loja_id', lojaId)
  type Prod = { codigo_produto: number; codigo: string | null; descricao: string | null; tipo_item: string | null; descricao_familia: string | null }
  const todos = (prods ?? []) as Prod[]
  const semFamilia = todos.filter((p) => !p.descricao_familia)
  const semTipo = todos.filter((p) => !p.tipo_item)

  // Bloco 3 + R$: itens de NF dos últimos 12 meses (quente + frio) sem vínculo.
  const corte = limiteJanelaQuente()
  type ItemNF = { n_id_produto: number | null; c_descricao_produto: string | null; c_codigo_produto: string | null; n_qtde_nfe: number | null; n_preco_unit: number | null; fornecedor?: string | null }
  const { data: quentesRaw } = await supabase
    .from('nota_fiscal_items')
    .select('n_id_produto, c_descricao_produto, c_codigo_produto, n_qtde_nfe, n_preco_unit, notas_fiscais!inner(deleted_at, d_emissao_nfe, c_razao_social, c_nome)')
    .eq('loja_id', lojaId)
    .is('notas_fiscais.deleted_at', null)
    .gte('notas_fiscais.d_emissao_nfe', corte)
    .limit(50000)
  const quentes: ItemNF[] = ((quentesRaw ?? []) as unknown as (ItemNF & { notas_fiscais: { c_razao_social: string | null; c_nome: string | null } })[]).map((r) => ({
    n_id_produto: r.n_id_produto, c_descricao_produto: r.c_descricao_produto, c_codigo_produto: r.c_codigo_produto,
    n_qtde_nfe: r.n_qtde_nfe, n_preco_unit: r.n_preco_unit,
    fornecedor: r.notas_fiscais?.c_razao_social || r.notas_fiscais?.c_nome || null,
  }))
  const corteExcl = new Date(Date.parse(corte) - 86400000).toISOString().slice(0, 10)
  const friosRaw = await buscarItensNFFrio({ lojaId, dataInicio: ini12m, dataFinal: corteExcl })
  const frios: ItemNF[] = friosRaw.map((it) => ({
    n_id_produto: it.n_id_produto, c_descricao_produto: it.c_descricao_produto, c_codigo_produto: it.c_codigo_produto,
    n_qtde_nfe: Number(it.n_qtde_nfe) || 0, n_preco_unit: Number(it.n_preco_unit) || 0, fornecedor: it.nf_fornecedor ?? null,
  }))
  const itens12m = [...quentes, ...frios]

  const codigosCadastro = new Set(todos.map((p) => Number(p.codigo_produto)))
  const valorDe = (it: ItemNF) => (Number(it.n_qtde_nfe) || 0) * (Number(it.n_preco_unit) || 0)

  const codsSemFamilia = new Set(semFamilia.map((p) => Number(p.codigo_produto)))
  const codsSemTipo = new Set(semTipo.map((p) => Number(p.codigo_produto)))
  let valorSemFamilia = 0
  let valorSemTipo = 0
  const semCadastro = new Map<string, { descricao: string; codigo: string; fornecedor: string; ocorrencias: number; valor: number }>()
  for (const it of itens12m) {
    const cod = it.n_id_produto != null ? Number(it.n_id_produto) : null
    const v = valorDe(it)
    if (cod !== null && codsSemFamilia.has(cod)) valorSemFamilia += v
    if (cod !== null && codsSemTipo.has(cod)) valorSemTipo += v
    if (cod === null || !codigosCadastro.has(cod)) {
      const k = `${it.c_descricao_produto ?? ''}|${it.c_codigo_produto ?? ''}`
      const e = semCadastro.get(k) ?? { descricao: it.c_descricao_produto ?? '(sem descrição)', codigo: it.c_codigo_produto ?? '-', fornecedor: it.fornecedor ?? '-', ocorrencias: 0, valor: 0 }
      e.ocorrencias += 1
      e.valor += v
      semCadastro.set(k, e)
    }
  }
  const semCadastroLinhas = [...semCadastro.values()].sort((a, b) => b.valor - a.valor)
  const valorSemCadastro = semCadastroLinhas.reduce((s, l) => s + l.valor, 0)

  const Bloco = ({ titulo, valor, exportBloco, children }: { titulo: string; valor: number; exportBloco: string; children: ReactNode }) => (
    <section className="space-y-2">
      <h2 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-text">
        {titulo}
        <span className="text-[13px] font-normal text-text-muted">
          R$ associado (12 meses): <span className="num font-medium text-text"><Money value={valor} /></span>
        </span>
        <a href={`/pendencias-classificacao/export?bloco=${exportBloco}`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')}>
          <Download className="size-4" /> CSV
        </a>
      </h2>
      {children}
    </section>
  )

  return (
    <div className="space-y-6">
      <ListaHeader>
        <PageHeader
          title="Pendências de classificação"
          icon={ClipboardX}
          description="O que arrumar no Omie pra sumir com os 'Sem cadastro/família/tipo' dos relatórios"
          voltarHref="/relatorios"
        />
      </ListaHeader>

      <Bloco titulo={`Produtos sem família (${semFamilia.length})`} valor={valorSemFamilia} exportBloco="sem-familia">
        {!semFamilia.length ? (
          <EmptyState icon={ClipboardX} title="Nenhum" hint="Todos os produtos têm família." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="bg-surface-2"><th className={th}>Código</th><th className={th}>Descrição</th><th className={th}>Tipo</th></tr></thead>
              <tbody>
                {semFamilia.map((p) => (
                  <tr key={p.codigo_produto} className="border-t border-border/60">
                    <td className="num px-3 py-2 text-text-muted">{p.codigo ?? p.codigo_produto}</td>
                    <td className="px-3 py-2 text-text">{p.descricao ?? '-'}</td>
                    <td className="px-3 py-2 text-text-muted">{p.tipo_item ? TIPO_LABEL.get(p.tipo_item) ?? p.tipo_item : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      <Bloco titulo={`Produtos sem tipo (${semTipo.length})`} valor={valorSemTipo} exportBloco="sem-tipo">
        {!semTipo.length ? (
          <EmptyState icon={ClipboardX} title="Nenhum" hint="Todos os produtos têm tipo." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="bg-surface-2"><th className={th}>Código</th><th className={th}>Descrição</th><th className={th}>Família</th></tr></thead>
              <tbody>
                {semTipo.map((p) => (
                  <tr key={p.codigo_produto} className="border-t border-border/60">
                    <td className="num px-3 py-2 text-text-muted">{p.codigo ?? p.codigo_produto}</td>
                    <td className="px-3 py-2 text-text">{p.descricao ?? '-'}</td>
                    <td className="px-3 py-2 text-text-muted">{p.descricao_familia ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      <Bloco titulo={`Itens de NF sem produto no cadastro (${semCadastroLinhas.length})`} valor={valorSemCadastro} exportBloco="sem-cadastro">
        {!semCadastroLinhas.length ? (
          <EmptyState icon={ClipboardX} title="Nenhum" hint="Todo item de NF dos últimos 12 meses tem produto no cadastro." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="bg-surface-2">
                  <th className={th}>Descrição na NF</th>
                  <th className={th}>Código na NF</th>
                  <th className={th}>Fornecedor</th>
                  <th className={`${th} text-right`}>Ocorrências</th>
                  <th className={`${th} text-right`}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {semCadastroLinhas.map((l, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="max-w-[260px] truncate px-3 py-2 text-text" title={l.descricao}>{l.descricao}</td>
                    <td className="num px-3 py-2 text-text-muted">{l.codigo}</td>
                    <td className="max-w-[180px] truncate px-3 py-2 text-text-muted" title={l.fornecedor}>{l.fornecedor}</td>
                    <td className="num px-3 py-2 text-right text-text-muted">{l.ocorrencias}</td>
                    <td className="num px-3 py-2 text-right font-medium text-text"><Money value={l.valor} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-1 text-[12px] text-text-muted">
          É esta lista que vira <Link href="/relatorio-compras" className="underline">&quot;Sem cadastro de produto&quot;</Link> no relatório de Compras. Corrija os cadastros no Omie.
        </p>
      </Bloco>
    </div>
  )
}
