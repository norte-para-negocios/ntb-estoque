import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, BookOpen, ClipboardList, Factory, Users } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { addDias } from '@/lib/estoque/espelho-lojas'
import { lerPeriodo } from '@/lib/estoque/kardex-loja-puro'
import { chavePessoa, linhaDoTempo, resumoPorPessoa, type Evento, type EventoTipo } from '@/lib/estoque/quem-mexeu-puro'
import { ROTULO_ORIGEM_AJUSTE, ROTULO_TIPO_AJUSTE } from '@/lib/estoque/ajustes-tela-puro'
import { ROTULO_ORIGEM_OP } from '@/lib/estoque/ops-tela-puro'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Filtros } from '@/components/ui-kit/Filtros'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { EstoqueAtalhos } from '@/components/estoque-proprio/EstoqueAtalhos'
import { carregarLocais, carregarProdutosMin, type ProdutoMin } from '../dados-produtos'
import { fmtDataBR, nomesDeUsuarios } from '../dados-comum'

const MAX_EVENTOS = 300
const fmtQ = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const hora = (q: string) => (q.length > 10 ? new Date(q).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' }) : '')
const ICONE: Record<EventoTipo, typeof ClipboardList> = { ajuste: ClipboardList, op: Factory, ficha: BookOpen }
const ROTULO_EVENTO: Record<EventoTipo, string> = { ajuste: 'ajustes', op: 'OPs', ficha: 'fichas' }

type SP = { data_inicio?: string; data_final?: string; pessoa?: string }
type Ctx = { lojaId: number; ini: string; fim: string; nome: (c: number) => string; produtos: Map<number, ProdutoMin>; locais: Map<number, string>; avisos: string[] }

async function eventosOmie(c: Ctx): Promise<Evento[]> {
  const supabase = await createClient()
  const ev: Evento[] = []
  type M = { id: number; id_prod: number; tipo: string; quan: number | null; data: string; autor: string | null; origem_ajuste: string | null; motivo: string | null; codigo_local_estoque: number | null }
  const movs = await buscarTodasLinhas<M>((from, to) =>
    supabase.from('movimentos').select('id, id_prod, tipo, quan, data, autor, origem_ajuste, motivo, codigo_local_estoque').eq('loja_id', c.lojaId)
      .gte('data', `${c.ini}T00:00:00-03:00`).lt('data', `${addDias(c.fim, 1)}T00:00:00-03:00`)
      .or('origem.is.null,origem.neq.PDV').or('motivo.is.null,motivo.neq.PDV').order('id').range(from, to),
    undefined, (e) => c.avisos.push(`Ajustes com autor indisponíveis (${e.message}).`))
  for (const m of movs) {
    ev.push({
      pessoa: m.autor, quando: m.data, tipo: 'ajuste',
      titulo: `${ROTULO_TIPO_AJUSTE[m.tipo] ?? m.tipo}: ${fmtQ(Number(m.quan ?? 0))} ${c.produtos.get(Number(m.id_prod))?.unidade ?? ''} de ${c.nome(Number(m.id_prod))}`,
      detalhe: [m.codigo_local_estoque != null ? c.locais.get(Number(m.codigo_local_estoque)) : null, m.motivo, m.origem_ajuste ? ROTULO_ORIGEM_AJUSTE[m.origem_ajuste] : null].filter(Boolean).join(' · '),
      href: `/estoque/produto/${m.id_prod}`,
    })
  }
  type O = { id: number; identificacao_c_num_op: string | null; identificacao_n_cod_produto: number | null; identificacao_n_qtde: number | null; dt_inclusao: string; incluido_por_omie: string | null; origem_op: string | null }
  const ops = await buscarTodasLinhas<O>((from, to) =>
    supabase.from('ordens_producao').select('id, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_n_qtde, dt_inclusao, incluido_por_omie, origem_op')
      .eq('loja_id', c.lojaId).gte('dt_inclusao', c.ini).lte('dt_inclusao', c.fim).order('id').range(from, to),
    undefined, (e) => c.avisos.push(`OPs com autor indisponíveis (${e.message}).`))
  for (const o of ops) {
    const cod = o.identificacao_n_cod_produto == null ? null : Number(o.identificacao_n_cod_produto)
    ev.push({
      pessoa: o.incluido_por_omie, quando: o.dt_inclusao, tipo: 'op',
      titulo: `Abriu a OP ${o.identificacao_c_num_op ?? o.id}: ${fmtQ(Number(o.identificacao_n_qtde ?? 0))} de ${cod != null ? c.nome(cod) : 'produto não informado'}`,
      detalhe: o.origem_op ? ROTULO_ORIGEM_OP[o.origem_op] ?? o.origem_op : '', href: `/ordem-producao/${o.id}`,
    })
  }
  type F = { codigo_produto: number; codigo_produto_insumo: number; incluido_por: string | null; incluido_em: string | null; alterado_por: string | null; alterado_em: string | null }
  const fichas = await buscarTodasLinhas<F>((from, to) =>
    supabase.from('estrutura_produto_cache').select('id, codigo_produto, codigo_produto_insumo, incluido_por, incluido_em, alterado_por, alterado_em')
      .eq('loja_id', c.lojaId).or(`and(alterado_em.gte.${c.ini},alterado_em.lte.${c.fim}),and(incluido_em.gte.${c.ini},incluido_em.lte.${c.fim})`)
      .order('id').range(from, to),
    undefined, (e) => c.avisos.push(`Autor das fichas indisponível (${e.message}).`))
  // Uma linha por prato + pessoa + dia + tipo de mudança (a ficha tem vários insumos alterados de uma vez).
  const vistos = new Map<string, { e: Evento; n: number }>()
  for (const f of fichas) {
    for (const [acao, quem, quando] of [['incluiu', f.incluido_por, f.incluido_em], ['alterou', f.alterado_por, f.alterado_em]] as const) {
      if (!quando || quando < c.ini || quando > c.fim) continue
      const k = JSON.stringify([f.codigo_produto, chavePessoa(quem), quando, acao])
      const v = vistos.get(k)
      if (v) { v.n++; v.e.detalhe = `${v.n} insumos`; continue }
      const e: Evento = { pessoa: quem, quando, tipo: 'ficha', titulo: `${acao === 'incluiu' ? 'Incluiu insumo na' : 'Alterou a'} ficha de ${c.nome(Number(f.codigo_produto))}`, detalhe: c.nome(Number(f.codigo_produto_insumo)), href: `/estoque/fichas?q=${encodeURIComponent(c.nome(Number(f.codigo_produto)))}` }
      vistos.set(k, { e, n: 1 })
      ev.push(e)
    }
  }
  return ev
}

async function eventosProprio(c: Ctx): Promise<Evento[]> {
  const supabase = await createClient()
  const ev: Evento[] = []
  type M = { id: number; created_at: string; codigo_produto: number; codigo_local_estoque: number; quantidade: number; user_id: string | null; origem: string; obs: string | null }
  const movs = await buscarTodasLinhas<M>((from, to) =>
    supabase.from('estoque_movimentos').select('id, created_at, codigo_produto, codigo_local_estoque, quantidade, user_id, origem, obs')
      .eq('loja_id', c.lojaId).eq('tipo', 'AJU').gte('data_ref', c.ini).lte('data_ref', c.fim).order('id').range(from, to),
    undefined, (e) => c.avisos.push(`Ajustes indisponíveis (${e.message}).`))
  const nomes = await nomesDeUsuarios(movs.map((m) => m.user_id))
  for (const m of movs) {
    ev.push({
      pessoa: m.user_id ? (nomes.get(m.user_id) ?? m.user_id) : null, quando: m.created_at, tipo: 'ajuste',
      titulo: `Ajuste: ${Number(m.quantidade) > 0 ? '+' : ''}${fmtQ(Number(m.quantidade))} ${c.produtos.get(Number(m.codigo_produto))?.unidade ?? ''} de ${c.nome(Number(m.codigo_produto))}`,
      detalhe: [c.locais.get(Number(m.codigo_local_estoque)), m.obs].filter(Boolean).join(' · '), href: `/estoque/produto/${m.codigo_produto}`,
    })
  }
  type H = { id: number; op_id: number | null; num_op: string | null; evento: string; user_nome: string | null; quantidade: number | null; created_at: string }
  const hist = await buscarTodasLinhas<H>((from, to) =>
    supabase.from('op_historico').select('id, op_id, num_op, evento, user_nome, quantidade, created_at').eq('loja_id', c.lojaId)
      .gte('created_at', `${c.ini}T00:00:00-03:00`).lt('created_at', `${addDias(c.fim, 1)}T00:00:00-03:00`).order('id').range(from, to),
    undefined, (e) => c.avisos.push(`Histórico de OPs indisponível (${e.message}).`))
  for (const h of hist) {
    ev.push({ pessoa: h.user_nome, quando: h.created_at, tipo: 'op', titulo: `OP ${h.num_op ?? h.op_id ?? ''} ${h.evento}`, detalhe: h.quantidade != null ? `${fmtQ(Number(h.quantidade))}` : '', href: h.op_id ? `/ordem-producao/${h.op_id}` : null })
  }
  type F = { codigo_produto: number; versao: number; criada_por: string | null; created_at: string }
  const { data: fichas } = await supabase.from('fichas_tecnicas').select('codigo_produto, versao, criada_por, created_at').eq('loja_id', c.lojaId)
    .gte('created_at', `${c.ini}T00:00:00-03:00`).lt('created_at', `${addDias(c.fim, 1)}T00:00:00-03:00`).order('id').limit(2000)
  for (const f of (fichas ?? []) as F[]) {
    ev.push({ pessoa: f.criada_por, quando: f.created_at, tipo: 'ficha', titulo: `${f.versao > 1 ? 'Alterou' : 'Criou'} a ficha de ${c.nome(Number(f.codigo_produto))}`, detalhe: `versão ${f.versao}`, href: `/estoque/fichas?q=${encodeURIComponent(c.nome(Number(f.codigo_produto)))}` })
  }
  return ev
}

export default async function QuemMexeuPage({ searchParams }: { searchParams: Promise<SP> }) {
  const lojaId = await getCurrentLojaId()
  const modo = await modoDaLoja(lojaId)
  if (modo !== 'proprio' && modo !== 'omie') notFound()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) notFound()
  const sp = await searchParams
  const { ini, fim, erro } = lerPeriodo(sp, hojeBahiaISO(), 7, 92)
  const [produtos, locais] = await Promise.all([carregarProdutosMin(lojaId), carregarLocais(lojaId)])
  const ctx: Ctx = { lojaId, ini, fim, produtos, locais, avisos: erro ? [erro] : [], nome: (c) => produtos.get(c)?.descricao ?? `Produto ${c}` }
  const eventos = modo === 'omie' ? await eventosOmie(ctx) : await eventosProprio(ctx)

  const pessoas = resumoPorPessoa(eventos)
  const sel = sp.pessoa ? chavePessoa(sp.pessoa) : null
  const pessoaSel = pessoas.find((p) => p.chave === sel)
  const dias = linhaDoTempo(eventos, sel)
  let restantes = MAX_EVENTOS
  const diasCortados = dias.map((d) => { const e = d.eventos.slice(0, Math.max(0, restantes)); restantes -= e.length; return { ...d, eventos: e } }).filter((d) => d.eventos.length)
  const totalTimeline = dias.reduce((a, d) => a + d.eventos.length, 0)
  const hrefPessoa = (nome: string | null) => {
    const p = new URLSearchParams()
    if (sp.data_inicio) p.set('data_inicio', sp.data_inicio)
    if (sp.data_final) p.set('data_final', sp.data_final)
    if (nome) p.set('pessoa', nome)
    return `/estoque/quem-mexeu${p.toString() ? `?${p}` : ''}`
  }

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader title="Quem mexeu" description="Ajustes, ordens de produção e fichas técnicas, por pessoa e por dia" />
      </ListaHeader>
      <EstoqueAtalhos atual="quem-mexeu" />

      {ctx.avisos.length > 0 && (
        <div className="rounded-[var(--r-lg)] bg-surface-2 px-4 py-3 text-[13px] text-warn">
          {ctx.avisos.map((a) => <p key={a} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {a}</p>)}
        </div>
      )}

      <Filtros key={JSON.stringify(sp)} basePath="/estoque/quem-mexeu" defaults={{ data_inicio: ini, data_final: fim }}
        campos={[{ tipo: 'data', nome: 'data_inicio', label: 'De' }, { tipo: 'data', nome: 'data_final', label: 'Até' }]} />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside aria-label="Pessoas" className="rounded-[var(--r-lg)] bg-surface p-2 u-card lg:self-start">
          <Link href={hrefPessoa(null)} className={`flex items-center justify-between rounded-[var(--r-md)] px-3 py-2 text-[13px] ${!sel ? 'bg-surface-2 font-semibold text-text' : 'text-text-muted hover:text-text'}`}>
            <span className="inline-flex items-center gap-2"><Users className="size-4" /> Todos</span><span className="num">{eventos.length}</span>
          </Link>
          <ul className="max-h-[50vh] overflow-y-auto lg:max-h-none">
            {pessoas.map((p) => (
              <li key={p.chave}>
                <Link href={hrefPessoa(p.nome === '(sem nome)' ? '(sem nome)' : p.nome)} className={`block rounded-[var(--r-md)] px-3 py-2 text-[13px] ${sel === p.chave ? 'bg-surface-2' : 'hover:bg-surface-2/60'}`}>
                  <span className="flex items-center justify-between gap-2"><span className={`truncate ${sel === p.chave ? 'font-semibold text-text' : 'text-text'}`}>{p.nome}</span><span className="num text-text-muted">{p.total}</span></span>
                  <span className="text-[11px] text-text-muted">{(Object.keys(p.porTipo) as EventoTipo[]).filter((t) => p.porTipo[t]).map((t) => `${p.porTipo[t]} ${ROTULO_EVENTO[t]}`).join(' · ')}</span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>

        <section aria-label="Linha do tempo" className="space-y-3">
          {pessoaSel && <h2 className="text-[15px] font-semibold text-text">{pessoaSel.nome} <span className="font-normal text-text-muted">· {pessoaSel.total} registro{pessoaSel.total === 1 ? '' : 's'}</span></h2>}
          {!diasCortados.length ? (
            <div className="rounded-[var(--r-lg)] bg-surface u-card"><EmptyState icon={Users} title="Ninguém mexeu no período" hint="Mude o período." /></div>
          ) : diasCortados.map((d) => (
            <div key={d.dia} className="rounded-[var(--r-lg)] bg-surface p-4 u-card">
              <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-text-muted">{fmtDataBR(d.dia)}</div>
              <ul className="divide-y divide-[var(--border)]">
                {d.eventos.map((e, i) => {
                  const Icone = ICONE[e.tipo]
                  const corpo = (
                    <span className="flex items-start gap-3 py-2 text-[13px]">
                      <Icone className="mt-0.5 size-4 shrink-0 text-text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-text">{e.titulo}</span>
                        <span className="block text-[12px] text-text-muted">{[!sel ? (e.pessoa?.trim() || '(sem nome)') : null, hora(e.quando), e.detalhe].filter(Boolean).join(' · ')}</span>
                      </span>
                    </span>
                  )
                  return <li key={`${e.tipo}-${i}`}>{e.href ? <Link href={e.href} className="block hover:bg-surface-2/50">{corpo}</Link> : corpo}</li>
                })}
              </ul>
            </div>
          ))}
          {totalTimeline > MAX_EVENTOS && <p className="text-[12px] text-text-muted">Mostrando os {MAX_EVENTOS} registros mais recentes de {totalTimeline}. Escolha uma pessoa ou diminua o período.</p>}
        </section>
      </div>
    </div>
  )
}
