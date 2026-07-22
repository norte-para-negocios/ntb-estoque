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
import { buscarItensNFFrio, cfopEntradaDe } from '@/lib/relatorio-frio-nf'
import { descreverCFOP } from '@/lib/cfop'
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
  type Prod = { codigo_produto: number; codigo: string | null; descricao: string | null; tipo_item: string | null; descricao_familia: string | null; inativo: boolean | null }
  // PostgREST corta em 1000 linhas por padrão, sem erro -- lojas com catálogo
  // grande (aqui, 2/3/4/5/6 passam de 1000 produtos) tinham "sem família"/"sem
  // tipo" subcontados E o cruzamento de "sem cadastro" (bloco 3) com falsos
  // positivos, pois codigosCadastro ficava incompleto. Pagina com .range() +
  // ORDER BY determinístico até trazer tudo -- mesma classe de bug já achada e
  // corrigida no Faturamento e no Estoque Valorizado nesta sessão.
  async function carregarTodosProdutos(): Promise<Prod[]> {
    const acc: Prod[] = []
    for (let p = 0; ; p++) {
      const { data } = await supabase
        .from('produtos')
        .select('codigo_produto, codigo, descricao, tipo_item, descricao_familia, inativo')
        .eq('loja_id', lojaId)
        .order('codigo_produto')
        .range(p * 1000, p * 1000 + 999)
      if (!data?.length) break
      acc.push(...(data as Prod[]))
      if (data.length < 1000) break
    }
    return acc
  }

  // Bloco 3 + R$: itens de NF dos últimos 12 meses (quente + frio) sem vínculo.
  // As 3 buscas abaixo sao independentes entre si (produtos, janela quente,
  // janela fria) -- rodavam em serie e somavam ~10s em producao (paginacao de
  // catalogo + query de ate 50000 itens + chamada a API do Contabo, uma atras
  // da outra). Promise.all roda concorrentemente; o tempo total passa a ser o
  // da mais lenta das tres, nao a soma.
  const corte = limiteJanelaQuente()
  type ItemNF = { n_id_produto: number | null; c_descricao_produto: string | null; c_codigo_produto: string | null; n_qtde_nfe: number | null; n_preco_unit: number | null; fornecedor?: string | null; cfop?: string | null }
  type QuenteRaw = { id: number; n_id_produto: number | null; c_descricao_produto: string | null; c_codigo_produto: string | null; n_qtde_nfe: number | null; n_preco_unit: number | null; c_cfop: string | null; full_object: Record<string, unknown> | null; notas_fiscais: { c_razao_social: string | null; c_nome: string | null; full_object: { infoCadastro?: { cCancelada?: string } } | null } }
  const corteExcl = new Date(Date.parse(corte) - 86400000).toISOString().slice(0, 10)
  // .limit(50000) sozinho e cortado silenciosamente em 1000 linhas pelo teto
  // padrao do PostgREST (mesma classe de bug do comentario acima, achado ao
  // validar o filtro de concluidas: loja 2 tem 1360 linhas so na janela
  // quente com etapa 60, so 1000 vinham). Pagina com .range() + ORDER BY
  // deterministico (id) ate trazer tudo.
  async function carregarQuentes(): Promise<QuenteRaw[]> {
    const acc: QuenteRaw[] = []
    for (let p = 0; ; p++) {
      const { data } = await supabase
        .from('nota_fiscal_items')
        .select('id, n_id_produto, c_descricao_produto, c_codigo_produto, n_qtde_nfe, n_preco_unit, c_cfop, full_object, notas_fiscais!inner(deleted_at, d_emissao_nfe, c_razao_social, c_nome, c_etapa, full_object)')
        .eq('loja_id', lojaId)
        .is('notas_fiscais.deleted_at', null)
        .eq('notas_fiscais.c_etapa', '60')
        .gte('notas_fiscais.d_emissao_nfe', corte)
        .order('id')
        .range(p * 1000, p * 1000 + 999)
      if (!data?.length) break
      acc.push(...(data as unknown as QuenteRaw[]))
      if (data.length < 1000) break
    }
    return acc
  }
  const [todos, quentesRaw, friosRaw] = await Promise.all([
    carregarTodosProdutos(),
    carregarQuentes(),
    buscarItensNFFrio({ lojaId, dataInicio: ini12m, dataFinal: corteExcl }),
  ])
  // Achado real (usuário 2026-07-22): produto inativo não precisa de
  // classificação (não vai mais ser comprado/vendido) -- estava aparecendo
  // como "precisa de atenção" só por não ter família/tipo, mesmo desativado.
  // `todos`/`codigosCadastro` continuam com TODOS (ativos + inativos): o bloco
  // "sem cadastro" (cruza item de NF com o catálogo) precisa reconhecer um
  // produto inativo como cadastrado, senão vira falso positivo ali.
  const semFamilia = todos.filter((p) => !p.descricao_familia && !p.inativo)
  const semTipo = todos.filter((p) => !p.tipo_item && !p.inativo)
  // Só NF concluída (etapa 60) e não cancelada -- mesmo filtro de Compras/Auditoria
  // (migration 083); pendente/travada/cancelada não deve contar como "R$ associado".
  const quentes: ItemNF[] = quentesRaw
    .filter((r) => (r.notas_fiscais?.full_object?.infoCadastro?.cCancelada ?? 'N') !== 'S')
    .map((r) => ({
      n_id_produto: r.n_id_produto, c_descricao_produto: r.c_descricao_produto, c_codigo_produto: r.c_codigo_produto,
      n_qtde_nfe: r.n_qtde_nfe, n_preco_unit: r.n_preco_unit,
      fornecedor: r.notas_fiscais?.c_razao_social || r.notas_fiscais?.c_nome || null,
      cfop: (r.full_object as { itensAjustes?: { cCFOPEntrada?: string } } | null)?.itensAjustes?.cCFOPEntrada ?? r.c_cfop,
    }))
  const frios: ItemNF[] = friosRaw
    .filter((it) => it.nf_c_etapa === '60' && !it.nf_cancelada)
    .map((it) => ({
      n_id_produto: it.n_id_produto, c_descricao_produto: it.c_descricao_produto, c_codigo_produto: it.c_codigo_produto,
      n_qtde_nfe: Number(it.n_qtde_nfe) || 0, n_preco_unit: Number(it.n_preco_unit) || 0, fornecedor: it.nf_fornecedor ?? null,
      cfop: cfopEntradaDe(it) ?? it.c_cfop,
    }))
  const itens12m = [...quentes, ...frios]

  // Sugestão do cliente (Ramon): o CFOP de entrada já classifica o produto
  // fiscalmente (revenda/indústria vs uso-consumo vs ativo etc.) mesmo sem
  // família cadastrada -- ajuda a decidir/priorizar a classificação manual
  // sem inventar categoria a partir do texto da descrição.
  const cfopPorProduto = new Map<number, Map<string, number>>()
  for (const it of itens12m) {
    if (it.n_id_produto == null || !it.cfop) continue
    const contagem = cfopPorProduto.get(it.n_id_produto) ?? new Map<string, number>()
    contagem.set(it.cfop, (contagem.get(it.cfop) ?? 0) + 1)
    cfopPorProduto.set(it.n_id_produto, contagem)
  }
  const cfopMaisComum = (codProd: number): string | null => {
    const contagem = cfopPorProduto.get(codProd)
    if (!contagem) return null
    return [...contagem.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }

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
      // JSON.stringify em vez de template "a|b": c_descricao_produto/c_codigo_produto
      // vêm crus da NF do fornecedor sem sanitização -- mesma classe de bug já
      // achada em produção no acumulador de Faturamento (produto com "|" no nome
      // colidia/corrompia a chave). Hoje nenhuma NF das 6 lojas tem "|" nesses
      // campos (checado via SQL), mas o texto do fornecedor não é controlado.
      const k = JSON.stringify([it.c_descricao_produto ?? '', it.c_codigo_produto ?? ''])
      const e = semCadastro.get(k) ?? { descricao: it.c_descricao_produto ?? '(sem descrição)', codigo: it.c_codigo_produto ?? '-', fornecedor: it.fornecedor ?? '-', ocorrencias: 0, valor: 0 }
      e.ocorrencias += 1
      e.valor += v
      semCadastro.set(k, e)
    }
  }
  const semCadastroLinhas = [...semCadastro.values()].sort((a, b) => b.valor - a.valor)
  const valorSemCadastro = semCadastroLinhas.reduce((s, l) => s + l.valor, 0)

  // Bloco 4: cupons do Faturamento (PDV) sem produto identificado, por mes (ultimos 12).
  const { data: naoIdentRows } = await supabase
    .from('faturamento_importado')
    .select('mes, valor')
    .eq('loja_id', lojaId)
    .eq('dimensao', 'produto')
    .eq('rotulo', 'Produto não identificado')
    .order('mes', { ascending: false })
    .limit(12)
  const valorNaoIdent = (naoIdentRows ?? []).reduce((s, r) => s + Number(r.valor), 0)

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
            <table className="w-full min-w-[620px] text-sm">
              <thead><tr className="bg-surface-2"><th className={th}>Código</th><th className={th}>Descrição</th><th className={th}>Tipo</th><th className={th}>CFOP de entrada</th></tr></thead>
              <tbody>
                {semFamilia.map((p) => {
                  const cfop = cfopMaisComum(Number(p.codigo_produto))
                  const info = cfop ? descreverCFOP(cfop) : null
                  return (
                  <tr key={p.codigo_produto} className="border-t border-border/60">
                    <td className="num px-3 py-2 text-text-muted">{p.codigo ?? p.codigo_produto}</td>
                    <td className="px-3 py-2 text-text">{p.descricao ?? '-'}</td>
                    <td className="px-3 py-2 text-text-muted">{p.tipo_item ? TIPO_LABEL.get(p.tipo_item) ?? p.tipo_item : '—'}</td>
                    <td className="px-3 py-2 text-text-muted">
                      {info ? <>{info.codigo} · {info.desc}</> : <span title="Sem NF de entrada nos últimos 12 meses">—</span>}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-1 text-[12px] text-text-muted">
          O CFOP de entrada mais frequente do produto (últimos 12 meses) — não substitui a família, mas indica se é
          revenda/insumo, uso e consumo, ativo etc., pra ajudar a decidir a classificação certa no Omie.
        </p>
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

      <Bloco titulo="Cupons com produto não identificado (por mês)" valor={valorNaoIdent} exportBloco="cupom-nao-identificado">
        {!naoIdentRows?.length ? (
          <EmptyState icon={ClipboardX} title="Nenhum" hint="Todo cupom tem produto identificado nos últimos 12 meses." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[320px] text-sm">
              <thead><tr className="bg-surface-2"><th className={th}>Mês</th><th className={`${th} text-right`}>Valor</th></tr></thead>
              <tbody>{(naoIdentRows ?? []).map((r) => (
                <tr key={r.mes} className="border-t border-border/60">
                  <td className="px-3 py-2 text-text">{r.mes}</td>
                  <td className="num px-3 py-2 text-right font-medium text-text"><Money value={Number(r.valor)} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="px-1 text-[12px] text-text-muted">
          Cada linha é um mês em que o sync do Faturamento rodou antes do catálogo de produtos estar
          completo (produto novo no PDV ainda não sincronizado). Rodar o sync de novo (botão &quot;Atualizar&quot;
          em <Link href="/relatorio-faturamento" className="underline">Faturamento</Link>) resolve os meses recentes.
        </p>
      </Bloco>
    </div>
  )
}
