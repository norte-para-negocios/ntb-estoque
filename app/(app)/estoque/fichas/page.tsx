import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, BookOpen, Download } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { createServiceClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { agruparFichas, ondeEUsado } from '@/lib/estoque/fichas-tela-puro'
import { carregarFichasDaLoja } from './dados'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Filtros } from '@/components/ui-kit/Filtros'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { EstoqueAtalhos } from '@/components/estoque-proprio/EstoqueAtalhos'
import { carregarLocais, carregarProdutosMin, type ProdutoMin } from '../dados-produtos'
import { fmtDataBR } from '../dados-comum'
import { LOJA_BLOQUEADA, montarTrocas } from '@/lib/estoque/escrita-omie-puro'
import { ConfirmarTroca, FormTrocaInsumo, type LinhaPrevia } from '@/components/estoque-proprio/TrocarInsumo'

const POR_PAGINA = 30
const fmtQ = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

type SP = { q?: string; insumo?: string; page?: string; trocar?: string; troca_de?: string; troca_para?: string; troca_qtd?: string }
/**
 * Dados da troca de insumo em massa ("nosso Omie" Fase 4). Loja de teste lê as fichas da loja real de origem (só
 * leitura; a loja de teste não tem fichas lidas e a escrita lá é simulada), por isso o service client.
 */
async function dadosTroca(lojaFicha: number, sp: SP) {
  const svc = createServiceClient()
  type C = { codigo_produto: number; codigo_produto_insumo: number; quantidade: number; percentual_perda: number | null }
  type P = { codigo_produto: number; codigo: string | null; descricao: string | null; unidade: string | null; inativo: boolean | null }
  const [cache, prods] = await Promise.all([
    buscarTodasLinhas<C>((from, to) => svc.from('estrutura_produto_cache').select('id, codigo_produto, codigo_produto_insumo, quantidade, percentual_perda')
      .eq('loja_id', lojaFicha).order('id').range(from, to)),
    buscarTodasLinhas<P>((from, to) => svc.from('produtos').select('id, codigo_produto, codigo, descricao, unidade, inativo')
      .eq('loja_id', lojaFicha).order('id').range(from, to)),
  ])
  const prod = new Map(prods.map((p) => [Number(p.codigo_produto), p]))
  const rotulo = (c: number) => { const p = prod.get(c); return p ? `${p.descricao ?? c} (${p.codigo ?? c})` : `Produto ${c}` }
  const insumos = [...new Set(cache.map((c) => Number(c.codigo_produto_insumo)))].map((c) => ({ value: String(c), label: rotulo(c) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  const produtos = prods.filter((p) => !p.inativo).map((p) => ({ value: String(p.codigo_produto), label: rotulo(Number(p.codigo_produto)) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  const de = Number(sp.troca_de), para = Number(sp.troca_para)
  const qtdTxt = (sp.troca_qtd ?? '').trim().replace(',', '.')
  const fixa = qtdTxt ? Number(qtdTxt) : null
  let previa: { de: number; para: number; fixa: number | null; linhas: LinhaPrevia[] } | null = null
  let aviso: string | null = null
  if (sp.troca_de && sp.troca_para) {
    if (!(de > 0 && para > 0) || de === para) aviso = 'Escolha dois insumos diferentes.'
    else if (fixa != null && !(Number.isFinite(fixa) && fixa > 0)) aviso = 'Quantidade inválida.'
    else if (!prod.get(para) || prod.get(para)!.inativo) aviso = 'O insumo novo não está ativo nesta loja.'
    else {
      const trocas = montarTrocas(cache.map((c) => ({ produto: Number(c.codigo_produto), insumo: Number(c.codigo_produto_insumo), quantidade: Number(c.quantidade), perda: Number(c.percentual_perda ?? 0) })), de, para, fixa)
      previa = {
        de, para, fixa,
        linhas: trocas.map((t) => ({ produto: t.produto, nome: rotulo(t.produto), atual: t.quantidadeAtual, nova: t.quantidadeNova, unidade: prod.get(de)?.unidade ?? '', jaTemNovo: t.jaTemNovo }))
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
      }
      if (!trocas.length) aviso = 'Nenhuma ficha lida usa este insumo.'
    }
  }
  return { insumos, produtos, previa, aviso, rotulo }
}

export default async function FichasPage({ searchParams }: { searchParams: Promise<SP> }) {
  const lojaId = await getCurrentLojaId()
  const modo = await modoDaLoja(lojaId)
  if (modo !== 'proprio' && modo !== 'omie') notFound()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) notFound()
  const sp = await searchParams

  const [{ linhas, avisos, lidas }, produtos, locais] = await Promise.all([
    carregarFichasDaLoja(lojaId, modo),
    carregarProdutosMin(lojaId),
    carregarLocais(lojaId),
  ])
  const nome = (c: number) => produtos.get(c)?.descricao ?? `Produto ${c}`

  // Trocar insumo em massa (só loja Omie, fora a loja 4, com "Fichas - Trocar insumo").
  const podeTrocar = modo === 'omie' && lojaId !== LOJA_BLOQUEADA && (await requirePermissao(lojaId, 'Fichas - Trocar insumo'))
  const abrirTroca = podeTrocar && !!(sp.trocar || sp.troca_de)
  let troca: Awaited<ReturnType<typeof dadosTroca>> | null = null
  let lojaTeste = false
  if (abrirTroca) {
    const { data: l } = await createServiceClient().from('lojas').select('id, is_test, loja_origem_id').eq('id', lojaId).maybeSingle<{ id: number; is_test: boolean; loja_origem_id: number | null }>()
    lojaTeste = !!l?.is_test
    troca = await dadosTroca(lojaTeste && l?.loja_origem_id ? l.loja_origem_id : lojaId, sp)
  }
  const secaoTroca = abrirTroca && troca ? (
    <section className="space-y-3 rounded-[var(--r-lg)] bg-surface p-4 u-card" aria-label="Trocar insumo em massa">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-text">Trocar insumo em massa (no Omie)</h2>
        <Link href="/estoque/fichas" className="text-[13px] text-text-muted hover:underline">Fechar</Link>
      </div>
      <FormTrocaInsumo key={JSON.stringify(sp)} insumos={troca.insumos} produtos={troca.produtos} de={sp.troca_de ?? ''} para={sp.troca_para ?? ''} qtd={sp.troca_qtd ?? ''} />
      {troca.aviso && <p className="text-[13px] text-warn">{troca.aviso}</p>}
      {troca.previa && troca.previa.linhas.length > 0 && (
        <ConfirmarTroca key={`${troca.previa.de}-${troca.previa.para}-${troca.previa.fixa}`} de={troca.previa.de} para={troca.previa.para}
          nomeDe={troca.rotulo(troca.previa.de)} nomePara={troca.rotulo(troca.previa.para)} quantidadeFixa={troca.previa.fixa}
          linhas={troca.previa.linhas} simulado={lojaTeste} />
      )}
    </section>
  ) : null
  const und = (c: number, fallback: string | null) => produtos.get(c)?.unidade ?? fallback ?? ''
  const candidatos = [...produtos.values()].filter((p: ProdutoMin) => !p.inativo && ['03', '04'].includes(p.tipo_item ?? '')).length

  const insumoSel = sp.insumo && /^\d+$/.test(sp.insumo) ? Number(sp.insumo) : null

  if (insumoSel != null) {
    const usos = ondeEUsado(linhas, insumoSel).sort((a, b) => nome(a.produto).localeCompare(nome(b.produto), 'pt-BR'))
    return (
      <div className="space-y-4">
        <ListaHeader><PageHeader title={`Onde é usado: ${nome(insumoSel)}`} voltarHref="/estoque/fichas" description={`${usos.length} prato${usos.length === 1 ? '' : 's'} levam este insumo na ficha técnica`} /></ListaHeader>
        <EstoqueAtalhos atual="fichas" />
        {!usos.length ? <div className="rounded-[var(--r-lg)] bg-surface u-card"><EmptyState icon={BookOpen} title="Nenhuma ficha usa este insumo" /></div> : (
          <ul className="divide-y divide-[var(--border)] rounded-[var(--r-lg)] bg-surface px-4 u-card">
            {usos.map((u) => (
              <li key={u.produto} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13px]">
                <Link href={`/estoque/produto/${u.produto}`} className="min-w-0 truncate font-medium text-text hover:underline">{nome(u.produto)}</Link>
                <span className="num text-text-muted">{fmtQ(u.quantidade)} {und(insumoSel, null)} por unidade{u.local != null ? ` · sai de ${locais.get(u.local) ?? u.local}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  const q = semAcento(sp.q?.trim() ?? '')
  const fichas = agruparFichas(linhas)
    .filter((f) => !q || semAcento(nome(f.produto)).includes(q) || f.itens.some((i) => semAcento(nome(i.insumo)).includes(q)))
    .sort((a, b) => nome(a.produto).localeCompare(nome(b.produto), 'pt-BR'))
  const page = Math.max(1, Number(sp.page) || 1)
  const pagina = fichas.slice((page - 1) * POR_PAGINA, page * POR_PAGINA)

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader title="Fichas técnicas" description={modo === 'omie' ? 'Insumos de cada prato no Omie, de onde saem e quem mexeu por último' : 'Insumos de cada prato e quem criou a ficha'}
          actions={linhas.length ? <a href="/estoque/fichas/excel" className={btnClass('outline')}><Download className="size-4" /> Estrutura completa (Excel)</a> : undefined} />
      </ListaHeader>
      <EstoqueAtalhos atual="fichas" />

      <div className="rounded-[var(--r-lg)] bg-surface-2 px-4 py-3 text-[13px] text-text-muted">
        {modo === 'omie' && <p>{lidas == null ? 'Leitura automática das fichas ainda não ativada.' : `${lidas} de ${candidatos} produtos de produção (acabado ou em processo) já lidos do Omie; o robô relê cada ficha a cada 7 dias.`}</p>}
        {avisos.map((a) => <p key={a} className="mt-0.5 flex items-start gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {a}</p>)}
        <p className="mt-0.5">Clique num insumo para ver em quais pratos ele é usado.</p>
      </div>

      {secaoTroca}
      {podeTrocar && !abrirTroca && <Link href="/estoque/fichas?trocar=1" className="inline-block text-[13px] font-medium text-brand hover:underline">Trocar um insumo em várias fichas (no Omie)</Link>}

      <Filtros key={JSON.stringify(sp)} basePath="/estoque/fichas" defaults={{ q: sp.q ?? '' }} campos={[{ tipo: 'texto', nome: 'q', label: 'Prato ou insumo' }]} />

      {!pagina.length ? (
        <div className="rounded-[var(--r-lg)] bg-surface u-card"><EmptyState icon={BookOpen} title={linhas.length ? 'Nenhuma ficha neste filtro' : 'Nenhuma ficha técnica ainda'} /></div>
      ) : (
        <div className="space-y-3">
          {pagina.map((f) => (
            <section key={f.produto} className="rounded-[var(--r-lg)] bg-surface p-4 u-card" aria-label={nome(f.produto)}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/estoque/produto/${f.produto}`} className="text-[14px] font-semibold text-text hover:underline">{nome(f.produto)}</Link>
                <span className="text-[12px] text-text-muted">{f.itens.length} insumo{f.itens.length === 1 ? '' : 's'}{f.ultimaAlteracao ? ` · ${f.autor ?? 'sem autor'} em ${fmtDataBR(f.ultimaAlteracao)}` : ''}</span>
              </div>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-[13px]">
                  <thead><tr className="text-[11px] uppercase tracking-wide text-text-muted">
                    <th className="py-1.5 pr-2 font-medium">Insumo</th><th className="px-2 py-1.5 text-right font-medium">Quantidade</th><th className="px-2 py-1.5 text-right font-medium">Perda</th>
                    <th className="px-2 py-1.5 font-medium">Sai de</th><th className="py-1.5 pl-2 font-medium">Alterado</th>
                  </tr></thead>
                  <tbody>
                    {f.itens.map((i) => (
                      <tr key={i.insumo} className="border-t border-[var(--border)]">
                        <td className="max-w-[240px] truncate py-1.5 pr-2"><Link href={`/estoque/fichas?insumo=${i.insumo}`} className="text-text hover:underline">{nome(i.insumo)}</Link></td>
                        <td className="num whitespace-nowrap px-2 py-1.5 text-right">{fmtQ(i.quantidade)} {und(i.insumo, i.unidade)}</td>
                        <td className="num whitespace-nowrap px-2 py-1.5 text-right text-text-muted">{i.perda ? `${fmtQ(i.perda)}%` : '-'}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-text-muted">{i.local != null ? `${locais.get(i.local) ?? i.local}${i.localFonte === 'op' ? ' (da última OP)' : ''}` : '-'}</td>
                        <td className="whitespace-nowrap py-1.5 pl-2 text-text-muted">{i.alteradoEm ? `${i.alteradoPor ?? ''} ${fmtDataBR(i.alteradoEm)}` : i.incluidoEm ? `${i.incluidoPor ?? ''} ${fmtDataBR(i.incluidoEm)}` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      <Paginacao basePath="/estoque/fichas" page={page} temProxima={page * POR_PAGINA < fichas.length} total={fichas.length} porPagina={POR_PAGINA} />
    </div>
  )
}
