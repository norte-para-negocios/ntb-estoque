import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, BellRing, Boxes, PackageX, Wallet } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Lista, type Coluna } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import { BarraSaldo, fmtBRL, Indicador, Saldo, SituacaoPill } from '@/components/estoque-proprio/Apresentacao'
import { FiltrosEstoque } from '@/components/estoque-proprio/FiltrosEstoque'
import { ModalEntrada } from '@/components/estoque-proprio/Acoes'
import { carregarEstoque, TIPOS_ITEM, type LinhaEstoque, type Situacao } from './dados'
import { formatCustoUnit } from '@/lib/num-br'

const POR_PAGINA = 50
const ORDEM_SITUACAO: Record<Situacao, number> = { negativo: 0, baixo: 1, zerado: 2, ok: 3 }
const COLUNAS_SORT = ['descricao', 'saldo', 'valor', 'situacao'] as const

type SP = { q?: string; familia?: string; tipo?: string; local?: string; sit?: string; ord?: string; dir?: string; page?: string }

function semAcento(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export default async function EstoquePage({ searchParams }: { searchParams: Promise<SP> }) {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) notFound()
  const podeMovimentar = await requirePermissao(lojaId, 'Movimentacoes - Criar')

  const sp = await searchParams
  const visao = await carregarEstoque(lojaId)
  const localSel = sp.local ? Number(sp.local) : null

  // Com um local escolhido, cada produto passa a mostrar o saldo DAQUELE local.
  let linhas: LinhaEstoque[] = visao.linhas
  if (localSel != null) {
    linhas = linhas.flatMap((l) => {
      const s = l.locais.find((x) => x.codigoLocal === localSel)
      if (!s) return []
      const minimo = s.minimo ?? null
      const situacao: Situacao = s.saldo < 0 ? 'negativo' : s.saldo === 0 ? 'zerado' : minimo != null && minimo > 0 && s.saldo < minimo ? 'baixo' : 'ok'
      return [{ ...l, saldo: s.saldo, valor: s.saldo * l.cmc, minimo, situacao }]
    })
  }

  // Indicadores sobre o recorte de local (antes dos demais filtros).
  const totalSkus = linhas.length
  const valorTotal = linhas.reduce((a, l) => a + l.valor, 0)
  const nNegativos = linhas.filter((l) => l.situacao === 'negativo').length
  const nBaixos = linhas.filter((l) => l.situacao === 'baixo').length
  const nZerados = linhas.filter((l) => l.situacao === 'zerado').length

  const q = semAcento(sp.q?.trim() ?? '')
  let filtradas = linhas.filter((l) =>
    (!q || semAcento(l.descricao).includes(q) || semAcento(l.codigo).includes(q)) &&
    (!sp.familia || String(l.codigoFamilia) === sp.familia) &&
    (!sp.tipo || l.tipoItem === sp.tipo) &&
    (!sp.sit || l.situacao === sp.sit),
  )

  const ord = (COLUNAS_SORT as readonly string[]).includes(sp.ord ?? '') ? (sp.ord as (typeof COLUNAS_SORT)[number]) : 'situacao'
  const dir: 'asc' | 'desc' = sp.dir === 'desc' ? 'desc' : 'asc'
  const sinal = dir === 'asc' ? 1 : -1
  filtradas = [...filtradas].sort((a, b) => {
    const c =
      ord === 'descricao' ? a.descricao.localeCompare(b.descricao, 'pt-BR')
      : ord === 'saldo' ? a.saldo - b.saldo
      : ord === 'valor' ? a.valor - b.valor
      : ORDEM_SITUACAO[a.situacao] - ORDEM_SITUACAO[b.situacao] || a.descricao.localeCompare(b.descricao, 'pt-BR')
    return c * sinal
  })

  const page = Math.max(1, Number(sp.page) || 1)
  const pagina = filtradas.slice((page - 1) * POR_PAGINA, page * POR_PAGINA)

  const locaisAtivos = visao.locais.filter((l) => !l.inativo)
  const negativosTop = linhas.filter((l) => l.situacao === 'negativo').sort((a, b) => a.saldo - b.saldo).slice(0, 5)

  function sortHref(key: string, d: 'asc' | 'desc') {
    const p = new URLSearchParams()
    for (const k of ['q', 'familia', 'tipo', 'local', 'sit'] as const) if (sp[k]) p.set(k, sp[k]!)
    p.set('ord', key); p.set('dir', d)
    return `/estoque?${p.toString()}`
  }

  const colunas: Coluna<LinhaEstoque>[] = [
    {
      label: 'Produto', primaria: true, flexivel: true, sort: 'descricao',
      render: (l) => (
        <Link href={`/estoque/produto/${l.codigoProduto}`} className="block min-w-0">
          <span className="block truncate font-medium text-text hover:underline">{l.descricao}</span>
          <span className="num text-[12px] text-text-muted">{l.codigo} · {l.familia}</span>
        </Link>
      ),
    },
    {
      label: 'Saldo', alinhar: 'right', sort: 'saldo',
      render: (l) => (
        <div className="ml-auto w-32">
          <Saldo valor={l.saldo} unidade={l.unidade} />
          <div className="mt-1"><BarraSaldo saldo={l.saldo} minimo={l.minimo} situacao={l.situacao} /></div>
        </div>
      ),
    },
    {
      label: 'Por local', ocultarMobile: true,
      render: (l) => (
        <div className="flex max-w-[260px] flex-wrap gap-1">
          {l.locais.filter((x) => x.saldo !== 0).map((x) => (
            <span key={x.codigoLocal} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-muted">
              {x.local} <span className={`num ${x.saldo < 0 ? 'font-semibold text-err' : 'text-text'}`}>{x.saldo.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</span>
            </span>
          ))}
          {l.locais.every((x) => x.saldo === 0) && <span className="text-[12px] text-text-muted">-</span>}
        </div>
      ),
    },
    { label: 'Custo médio', alinhar: 'right', ocultarMobile: true, render: (l) => <span className="num">{l.cmc ? formatCustoUnit(l.cmc) : '-'}</span> },
    { label: 'Valor', alinhar: 'right', sort: 'valor', render: (l) => <span className={`num ${l.valor < 0 ? 'text-err' : ''}`}>{fmtBRL(l.valor)}</span> },
    { label: 'Situação', sort: 'situacao', render: (l) => <SituacaoPill situacao={l.situacao} /> },
  ]

  const tipos = [...new Set(visao.linhas.map((l) => l.tipoItem).filter((t): t is string => !!t))].sort()

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader title="Estoque" description="Saldo, custo e situação de cada produto, em cada local" />
      </ListaHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador icon={Boxes} rotulo="Produtos" valor={String(totalSkus)} dica={localSel ? 'neste local' : 'cadastrados'} />
        <Indicador icon={Wallet} rotulo="Valor em estoque" valor={fmtBRL(valorTotal)} dica="saldo × custo médio" />
        <Indicador icon={BellRing} rotulo="Abaixo do mínimo" valor={String(nBaixos)} tom={nBaixos ? 'aviso' : undefined} href={nBaixos ? '/estoque?sit=baixo' : undefined} />
        <Indicador icon={PackageX} rotulo="Negativos" valor={String(nNegativos)} dica={`${nZerados} zerado${nZerados === 1 ? '' : 's'}`} tom={nNegativos ? 'erro' : undefined} href={nNegativos ? '/estoque?sit=negativo' : undefined} />
      </div>

      {negativosTop.length > 0 && sp.sit !== 'negativo' && (
        <section className="rounded-[var(--r-lg)] bg-surface p-4 u-card" aria-label="Itens negativos">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-err">
            <AlertTriangle className="size-4" /> Itens com saldo negativo
          </div>
          <p className="mt-0.5 text-[12px] text-text-muted">Venderam antes da entrada ser lançada. Lance a compra ou faça um ajuste para normalizar.</p>
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {negativosTop.map((l) => (
              <li key={l.codigoProduto} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <Link href={`/estoque/produto/${l.codigoProduto}`} className="min-w-0 truncate hover:underline">{l.descricao} <span className="num text-text-muted">· {l.codigo}</span></Link>
                <Saldo valor={l.saldo} unidade={l.unidade} />
              </li>
            ))}
          </ul>
          {nNegativos > negativosTop.length && <Link href="/estoque?sit=negativo" className="mt-2 inline-block text-[13px] font-medium text-brand hover:underline">Ver os {nNegativos} itens</Link>}
        </section>
      )}

      <SegmentLinks basePath="/estoque" param="sit" aria-label="Situação"
        opcoes={[{ value: '', label: 'Todos' }, { value: 'negativo', label: 'Negativos' }, { value: 'baixo', label: 'Abaixo do mínimo' }, { value: 'zerado', label: 'Zerados' }, { value: 'ok', label: 'Em dia' }]} />

      <FiltrosEstoque
        familias={visao.familias.map((f) => ({ value: String(f.codigo), label: f.nome }))}
        tipos={tipos.map((t) => ({ value: t, label: TIPOS_ITEM[t] ?? t }))}
        locais={locaisAtivos.map((l) => ({ value: String(l.codigoLocal), label: l.descricao }))}
      />

      {locaisAtivos.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-[12px] text-text-muted">
          Locais:
          {locaisAtivos.map((l) => <Link key={l.codigoLocal} href={`/estoque/local/${l.codigoLocal}`} className="rounded-full bg-surface-2 px-2.5 py-0.5 hover:text-text">{l.descricao}</Link>)}
        </div>
      )}

      <Lista
        colunas={colunas}
        linhas={pagina}
        chaveLinha={(l) => l.codigoProduto}
        sortAtual={ord} dirAtual={dir} sortHref={sortHref}
        acao={podeMovimentar && locaisAtivos.length ? (l) => (
          <ModalEntrada compacto produto={{ codigoProduto: l.codigoProduto, codigo: l.codigo, descricao: l.descricao, unidade: l.unidade }}
            locais={locaisAtivos.map((x) => ({ codigoLocal: x.codigoLocal, descricao: x.descricao }))}
            saldos={l.locais.map((x) => ({ codigoLocal: x.codigoLocal, saldo: x.saldo, minimo: x.minimo }))} localInicial={localSel ?? undefined} />
        ) : undefined}
        vazio={<EmptyState icon={Boxes} title={visao.linhas.length ? 'Nenhum produto neste filtro' : 'Nenhum produto cadastrado ainda'} hint={visao.linhas.length ? 'Ajuste os filtros para ver mais itens.' : 'Cadastre produtos para começar a controlar o estoque.'} />}
      />

      <Paginacao basePath="/estoque" page={page} temProxima={page * POR_PAGINA < filtradas.length} total={filtradas.length} porPagina={POR_PAGINA} />
    </div>
  )
}
