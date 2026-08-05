import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import type { CampoFiltro } from '@/components/ui-kit/Filtros'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { buscarFamilias } from '@/lib/actions/produto'
import { limiteJanelaQuente } from '@/lib/historico-contabo'
import {
  buscarItensNFFrio,
  filtrarItensAuditoria,
  agregarAuditoriaCfop,
  mapearAuditoriaItens,
} from '@/lib/relatorio-frio-nf'
import { descreverCFOP, CAT_COR, type CategoriaCFOP } from '@/lib/cfop'
import { parseDrill, hrefComDrill, SEM } from '@/lib/drill'
import { DrillBreadcrumb } from '@/components/ui-kit/DrillBreadcrumb'
import { btnClass } from '@/components/ui-kit/Button'
import { ChipsPeriodo } from '@/components/ui-kit/ChipsPeriodo'
import { chipsPeriodoPadrao } from '@/lib/periodo-rapido'
import { ChipsStatus } from '@/components/ui-kit/ChipsStatus'
import { ShieldCheck, Download } from 'lucide-react'

// Pedido real do Ramon (reuniao 27/07, item #6, adiado pra quando entrasse
// na parte de NF -- migration 097): mesmo filtro de status de Compras.
const OPCOES_STATUS = [
  { value: '', label: 'Concluída' },
  { value: 'MANIFESTADA', label: 'Manifestada' },
  { value: 'PENDENTE', label: 'Pendente' },
  { value: 'CANCELADA', label: 'Cancelada' },
  { value: 'TODAS', label: 'Todas' },
]

const fmtData = (d: string) => { const [a, m, dia] = d.split('-'); return `${dia}/${m}/${a}` }
const fmtMoeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtN = (n: number) => n.toLocaleString('pt-BR')

type LinhaCFOP = { cfop_doc: string; cfop_entrada: string; itens: number; valor: number; credita_icms: number; move_estoque: number }
type LinhaCST = {
  cst_doc: string; cst_entrada: string; cfop_entrada: string
  itens_com_credito: number; valor_com_credito: number
  itens_sem_credito: number; valor_sem_credito: number
  itens: number; valor: number
}
type LinhaItem = {
  data: string; nota: string; fornecedor: string; produto: string; codigo: string
  cfop_doc: string; cfop_entrada: string; cst_icms: string; origem: string
  credita_icms: boolean; move_estoque: boolean; valor: number; item_id: number
}

const ORDEM_CAT: CategoriaCFOP[] = ['Comercialização/Indústria', 'Uso/consumo', 'Ativo imobilizado', 'Bonificação/Comodato', 'Devolução', 'Outros']

// O Supabase corta em 1000 linhas por padrao (sem erro) -- pagina ate esgotar
// (achado real: lojas com >1000 produtos perdiam o resto do catalogo aqui,
// mesmo bug ja corrigido no export/route.ts irmao). Usado tanto no resumo por
// CFOP quanto no drill-down por item, que fazem a mesma query de metadados.
async function buscarMetaProdutos(
  supabase: ReturnType<typeof createServiceClient>,
  lojaId: number
): Promise<Map<number, { tipo: string | null; familia: string | null }>> {
  // Pega o total antes (count exato) e busca as paginas em paralelo em vez de
  // uma de cada vez -- mesma latencia Franca-Brasil por ida, ver comentario em
  // HistoricoTab.tsx.
  const { count } = await supabase
    .from('produtos')
    .select('codigo_produto', { count: 'exact', head: true })
    .eq('loja_id', lojaId)
  const numPaginas = Math.ceil((count ?? 0) / 1000)
  const blocos = await Promise.all(
    Array.from({ length: numPaginas }, (_, pg) =>
      supabase
        .from('produtos')
        .select('codigo_produto, tipo_item, descricao_familia')
        .eq('loja_id', lojaId)
        .order('id', { ascending: true })
        .range(pg * 1000, pg * 1000 + 999)
    )
  )
  const meta = new Map<number, { tipo: string | null; familia: string | null }>()
  for (const { data } of blocos) {
    for (const p of data ?? []) {
      meta.set(Number(p.codigo_produto), { tipo: p.tipo_item, familia: p.descricao_familia })
    }
  }
  return meta
}

export default async function AuditoriaFiscalPage({
  searchParams,
}: {
  searchParams: Promise<{ data_inicio?: string; data_final?: string; cfop?: string; fornecedor?: string; produto?: string; familia?: string; local?: string; status?: string; drill?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) notFound()

  const sp = await searchParams
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const chipsPeriodo = chipsPeriodoPadrao({ value: '', label: 'Ano corrente', dataIni: `${hojeISO.slice(0, 4)}-01-01`, dataFim: hojeISO })
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_inicio ?? '') ? sp.data_inicio! : `${hojeISO.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_final ?? '') ? sp.data_final! : hojeISO
  const familiasFiltro = valoresMulti(sp.familia)
  const statusSel = sp.status || 'CONCLUIDA'

  const supabase = createServiceClient()
  const localCod = sp.local && !Number.isNaN(Number(sp.local)) ? Number(sp.local) : null
  // Janela quente cobre ~90 dias; RPC clampa o início e a fatia antiga
  // ([ini, corte)) vem do Contabo reagregada em JS (lib/relatorio-frio-nf.ts).
  const corte = limiteJanelaQuente()
  const iniRpc = ini < corte ? corte : ini
  const { data: cfopRaw } = await supabase.rpc('relatorio_auditoria_fiscal_cfop', {
    p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim,
    p_produto: sp.produto || null, p_familias: familiasFiltro.length ? familiasFiltro : null,
    p_fornecedor: sp.fornecedor || null, p_local: localCod, p_status: statusSel,
  })
  const linhas = (cfopRaw ?? []) as LinhaCFOP[]

  // Complemento frio: mescla o resumo por par CFOP com o pedaço antigo.
  if (ini < corte) {
    const corteExcl = new Date(Date.parse(corte) - 86400000).toISOString().slice(0, 10)
    // buscarMetaProdutos (Supabase) e buscarItensNFFrio (Contabo) sao
    // independentes entre si -- roda em paralelo em vez de serie.
    const [meta, itensFrios] = await Promise.all([
      buscarMetaProdutos(supabase, lojaId),
      buscarItensNFFrio({ lojaId, dataInicio: ini, dataFinal: corteExcl }),
    ])
    const filtrados = filtrarItensAuditoria(itensFrios, {
      status: statusSel, produto: sp.produto || null, familias: familiasFiltro, fornecedor: sp.fornecedor || null, local: localCod,
    }, meta)
    const porChave = new Map(linhas.map((l) => [`${l.cfop_doc}|${l.cfop_entrada ?? ''}`, l]))
    for (const f of agregarAuditoriaCfop(filtrados)) {
      const k = `${f.cfop_doc}|${f.cfop_entrada ?? ''}`
      const q = porChave.get(k)
      if (q) {
        q.itens = Number(q.itens) + f.itens
        q.valor = Number(q.valor) + f.valor
        q.credita_icms = Number(q.credita_icms) + f.credita_icms
        q.move_estoque = Number(q.move_estoque) + f.move_estoque
      } else {
        const nova = { cfop_doc: f.cfop_doc, cfop_entrada: f.cfop_entrada, itens: f.itens, valor: f.valor, credita_icms: f.credita_icms, move_estoque: f.move_estoque } as LinhaCFOP
        linhas.push(nova)
        porChave.set(k, nova)
      }
    }
    linhas.sort((a, b) => Number(b.valor) - Number(a.valor))
  }

  // Cruzamento CST do documento x CST de entrada x CFOP (migration 102, achado
  // 2026-08-01) -- a tela nunca expunha o CST DE ENTRADA, que e onde mora a
  // decisao de creditar ou nao o ICMS. Diagnostico, nao veredito: mostra os dois
  // lados (com/sem credito) pra o contador comparar. Le direto o periodo pedido
  // (o banco tem historico completo desde jun/2025, nao precisa do merge
  // quente/frio que a matriz de CFOP acima ainda faz).
  const { data: cstRaw } = await supabase.rpc('relatorio_auditoria_fiscal_cst', {
    p_loja_id: lojaId, p_ini: ini, p_fim: fim,
  })
  const linhasCst = (cstRaw ?? []) as LinhaCST[]
  const cstDivergentes = linhasCst.filter((l) => Number(l.itens_com_credito) > 0 && Number(l.itens_sem_credito) > 0)
  const valorDivergente = cstDivergentes.reduce((s, l) => s + Number(l.valor), 0)

  const totItens = linhas.reduce((s, l) => s + Number(l.itens), 0)
  const totValor = linhas.reduce((s, l) => s + Number(l.valor), 0)
  const totCredita = linhas.reduce((s, l) => s + Number(l.credita_icms), 0)
  const totNaoEstoca = linhas.reduce((s, l) => s + (Number(l.itens) - Number(l.move_estoque)), 0)

  // Resumo por categoria do CFOP de entrada.
  const porCat = new Map<CategoriaCFOP, { valor: number; itens: number }>()
  for (const l of linhas) {
    const cat = descreverCFOP(l.cfop_entrada).cat
    const ent = porCat.get(cat) ?? { valor: 0, itens: 0 }
    ent.valor += Number(l.valor); ent.itens += Number(l.itens)
    porCat.set(cat, ent)
  }
  const cats = ORDEM_CAT.filter((c) => porCat.has(c)).map((c) => ({ cat: c, ...porCat.get(c)! }))

  // Drill: detalhe dos itens de um par CFOP. Fonte nova: ?drill=cfop:doc→ent
  // (padrão trilha, '__sem__' = entrada nula). ?cfop=doc|entrada continua como
  // alias legado pra links salvos.
  const pares = parseDrill(sp.drill)
  const parCfop = pares.find((p) => p.dim === 'cfop')
  const [aliasDoc, aliasEnt] = (sp.cfop ?? '').split('|')
  const cfopDocSel = parCfop ? parCfop.rotulo.split('→')[0] : aliasDoc || ''
  const cfopEntSel = parCfop ? (parCfop.rotulo.split('→')[1] || SEM) : aliasEnt || ''
  let itensSel: LinhaItem[] = []
  if (cfopDocSel) {
    const { data } = await supabase
      .rpc('relatorio_auditoria_fiscal_itens', {
        p_loja_id: lojaId, p_ini: ini, p_fim: fim, p_cfop_doc: cfopDocSel, p_cfop_entrada: cfopEntSel || SEM,
        p_fornecedor: sp.fornecedor || null,
        p_produto: sp.produto || null, p_familias: familiasFiltro.length ? familiasFiltro : null, p_local: localCod,
        p_status: statusSel,
      })
      .range(0, 299)
    itensSel = (data ?? []) as LinhaItem[]

    // Complemento frio do drill-down (mesmo par CFOP, pedaço antigo).
    if (ini < corte) {
      const corteExcl = new Date(Date.parse(corte) - 86400000).toISOString().slice(0, 10)
      const [itensFrios, meta] = await Promise.all([
        buscarItensNFFrio({ lojaId, dataInicio: ini, dataFinal: corteExcl }),
        buscarMetaProdutos(supabase, lojaId),
      ])
      const filtrados = filtrarItensAuditoria(itensFrios, {
        status: statusSel, produto: sp.produto || null, familias: familiasFiltro, fornecedor: sp.fornecedor || null, local: localCod,
      }, meta)
      const friosDrill = mapearAuditoriaItens(filtrados, { cfopDoc: cfopDocSel, cfopEntrada: cfopEntSel || SEM }) as LinhaItem[]
      itensSel = [...itensSel, ...friosDrill]
        .sort((a, b) => (b.data ?? '').localeCompare(a.data ?? ''))
        .slice(0, 300)
    }
  }

  const [familiasOpcoes, { data: locaisRaw }] = await Promise.all([
    buscarFamilias(),
    supabase
      .from('local_estoques')
      .select('codigo_local_estoque, descricao')
      .eq('loja_id', lojaId)
      .order('descricao'),
  ])

  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
    { tipo: 'texto', nome: 'produto', label: 'Produto (nome ou código)' },
    { tipo: 'multi-select', nome: 'familia', label: 'Família', opcoes: familiasOpcoes.map((f) => ({ value: f.descricao, label: f.descricao })) },
    { tipo: 'texto', nome: 'fornecedor', label: 'Fornecedor' },
    {
      tipo: 'select',
      nome: 'local',
      label: 'Local de estoque',
      opcoes: (locaisRaw ?? []).map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })),
    },
  ]

  const exportParams = new URLSearchParams({ data_inicio: ini, data_final: fim })
  // Achado real (mesma classe de bug do relatorio-compras): produto, familia,
  // fornecedor e local ficavam de fora do link de export -- os filtros
  // funcionavam na tela (RPCs recebem tudo), mas o Excel ignorava esses 4
  // filtros porque a URL de export nunca os carregava, mesmo a rota de
  // export já sabendo lê-los (app/(app)/auditoria-fiscal/export/route.ts).
  if (sp.produto) exportParams.set('produto', sp.produto)
  if (sp.familia) exportParams.set('familia', sp.familia)
  if (sp.fornecedor) exportParams.set('fornecedor', sp.fornecedor)
  if (sp.local) exportParams.set('local', sp.local)
  if (sp.status) exportParams.set('status', sp.status)

  const th = 'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted'

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Auditoria fiscal"
          icon={ShieldCheck}
          description="Como cada compra foi classificada (CFOP), o que credita ICMS e o que entra no estoque — BETA"
          voltarHref="/relatorios"
          actions={
            <>
              <FiltrosGaveta
                basePath="/auditoria-fiscal"
                campos={campos}
                defaults={{ data_inicio: sp.data_inicio ?? '', data_final: sp.data_final ?? '', fornecedor: sp.fornecedor ?? '', produto: sp.produto ?? '', familia: sp.familia ?? '', local: sp.local ?? '' }}
                persistirEm="/auditoria-fiscal"
              />
              {linhas.length > 0 && (
                <a href={`/auditoria-fiscal/export?${exportParams.toString()}`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')} title="Excel: classificação por CFOP (com filtros)">
                  <Download className="size-4" /> Baixar
                </a>
              )}
            </>
          }
        />
        <ChipsFiltrosAtivos basePath="/auditoria-fiscal" campos={campos} persistirEm="/auditoria-fiscal" />
        <ChipsPeriodo basePath="/auditoria-fiscal" opcoes={chipsPeriodo} />
        <ChipsStatus basePath="/auditoria-fiscal" param="status" opcoes={OPCOES_STATUS} />
      </ListaHeader>

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13px] text-text-muted">Período: {fmtData(ini)} a {fmtData(fim)}</span>
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Comprado <span className="num font-semibold text-text"><Money value={totValor} /></span>
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Itens <span className="num font-semibold text-text">{fmtN(totItens)}</span>
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Creditam ICMS <span className={`num font-semibold ${totCredita ? 'text-info' : 'text-text'}`}>{fmtN(totCredita)}</span>
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Não estocam <span className={`num font-semibold ${totNaoEstoca ? 'text-warn' : 'text-text'}`}>{fmtN(totNaoEstoca)}</span>
        </span>
      </div>

      {!linhas.length ? (
        <EmptyState icon={ShieldCheck} title="Sem notas no período" hint="Ajuste o período. A auditoria usa as NFs de entrada (compras)." />
      ) : (
        <>
          {/* Resumo por categoria */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {cats.map((c) => (
              <div key={c.cat} className="rounded-lg border border-border bg-surface px-3.5 py-3">
                <p className={`text-[11px] font-semibold uppercase tracking-wider ${CAT_COR[c.cat]}`}>{c.cat}</p>
                <p className="num mt-1 text-[15px] font-semibold text-text">{fmtMoeda(c.valor)}</p>
                <p className="text-[12px] text-text-muted">{fmtN(c.itens)} itens · {totValor > 0 ? ((c.valor / totValor) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : 0}%</p>
              </div>
            ))}
          </div>

          {/* Matriz por par CFOP */}
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2">
                  <th className={`text-left ${th}`}>CFOP doc → entrada</th>
                  <th className={`text-left ${th}`}>O que é (entrada)</th>
                  <th className={`text-right ${th}`}>Itens</th>
                  <th className={`text-right ${th}`}>Valor</th>
                  <th className={`text-right ${th}`}>%</th>
                  <th className={`text-right ${th}`}>Credita ICMS</th>
                  <th className={`text-right ${th}`}>Não estoca</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const d = descreverCFOP(l.cfop_entrada)
                  const naoEstoca = Number(l.itens) - Number(l.move_estoque)
                  const entPar = l.cfop_entrada ?? SEM
                  const sel = cfopDocSel === l.cfop_doc && (cfopEntSel || SEM) === entPar
                  return (
                    <tr key={`${l.cfop_doc}|${l.cfop_entrada}`} className={`border-t border-border/60 ${sel ? 'bg-surface-2/60' : 'hover:bg-surface-2/40'}`}>
                      <td className="whitespace-nowrap px-3 py-2">
                        {/* Achado real (reuniao 09/07, "eu clico mas nao faz nada"): o clique
                            SEMPRE abriu a secao de detalhe abaixo da tabela, mas sem scroll
                            automatico ela ficava fora da tela numa tabela longa -- ancora
                            #detalhe-cfop resolve isso sem precisar de client component. */}
                        <Link
                          href={`${hrefComDrill('/auditoria-fiscal', sp, [{ dim: 'cfop', rotulo: `${l.cfop_doc}→${entPar}` }])}#detalhe-cfop`}
                          title={`${descreverCFOP(l.cfop_doc).desc}${l.cfop_entrada ? ` → ${descreverCFOP(l.cfop_entrada).desc}` : ' → sem CFOP de entrada'}`}
                          className="num font-medium text-text hover:text-brand"
                        >
                          {l.cfop_doc} → {l.cfop_entrada ?? 'sem entrada'}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-text">{d.desc}</span>
                        <span className={`ml-1.5 text-[12px] ${CAT_COR[d.cat]}`}>· {d.cat}</span>
                      </td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{fmtN(Number(l.itens))}</td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right font-medium text-text">{fmtMoeda(Number(l.valor))}</td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{totValor > 0 ? `${((Number(l.valor) / totValor) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-'}</td>
                      <td className={`num whitespace-nowrap px-3 py-2 text-right ${Number(l.credita_icms) ? 'text-info' : 'text-text-muted'}`}>{Number(l.credita_icms) ? fmtN(Number(l.credita_icms)) : '—'}</td>
                      <td className={`num whitespace-nowrap px-3 py-2 text-right ${naoEstoca ? 'text-warn' : 'text-text-muted'}`}>{naoEstoca ? fmtN(naoEstoca) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Drill por item */}
          {cfopDocSel && (
            <div id="detalhe-cfop" className="space-y-1.5 rounded-lg border-2 border-brand bg-surface p-3 scroll-mt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <DrillBreadcrumb
                  basePath="/auditoria-fiscal"
                  sp={sp}
                  pares={[{ dim: 'cfop', rotulo: `${cfopDocSel}→${cfopEntSel || SEM}` }]}
                  raiz="Auditoria por CFOP"
                  rotuloDe={(p) => p.rotulo.replace(SEM, 'sem entrada')}
                />
                <p className="text-[13px] text-text-muted">
                  {cfopEntSel && cfopEntSel !== SEM ? descreverCFOP(cfopEntSel).desc : 'itens sem CFOP de entrada definido'}
                </p>
              </div>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[680px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-surface-2">
                      <th className={`text-left ${th}`}>Data</th>
                      <th className={`text-left ${th}`}>Nota</th>
                      <th className={`text-left ${th}`}>Fornecedor</th>
                      <th className={`text-left ${th}`}>Produto</th>
                      <th className={`text-center ${th}`}>CST</th>
                      <th className={`text-center ${th}`}>Cred.</th>
                      <th className={`text-center ${th}`}>Estoq.</th>
                      <th className={`text-right ${th}`}>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itensSel.map((it) => (
                      <tr key={it.item_id} className="border-t border-border/60 hover:bg-surface-2/40">
                        <td className="whitespace-nowrap px-3 py-1.5 text-text-muted">{it.data ? fmtData(it.data) : '-'}</td>
                        <td className="num whitespace-nowrap px-3 py-1.5 text-text-muted">{it.nota}</td>
                        <td className="max-w-[200px] truncate px-3 py-1.5 text-text" title={it.fornecedor}>{it.fornecedor}</td>
                        <td className="max-w-[220px] truncate px-3 py-1.5 text-text" title={it.produto}>
                          <Link href={`/movimentacoes?produto=${encodeURIComponent(it.produto)}`} className="hover:underline">
                            {formatarNomeProduto(it.produto) || it.produto}
                          </Link>
                        </td>
                        <td className="num px-3 py-1.5 text-center text-text-muted">{it.cst_icms ?? '-'}</td>
                        <td className={`px-3 py-1.5 text-center ${it.credita_icms ? 'text-info' : 'text-text-muted'}`}>{it.credita_icms ? 'sim' : '—'}</td>
                        <td className={`px-3 py-1.5 text-center ${it.move_estoque ? 'text-text-muted' : 'text-warn'}`}>{it.move_estoque ? 'sim' : 'não'}</td>
                        <td className="num whitespace-nowrap px-3 py-1.5 text-right font-medium text-text">{fmtMoeda(Number(it.valor))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {itensSel.length === 300 && <p className="px-1 text-[11px] text-text-muted">Mostrando os 300 mais recentes deste par CFOP.</p>}
            </div>
          )}

          <p className="px-1 text-[11px] text-text-muted">
            CFOP de entrada é como a NTB classificou cada compra no Omie. &quot;Uso/consumo&quot; não credita ICMS nem entra no estoque
            de revenda. &quot;Credita ICMS&quot; e &quot;Não estoca&quot; destacam as exceções para revisão com o contador.
          </p>

          {/* CST do documento x CST de entrada x CFOP (migration 102) */}
          {linhasCst.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="px-1 text-[13px] font-semibold text-text">CST do documento × CST de entrada</h2>
                {cstDivergentes.length > 0 && (
                  <span className="rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1 text-[12px] text-text-muted">
                    <strong className="text-warn">{fmtN(cstDivergentes.length)}</strong> combinaç{cstDivergentes.length === 1 ? 'ão' : 'ões'} com
                    tratamento divergente · <span className="num">{fmtMoeda(valorDivergente)}</span>
                  </span>
                )}
              </div>
              <div className="overflow-x-auto rounded-lg border border-border bg-surface">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-surface-2">
                      <th className={`text-center ${th}`}>CST doc</th>
                      <th className={`text-center ${th}`}>CST entrada</th>
                      <th className={`text-left ${th}`}>CFOP entrada</th>
                      <th className={`text-right ${th}`}>Com crédito</th>
                      <th className={`text-right ${th}`}>Sem crédito</th>
                      <th className={`text-right ${th}`}>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhasCst.map((l) => {
                      const divergente = Number(l.itens_com_credito) > 0 && Number(l.itens_sem_credito) > 0
                      return (
                        <tr
                          key={`${l.cst_doc}|${l.cst_entrada}|${l.cfop_entrada}`}
                          className={`border-t border-border/60 hover:bg-surface-2/40 ${divergente ? 'bg-warn/5' : ''}`}
                        >
                          <td className="num px-3 py-2 text-center text-text">{l.cst_doc}</td>
                          <td className="num px-3 py-2 text-center text-text">{l.cst_entrada}</td>
                          <td className="px-3 py-2 text-text-muted">
                            <span className="num">{l.cfop_entrada}</span>
                            {l.cfop_entrada !== '—' && (
                              <span className="ml-1.5 text-[12px]">{descreverCFOP(l.cfop_entrada).desc}</span>
                            )}
                          </td>
                          <td className={`num whitespace-nowrap px-3 py-2 text-right ${Number(l.itens_com_credito) ? 'text-info' : 'text-text-muted'}`}>
                            {Number(l.itens_com_credito) ? fmtN(Number(l.itens_com_credito)) : '—'}
                          </td>
                          <td className={`num whitespace-nowrap px-3 py-2 text-right ${divergente ? 'font-medium text-warn' : 'text-text-muted'}`}>
                            {Number(l.itens_sem_credito) ? fmtN(Number(l.itens_sem_credito)) : '—'}
                          </td>
                          <td className="num whitespace-nowrap px-3 py-2 text-right font-medium text-text">{fmtMoeda(Number(l.valor))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="px-1 text-[11px] text-text-muted">
                CST de entrada é como a compra foi classificada no Omie ao dar entrada — é aí que se decide aproveitar ou não o
                crédito de ICMS. As linhas destacadas têm o <strong>mesmo</strong> CST de origem e CFOP tratados das{' '}
                <strong>duas</strong> formas no período: isso é uma divergência objetiva da base, não um veredito de erro —
                qual lado está correto é avaliação do contador. Esta tabela considera o período inteiro da loja e{' '}
                <strong>não</strong> muda com os filtros de produto/família/tipo acima — é uma classificação fiscal do
                documento, não do item.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
