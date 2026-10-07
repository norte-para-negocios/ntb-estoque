import Link from 'next/link'
import { AlertTriangle, CalendarClock, CalendarX2, Download, PackageCheck, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import type { CampoFiltro } from '@/components/ui-kit/Filtros'
import { btnClass } from '@/components/ui-kit/Button'
import { Indicador, fmtBRL, fmtQtd } from '@/components/estoque-proprio/Apresentacao'
import { BaixaLote, BotaoReconciliar, ConfigAlertaValidade } from '@/components/estoque-proprio/ValidadeAcoes'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { buscarFamilias } from '@/lib/actions/produto'
import { urgenciaValidade, FUNDO_CLASSE, TEXTO_CLASSE } from '@/lib/status-cor'
import { diasAte, somarDias } from '@/lib/estoque/validade-regras'
import { carregarValidadeProprio, PERIODOS_PROPRIO, type LinhaLote, type ParamsValidade } from './dados-proprio'

function dataBR(iso: string) {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

function quando(validade: string, hoje: string): string {
  const d = diasAte(validade, hoje)
  if (d < 0) return d === -1 ? 'venceu ontem' : `venceu há ${-d} dias`
  if (d === 0) return 'vence hoje'
  if (d === 1) return 'vence amanhã'
  return `em ${d} dias`
}

const PARAMS_FILTRO = ['produto', 'tipo', 'familia', 'grupo', 'local'] as const

export async function ValidadeProprio({ lojaId, sp, hoje }: { lojaId: number; sp: ParamsValidade; hoje: string }) {
  const [d, familias] = await Promise.all([carregarValidadeProprio(lojaId, sp, hoje), buscarFamilias()])
  const { filtro, contagens } = d

  const extra = new URLSearchParams()
  for (const k of PARAMS_FILTRO) if (sp[k]) extra.set(k, sp[k] as string)
  const sufixo = extra.toString() ? `&${extra.toString()}` : ''
  const href = (q: string) => `/validade?${q}${sufixo}`

  const exportQs = new URLSearchParams(extra)
  if (sp.modo) exportQs.set('modo', sp.modo)
  if (sp.dias) exportQs.set('dias', sp.dias)

  const campos: CampoFiltro[] = [
    { tipo: 'texto', nome: 'produto', label: 'Produto (nome ou código)' },
    { tipo: 'select', nome: 'tipo', label: 'Tipo de produto', opcoes: PRODUTO_TIPO_ITEM },
    { tipo: 'select', nome: 'familia', label: 'Família', opcoes: familias.map((f) => ({ value: f.descricao, label: f.descricao })) },
    { tipo: 'select', nome: 'grupo', label: 'Grupo', opcoes: d.grupos.map((g) => ({ value: String(g.id), label: g.nome })) },
    { tipo: 'select', nome: 'local', label: 'Local de estoque', opcoes: d.locais.map((l) => ({ value: String(l.codigo), label: l.descricao })) },
  ]

  function buildSortHref(key: string, dir: 'asc' | 'desc'): string {
    const p = new URLSearchParams(extra)
    if (sp.modo) p.set('modo', sp.modo)
    if (sp.dias) p.set('dias', sp.dias)
    p.set('ord', key)
    p.set('dir', dir)
    return `/validade?${p.toString()}`
  }

  // Linha do tempo: quantos lotes em cada faixa, do vencido ao horizonte de 60 dias. Cada faixa filtra a lista.
  const faixas = [
    { chave: 'vencidos', rotulo: 'Vencidos', n: contagens.vencidos, cor: 'bg-err', ativo: filtro.modo === 'vencidos', q: 'modo=vencidos' },
    { chave: 'hoje', rotulo: 'Hoje', n: contagens.hoje, cor: 'bg-warn', ativo: filtro.modo === 'periodo' && filtro.dias === 0, q: 'dias=0' },
    { chave: '7', rotulo: 'Até 7 dias', n: contagens.ate[7] - contagens.hoje, cor: 'bg-warn/60', ativo: filtro.modo === 'periodo' && filtro.dias === 7, q: 'dias=7' },
    { chave: '30', rotulo: '8 a 30 dias', n: contagens.ate[30] - contagens.ate[7], cor: 'bg-brand/50', ativo: filtro.modo === 'periodo' && filtro.dias === 30, q: 'dias=30' },
    { chave: '60', rotulo: '31 a 60 dias', n: contagens.ate[60] - contagens.ate[30], cor: 'bg-brand/25', ativo: filtro.modo === 'periodo' && filtro.dias === 60, q: 'dias=60' },
  ]
  const totalFaixas = faixas.reduce((s, f) => s + Math.max(f.n, 0), 0)

  const pill = (ativo: boolean, perigo?: boolean) =>
    `inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm max-sm:h-9 ${
      ativo ? (perigo ? 'bg-err-fill text-white' : 'bg-brand-fill text-white') : 'bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text'
    }`

  const valorVencido = filtro.modo === 'vencidos' ? d.totais.valor : null

  return (
    <div className="space-y-4">
      <PageHeader
        title="Validade"
        icon={CalendarClock}
        description="Lotes por vencimento. O que vence antes sai antes nas vendas e na produção."
        actions={
          <>
            <ConfigAlertaValidade dias={d.alertaDias} />
            <a href={`/validade/export?${exportQs.toString()}`} className={btnClass('outline')}><Download className="size-4" />Exportar</a>
            <FiltrosGaveta
              basePath="/validade"
              campos={campos}
              defaults={{ produto: sp.produto ?? '', tipo: sp.tipo ?? '', familia: sp.familia ?? '', grupo: sp.grupo ?? '', local: sp.local ?? '' }}
            />
          </>
        }
      />

      <ChipsFiltrosAtivos basePath="/validade" campos={campos} />

      {d.divergencias > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-lg)] bg-warn/10 p-3 text-[13px] ring-1 ring-warn/30">
          <span className="inline-flex items-center gap-2 text-text">
            <AlertTriangle className="size-4 text-warn" />
            {d.divergencias} produto(s) com lotes diferentes do saldo. Acerte para os números desta tela baterem com o estoque.
          </span>
          <BotaoReconciliar />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Lotes vencidos" valor={String(contagens.vencidos)} dica="com saldo no estoque" icon={CalendarX2} href={href('modo=vencidos')} tom={contagens.vencidos ? 'erro' : undefined} />
        <Indicador rotulo={`Vencem em até ${d.alertaDias} dias`} valor={String(contagens.ate[d.alertaDias] ?? 0)} dica={`até ${dataBR(somarDias(hoje, d.alertaDias))}`} icon={CalendarClock} href={href(`dias=${d.alertaDias}`)} tom={(contagens.ate[d.alertaDias] ?? 0) ? 'aviso' : undefined} />
        <Indicador rotulo="Sem validade" valor={String(contagens.semValidade)} dica="lotes ou saldo sem data" icon={PackageCheck} href={href('modo=sem_validade')} />
        <Indicador rotulo={valorVencido != null ? 'Valor vencido' : 'Valor nesta lista'} valor={fmtBRL(d.totais.valor)} dica={`${d.totais.lotes} lote(s) · custo médio`} icon={Wallet} tom={valorVencido ? 'erro' : undefined} />
      </div>

      {totalFaixas > 0 && (
        <section aria-label="Linha do tempo de vencimento" className="rounded-[var(--r-lg)] bg-surface p-4 u-card">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold text-text">Linha do tempo</h2>
            <span className="text-[12px] text-text-muted">próximos 60 dias</span>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
            {faixas.filter((f) => f.n > 0).map((f) => (
              <Link
                key={f.chave}
                href={href(f.q)}
                title={`${f.rotulo}: ${f.n} lote(s)`}
                aria-label={`${f.rotulo}: ${f.n} lote(s)`}
                className={`${f.cor} h-full u-motion hover:opacity-80 ${f.ativo ? 'ring-2 ring-inset ring-text/40' : ''}`}
                style={{ width: `${(f.n / totalFaixas) * 100}%` }}
              />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]">
            {faixas.map((f) => (
              <li key={f.chave}>
                <Link href={href(f.q)} className={`inline-flex items-center gap-1.5 u-motion ${f.ativo ? 'font-semibold text-text' : 'text-text-muted hover:text-text'}`}>
                  <span className={`size-2 rounded-full ${f.cor}`} />
                  {f.rotulo}
                  <span className="num">{Math.max(f.n, 0)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
        <Link href={href('modo=vencidos')} aria-current={filtro.modo === 'vencidos' ? 'page' : undefined} className={pill(filtro.modo === 'vencidos', true)}>
          Vencidos
          <span className={`num text-[12px] ${filtro.modo === 'vencidos' ? 'text-white/80' : contagens.vencidos ? 'text-err' : 'opacity-50'}`}>{contagens.vencidos}</span>
        </Link>
        {PERIODOS_PROPRIO.map((p) => {
          const ativo = filtro.modo === 'periodo' && filtro.dias === p
          const n = contagens.ate[p] ?? 0
          return (
            <Link key={p} href={href(`dias=${p}`)} aria-current={ativo ? 'page' : undefined} className={pill(ativo)}>
              {p === 0 ? 'Vence hoje' : `${p} dias`}
              <span className={`num text-[12px] ${ativo ? 'text-white/80' : n ? 'text-text' : 'opacity-50'}`}>{n}</span>
            </Link>
          )
        })}
        {!PERIODOS_PROPRIO.includes(filtro.dias as (typeof PERIODOS_PROPRIO)[number]) && filtro.modo === 'periodo' && (
          <span className={pill(true)}>{filtro.dias} dias <span className="num text-[12px] text-white/80">{contagens.ate[filtro.dias] ?? 0}</span></span>
        )}
        <Link href={href('modo=sem_validade')} aria-current={filtro.modo === 'sem_validade' ? 'page' : undefined} className={pill(filtro.modo === 'sem_validade')}>
          Sem validade
          <span className={`num text-[12px] ${filtro.modo === 'sem_validade' ? 'text-white/80' : contagens.semValidade ? 'text-text' : 'opacity-50'}`}>{contagens.semValidade}</span>
        </Link>
        <Link href={href('modo=todos')} aria-current={filtro.modo === 'todos' ? 'page' : undefined} className={pill(filtro.modo === 'todos')}>
          Todos
        </Link>
      </div>

      {d.limitado && (
        <p className="text-[12px] text-text-muted">Mostrando os 2.000 primeiros lotes por vencimento. Use os filtros para afunilar.</p>
      )}

      <Lista<LinhaLote>
        linhas={d.linhas}
        chaveLinha={(l) => l.id}
        sortAtual={sp.ord ?? 'validade'}
        dirAtual={sp.dir === 'desc' ? 'desc' : 'asc'}
        sortHref={buildSortHref}
        acao={(l) => (
          <BaixaLote lote={{ id: l.id, produto: formatarNomeProduto(l.produto) || l.produto, codigo: l.codigo, unidade: l.unidade, lote: l.lote, validade: l.validade, saldo: l.saldo, local: l.local }} />
        )}
        colunas={[
          {
            label: 'Produto',
            primaria: true,
            flexivel: true,
            sort: 'produto',
            render: (l) => (
              <span className="min-w-0">
                <Link href={`/estoque/produto/${l.codigoProduto}`} className="text-text hover:underline">{formatarNomeProduto(l.produto) || l.produto}</Link>
                {l.codigo && <span className="num ml-1.5 text-[13px] text-text-muted">{l.codigo}</span>}
                {(l.grupo || l.familia) && <span className="ml-1.5 text-[12px] text-text-muted">· {l.grupo ?? l.familia}</span>}
              </span>
            ),
          },
          {
            label: 'Lote',
            render: (l) => (
              <span className="num text-text">{l.lote ?? <span className="text-text-muted">{l.validade ? '—' : 'sem lote'}</span>}</span>
            ),
          },
          { label: 'Local', sort: 'local', render: (l) => <span className="text-text-muted">{l.local}</span> },
          {
            label: 'Validade',
            sort: 'validade',
            render: (l) => {
              if (!l.validade) return <span className="text-text-muted">sem validade</span>
              const tom = urgenciaValidade(diasAte(l.validade, hoje))
              return (
                <span className="inline-flex items-center gap-2">
                  <span className={`size-2 shrink-0 rounded-full ${FUNDO_CLASSE[tom]}`} />
                  <span className="num text-text">{dataBR(l.validade)}</span>
                  <span className={`text-[12px] ${tom === 'neutro' ? 'text-text-muted' : TEXTO_CLASSE[tom]}`}>{quando(l.validade, hoje)}</span>
                </span>
              )
            },
          },
          {
            label: 'Qtd',
            sort: 'qtd',
            alinhar: 'right',
            render: (l) => (
              <span className="num text-text">
                {fmtQtd(l.saldo)}{l.unidade && <span className="ml-1 text-[13px] text-text-muted">{l.unidade}</span>}
              </span>
            ),
          },
          { label: 'Valor', sort: 'valor', alinhar: 'right', ocultarMobile: true, render: (l) => <span className="num text-text-muted">{fmtBRL(l.valor)}</span> },
        ]}
        vazio={
          <EmptyState
            icon={CalendarClock}
            title={filtro.modo === 'vencidos' ? 'Nenhum lote vencido' : filtro.modo === 'sem_validade' ? 'Tudo com validade' : 'Nada vencendo'}
            hint={
              filtro.modo === 'vencidos'
                ? 'Nenhum lote com saldo passou da validade.'
                : 'Informe lote e validade na entrada (nota fiscal, entrada manual, ordem de produção) ou o prazo de validade no cadastro do produto.'
            }
          />
        }
      />
    </div>
  )
}
