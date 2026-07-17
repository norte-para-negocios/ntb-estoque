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
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { descreverCFOP, CAT_COR, type CategoriaCFOP } from '@/lib/cfop'
import { btnClass } from '@/components/ui-kit/Button'
import { ShieldCheck, X, Download } from 'lucide-react'

const fmtData = (d: string) => { const [a, m, dia] = d.split('-'); return `${dia}/${m}/${a}` }
const fmtMoeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtN = (n: number) => n.toLocaleString('pt-BR')

type LinhaCFOP = { cfop_doc: string; cfop_entrada: string; itens: number; valor: number; credita_icms: number; move_estoque: number }
type LinhaItem = {
  data: string; nota: string; fornecedor: string; produto: string; codigo: string
  cfop_doc: string; cfop_entrada: string; cst_icms: string; origem: string
  credita_icms: boolean; move_estoque: boolean; valor: number; item_id: number
}

const ORDEM_CAT: CategoriaCFOP[] = ['Comercialização/Indústria', 'Uso/consumo', 'Ativo imobilizado', 'Bonificação/Comodato', 'Devolução', 'Outros']

export default async function AuditoriaFiscalPage({
  searchParams,
}: {
  searchParams: Promise<{ data_inicio?: string; data_final?: string; cfop?: string; fornecedor?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) notFound()

  const sp = await searchParams
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_inicio ?? '') ? sp.data_inicio! : `${hojeISO.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_final ?? '') ? sp.data_final! : hojeISO

  const supabase = createServiceClient()
  const { data: cfopRaw } = await supabase.rpc('relatorio_auditoria_fiscal_cfop', { p_loja_id: lojaId, p_ini: ini, p_fim: fim })
  const linhas = (cfopRaw ?? []) as LinhaCFOP[]

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

  // Drill: detalhe dos itens de um par CFOP (?cfop=doc|entrada).
  const [cfopDocSel, cfopEntSel] = (sp.cfop ?? '').split('|')
  let itensSel: LinhaItem[] = []
  if (cfopDocSel && cfopEntSel) {
    const { data } = await supabase
      .rpc('relatorio_auditoria_fiscal_itens', {
        p_loja_id: lojaId, p_ini: ini, p_fim: fim, p_cfop_doc: cfopDocSel, p_cfop_entrada: cfopEntSel,
        p_fornecedor: sp.fornecedor || null,
      })
      .range(0, 299)
    itensSel = (data ?? []) as LinhaItem[]
  }

  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
    { tipo: 'texto', nome: 'fornecedor', label: 'Fornecedor (só no detalhe do CFOP)' },
  ]

  const th = 'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted'
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams()
    if (sp.data_inicio) p.set('data_inicio', sp.data_inicio)
    if (sp.data_final) p.set('data_final', sp.data_final)
    for (const [k, v] of Object.entries(extra)) v ? p.set(k, v) : null
    return `/auditoria-fiscal${p.toString() ? `?${p}` : ''}`
  }

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
                defaults={{ data_inicio: sp.data_inicio ?? '', data_final: sp.data_final ?? '', fornecedor: sp.fornecedor ?? '' }}
                persistirEm="/auditoria-fiscal"
              />
              {linhas.length > 0 && (
                <a href={`/auditoria-fiscal/export?data_inicio=${ini}&data_final=${fim}`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')} title="Excel: classificação por CFOP (com filtros)">
                  <Download className="size-4" /> Baixar
                </a>
              )}
            </>
          }
        />
        <ChipsFiltrosAtivos basePath="/auditoria-fiscal" campos={campos} persistirEm="/auditoria-fiscal" />
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
                  const sel = sp.cfop === `${l.cfop_doc}|${l.cfop_entrada}`
                  return (
                    <tr key={`${l.cfop_doc}|${l.cfop_entrada}`} className={`border-t border-border/60 ${sel ? 'bg-surface-2/60' : 'hover:bg-surface-2/40'}`}>
                      <td className="whitespace-nowrap px-3 py-2">
                        {/* Achado real (reuniao 09/07, "eu clico mas nao faz nada"): o clique
                            SEMPRE abriu a secao de detalhe abaixo da tabela, mas sem scroll
                            automatico ela ficava fora da tela numa tabela longa -- ancora
                            #detalhe-cfop resolve isso sem precisar de client component. */}
                        <Link href={`${qs({ cfop: `${l.cfop_doc}|${l.cfop_entrada}` })}#detalhe-cfop`} className="num font-medium text-text hover:text-brand">
                          {l.cfop_doc} → {l.cfop_entrada}
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
          {cfopDocSel && cfopEntSel && (
            <div id="detalhe-cfop" className="space-y-1.5 rounded-lg border-2 border-brand bg-surface p-3 scroll-mt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-text">
                  Itens de <span className="num">{cfopDocSel} → {cfopEntSel}</span>
                  <span className="ml-1.5 text-[13px] text-text-muted">{descreverCFOP(cfopEntSel).desc}</span>
                </p>
                <Link href={qs({})} className="inline-flex items-center gap-1 text-[13px] text-text-muted hover:text-text">
                  <X className="size-3.5" /> fechar
                </Link>
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
        </>
      )}
    </div>
  )
}
