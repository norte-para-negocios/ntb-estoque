import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ClipboardList, SlidersHorizontal } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { addDias } from '@/lib/estoque/espelho-lojas'
import { formatCustoUnit } from '@/lib/num-br'
import { lerPeriodo } from '@/lib/estoque/kardex-loja-puro'
import { custoForaDoNormal, valorDoAjuste, ROTULO_ORIGEM_AJUSTE, ROTULO_TIPO_AJUSTE } from '@/lib/estoque/ajustes-tela-puro'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Filtros } from '@/components/ui-kit/Filtros'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { fmtBRL, Indicador } from '@/components/estoque-proprio/Apresentacao'
import { EstoqueAtalhos } from '@/components/estoque-proprio/EstoqueAtalhos'
import { carregarEstoqueOmie } from '../dados-omie'
import { carregarEstoque } from '../dados'
import { carregarLocais, carregarProdutosMin } from '../dados-produtos'
import { nomesDeUsuarios } from '../dados-comum'

const POR_PAGINA = 50
const fmtQ = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

type SP = { data_inicio?: string; data_final?: string; q?: string; autor?: string; origem?: string; tipo?: string; fora?: string; page?: string }
type Ajuste = {
  id: number; quando: string; produto: number; local: number | null; destino: number | null; tipo: string; quantidade: number
  custoUnit: number | null; autor: string | null; origem: string | null; motivo: string | null; obs: string | null; status: string | null
}
type MovRow = {
  id: number; id_prod: number; tipo: string; quan: number | null; valor: number | null; codigo_local_estoque: number | null
  codigo_local_estoque_destino: number | null; data: string; motivo: string | null; obs: string | null; status: string | null
  autor?: string | null; origem_ajuste?: string | null
}

async function ajustesOmie(lojaId: number, ini: string, fim: string): Promise<{ ajustes: Ajuste[]; avisos: string[] }> {
  const supabase = await createClient()
  const avisos: string[] = []
  const base = 'id, id_prod, tipo, quan, valor, codigo_local_estoque, codigo_local_estoque_destino, data, motivo, obs, status'
  const ler = (cols: string, onErro: (e: { message: string }) => void) => buscarTodasLinhas<MovRow>((from, to) =>
    supabase.from('movimentos').select(cols).eq('loja_id', lojaId)
      .gte('data', `${ini}T00:00:00-03:00`).lt('data', `${addDias(fim, 1)}T00:00:00-03:00`)
      // Venda do PDV também vira linha em movimentos (origem PDV / motivo PDV): não é ajuste.
      .or('origem.is.null,origem.neq.PDV').or('motivo.is.null,motivo.neq.PDV')
      .order('id').range(from, to) as unknown as PromiseLike<{ data: MovRow[] | null; error: { message: string } | null }>, undefined, onErro)
  let falhou = false
  let rows = await ler(`${base}, autor, origem_ajuste`, () => { falhou = true })
  if (falhou) {
    avisos.push('Autor e origem dos ajustes ainda não disponíveis (migration 160 pendente).')
    rows = await ler(base, (e) => avisos.push(`Não foi possível ler os ajustes: ${e.message}`))
  }
  return {
    avisos,
    ajustes: rows.map((r) => ({
      id: Number(r.id), quando: r.data, produto: Number(r.id_prod), local: r.codigo_local_estoque == null ? null : Number(r.codigo_local_estoque),
      destino: r.codigo_local_estoque_destino == null ? null : Number(r.codigo_local_estoque_destino), tipo: r.tipo,
      quantidade: Number(r.quan ?? 0), custoUnit: r.valor == null ? null : Number(r.valor), autor: r.autor ?? null,
      origem: r.origem_ajuste ?? null, motivo: r.motivo, obs: r.obs, status: r.status,
    })),
  }
}

async function ajustesProprio(lojaId: number, ini: string, fim: string): Promise<{ ajustes: Ajuste[]; avisos: string[] }> {
  const supabase = await createClient()
  const avisos: string[] = []
  type R = { id: number; created_at: string; codigo_produto: number; codigo_local_estoque: number; quantidade: number; custo_unitario: number | null; cmc_apos: number | null; user_id: string | null; obs: string | null; origem: string }
  const rows = await buscarTodasLinhas<R>((from, to) =>
    supabase.from('estoque_movimentos').select('id, created_at, codigo_produto, codigo_local_estoque, quantidade, custo_unitario, cmc_apos, user_id, obs, origem')
      .eq('loja_id', lojaId).eq('tipo', 'AJU').gte('data_ref', ini).lte('data_ref', fim).order('id').range(from, to),
    undefined, (e) => avisos.push(`Não foi possível ler os ajustes: ${e.message}`))
  const nomes = await nomesDeUsuarios(rows.map((r) => r.user_id))
  return {
    avisos,
    ajustes: rows.map((r) => ({
      id: Number(r.id), quando: r.created_at, produto: Number(r.codigo_produto), local: Number(r.codigo_local_estoque), destino: null,
      tipo: Number(r.quantidade) >= 0 ? 'ENT' : 'SAI', quantidade: Number(r.quantidade),
      custoUnit: r.custo_unitario != null ? Number(r.custo_unitario) : r.cmc_apos != null ? Number(r.cmc_apos) : null,
      autor: r.user_id ? (nomes.get(r.user_id) ?? r.user_id) : null, origem: 'app', motivo: r.origem === 'INVENTARIO' ? 'Inventário' : null, obs: r.obs, status: null,
    })),
  }
}

export default async function AjustesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const lojaId = await getCurrentLojaId()
  const modo = await modoDaLoja(lojaId)
  if (modo !== 'proprio' && modo !== 'omie') notFound()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) notFound()
  const sp = await searchParams
  const hoje = hojeBahiaISO()
  const { ini, fim, erro } = lerPeriodo(sp, hoje, 30, 92)

  const [{ ajustes, avisos }, produtos, locais, visao] = await Promise.all([
    modo === 'omie' ? ajustesOmie(lojaId, ini, fim) : ajustesProprio(lojaId, ini, fim),
    carregarProdutosMin(lojaId),
    carregarLocais(lojaId),
    modo === 'omie' ? carregarEstoqueOmie(lojaId) : carregarEstoque(lojaId),
  ])
  const cmcAtual = new Map(visao.linhas.map((l) => [l.codigoProduto, l.custoSuspeito ? null : l.cmc]))
  const nome = (c: number) => produtos.get(c)?.descricao ?? `Produto ${c}`

  const linhas = ajustes.map((a) => ({ ...a, valor: valorDoAjuste(a), fora: custoForaDoNormal(a.custoUnit, cmcAtual.get(a.produto) ?? null) }))
  const q = semAcento(sp.q?.trim() ?? '')
  const autorQ = semAcento(sp.autor?.trim() ?? '')
  const filtradas = linhas.filter((a) =>
    (!q || semAcento(`${nome(a.produto)} ${produtos.get(a.produto)?.codigo ?? ''}`).includes(q)) &&
    (!autorQ || semAcento(a.autor ?? '').includes(autorQ)) &&
    (!sp.origem || a.origem === sp.origem) &&
    (!sp.tipo || a.tipo === sp.tipo) &&
    (sp.fora !== '1' || a.fora != null),
  ).sort((a, b) => b.quando.localeCompare(a.quando) || b.id - a.id)
  const page = Math.max(1, Number(sp.page) || 1)
  const pagina = filtradas.slice((page - 1) * POR_PAGINA, page * POR_PAGINA)

  const valEnt = filtradas.filter((a) => a.tipo === 'ENT').reduce((s, a) => s + a.valor, 0)
  const valSai = filtradas.filter((a) => a.tipo === 'SAI').reduce((s, a) => s + a.valor, 0)
  const nFora = filtradas.filter((a) => a.fora).length
  const tipos = [...new Set(linhas.map((a) => a.tipo))]
  const origens = [...new Set(linhas.map((a) => a.origem).filter((o): o is string => !!o))]
  const hrefFora = (() => { const p = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== 'page') as [string, string][]); p.set('fora', '1'); return `/estoque/ajustes?${p.toString()}` })()

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader title="Ajustes de estoque" description={modo === 'omie' ? 'Todo ajuste lançado no Omie, com quem lançou, o motivo, a quantidade e o custo' : 'Todo ajuste lançado no estoque, com quem lançou, a quantidade e o custo'} />
      </ListaHeader>
      <EstoqueAtalhos atual="ajustes" />

      {(erro || avisos.length > 0) && (
        <div className="rounded-[var(--r-lg)] bg-surface-2 px-4 py-3 text-[13px] text-warn">
          {[erro, ...avisos].filter(Boolean).map((a) => <p key={a!} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {a}</p>)}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador icon={ClipboardList} rotulo="Ajustes" valor={String(filtradas.length)} dica={`${ini.split('-').reverse().join('/')} a ${fim.split('-').reverse().join('/')}`} />
        <Indicador icon={ArrowDownToLine} rotulo="Valor das entradas" valor={fmtBRL(valEnt)} />
        <Indicador icon={ArrowUpFromLine} rotulo="Valor das saídas" valor={fmtBRL(valSai)} />
        <Indicador icon={SlidersHorizontal} rotulo="Custo fora do normal" valor={String(nFora)} dica="R$ 1.000+ ou 20× o custo médio" tom={nFora ? 'erro' : undefined} href={nFora && sp.fora !== '1' ? hrefFora : undefined} />
      </div>

      <Filtros key={JSON.stringify(sp)} basePath="/estoque/ajustes"
        defaults={{ data_inicio: ini, data_final: fim, q: sp.q ?? '', autor: sp.autor ?? '', origem: sp.origem ?? '', tipo: sp.tipo ?? '', fora: sp.fora ?? '' }}
        campos={[
          { tipo: 'data', nome: 'data_inicio', label: 'De' },
          { tipo: 'data', nome: 'data_final', label: 'Até' },
          { tipo: 'texto', nome: 'q', label: 'Produto' },
          { tipo: 'texto', nome: 'autor', label: 'Quem lançou' },
          { tipo: 'select', nome: 'origem', label: 'Origem', opcoes: origens.map((o) => ({ value: o, label: ROTULO_ORIGEM_AJUSTE[o] ?? o })) },
          { tipo: 'select', nome: 'tipo', label: 'Tipo', opcoes: tipos.map((t) => ({ value: t, label: ROTULO_TIPO_AJUSTE[t] ?? t })) },
          { tipo: 'select', nome: 'fora', label: 'Custo', opcoes: [{ value: '1', label: 'Só fora do normal' }] },
        ]} />

      {!pagina.length ? (
        <div className="rounded-[var(--r-lg)] bg-surface u-card"><EmptyState icon={ClipboardList} title="Nenhum ajuste neste filtro" hint="Mude o período ou os filtros." /></div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface u-card">
          <table className="w-full min-w-[960px] text-left text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                <th className="px-4 py-2.5 font-medium">Quando</th><th className="px-2 py-2.5 font-medium">Produto</th><th className="px-2 py-2.5 font-medium">Local</th>
                <th className="px-2 py-2.5 font-medium">Tipo</th><th className="px-2 py-2.5 text-right font-medium">Quantidade</th><th className="px-2 py-2.5 text-right font-medium">Custo unit.</th>
                <th className="px-2 py-2.5 text-right font-medium">Valor</th><th className="px-2 py-2.5 font-medium">Quem lançou</th><th className="px-4 py-2.5 font-medium">Motivo / observação</th>
              </tr>
            </thead>
            <tbody>
              {pagina.map((a) => {
                const p = produtos.get(a.produto)
                return (
                  <tr key={a.id} className="border-t border-[var(--border)] align-top">
                    <td className="num whitespace-nowrap px-4 py-2 text-text-muted">{quando(a.quando)}</td>
                    <td className="max-w-[240px] px-2 py-2">
                      <Link href={`/estoque/produto/${a.produto}`} className="block truncate font-medium text-text hover:underline">{nome(a.produto)}</Link>
                      <span className="num text-[12px] text-text-muted">{p?.codigo ?? a.produto}</span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-text-muted">{a.local != null ? locais.get(a.local) ?? a.local : '-'}{a.destino != null ? ` → ${locais.get(a.destino) ?? a.destino}` : ''}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-text-muted">{ROTULO_TIPO_AJUSTE[a.tipo] ?? a.tipo}</td>
                    <td className="num whitespace-nowrap px-2 py-2 text-right">{fmtQ(a.quantidade)} <span className="text-[12px] text-text-muted">{p?.unidade ?? ''}</span></td>
                    <td className={`num whitespace-nowrap px-2 py-2 text-right ${a.fora ? 'font-semibold text-err' : ''}`}>
                      {a.custoUnit != null ? formatCustoUnit(a.custoUnit) : '-'}
                      {a.fora && <div className="text-[11px] font-normal" title="Custo de R$ 1.000 ou mais, ou 20 vezes acima/abaixo do custo médio atual">fora do normal · médio {formatCustoUnit(cmcAtual.get(a.produto) ?? null)}</div>}
                    </td>
                    <td className="num whitespace-nowrap px-2 py-2 text-right">{a.tipo === 'SLD' ? <span className="text-text-muted">contagem</span> : fmtBRL(a.valor)}</td>
                    <td className="whitespace-nowrap px-2 py-2">
                      <div className="text-text">{a.autor ?? <span className="text-text-muted">não identificado</span>}</div>
                      {a.origem && <div className="text-[12px] text-text-muted">{ROTULO_ORIGEM_AJUSTE[a.origem] ?? a.origem}</div>}
                    </td>
                    <td className="max-w-[280px] px-4 py-2 text-text-muted">
                      {a.motivo && <div className="text-text">{a.motivo}</div>}
                      {a.obs && <div className="line-clamp-2 text-[12px]" title={a.obs}>{a.obs}</div>}
                      {a.status && a.status !== 'Concluido' && <div className="text-[12px] text-warn">{a.status}</div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Paginacao basePath="/estoque/ajustes" page={page} temProxima={page * POR_PAGINA < filtradas.length} total={filtradas.length} porPagina={POR_PAGINA} />
    </div>
  )
}
