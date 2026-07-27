import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import type { CampoFiltro } from '@/components/ui-kit/filtros-utils'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { btnClass } from '@/components/ui-kit/Button'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { escapeIlike } from '@/lib/utils-busca'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { buscarFamilias } from '@/lib/actions/produto'
import { ArrowDownUp, Download, AlertTriangle } from 'lucide-react'
import {
  buscarMovimentosHistoricoBrutos,
  agregarMovimentacaoJS,
  filtrarLinhasMovHistorico,
  limiteJanelaQuente,
  type LinhaMovHistoricoBruta,
} from '@/lib/historico-contabo'
import { gerarMovimentacaoOperacaoAutomatica } from '@/lib/movimentacao-operacao-auto'
import Link from 'next/link'
import { explicarRotulo } from '@/lib/rotulos-opacos'
import { ChipsPeriodo } from '@/components/ui-kit/ChipsPeriodo'
import { chipsPeriodoPadrao } from '@/lib/periodo-rapido'

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesLabel = (ym: string) => { const [a, m] = ym.split('-'); return `${MESES_ABREV[Number(m) - 1] ?? m}/${a.slice(2)}` }
const fmtData = (d: string) => { const [a, m, dia] = d.split('-'); return `${dia}/${m}/${a}` }
const fmtQtd = (n: number) => (n ? n.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : '-')
const fmtMoeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtQuando = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })

const LIMITE_LINHAS = 200
type LinhaMatriz = { rotulo: string; mes: string; qtde: number; valor: number }
type LinhaOper = { origem: string; sentido: 'E' | 'S'; local: string; tipo_sped: string; familia: string; mes: string; inventario: boolean; qtde: number; valor: number }

// O valor do PDV na SAÍDA é lixo (CMC podre de produto acabado -> valores
// astronômicos). Para tudo o mais, o valor do Omie é confiável.
// No import manual (Excel MOV_DRV), "Movimento Gerado pelo PDV" vinha do CMC
// aproximado de movimentos (reconhecidamente impreciso). No modo automático
// (ver lib/movimentacao-operacao-auto.ts) esse valor vem do fato de cupom
// (fat_cupom_itens.v_item) -- item a item, real, não uma aproximação -- então
// não deve ser marcado como não-confiável.
const valorConfiavel = (origem: string, sentido: 'E' | 'S', automatico: boolean) => automatico || !(/pdv/i.test(origem) && sentido === 'S')

export default async function RelatorioMovimentacaoPage({
  searchParams,
}: {
  searchParams: Promise<{
    data_inicio?: string; data_final?: string; sentido?: string; modo?: string
    op?: string; loc?: string; sent?: string; dim?: string
    produto?: string; tipo?: string; familia?: string; local?: string
    drill?: string
  }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) notFound()

  const sp = await searchParams
  const modo = sp.modo === 'operacao' ? 'operacao' : 'quantidade'
  const supabase = createServiceClient()

  const th = 'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted'

  const seg = (
    <SegmentLinks
      basePath="/relatorio-movimentacao"
      param="modo"
      aria-label="Modo"
      opcoes={[
        { value: '', label: 'Em quantidade (produto)' },
        { value: 'operacao', label: 'Por operação (R$)' },
      ]}
    />
  )

  // ---------- Modo: Por operação (R$) — vem da aba BD do MOV_DRV ----------
  if (modo === 'operacao') {
    // O agregado tem ~milhares de linhas; o PostgREST corta em 1000 por padrão.
    // Pagina para trazer TODAS (senão os totais saem subcontados).
    async function selTodos(): Promise<LinhaOper[]> {
      const PAGE = 1000
      const todos: LinhaOper[] = []
      for (let p = 0; ; p++) {
        const { data, error } = await supabase
          .from('movimentacao_operacao')
          .select('origem, sentido, local, tipo_sped, familia, mes, inventario, qtde, valor')
          .eq('loja_id', lojaId)
          .order('valor', { ascending: false })
          .range(p * PAGE, p * PAGE + PAGE - 1)
        if (error || !data?.length) break
        todos.push(...(data as LinhaOper[]))
        if (data.length < PAGE) break
      }
      return todos
    }
    const [rowsImportadas, { data: metaRow }] = await Promise.all([
      selTodos(),
      supabase.from('movimentacao_operacao_meta').select('importado_em').eq('loja_id', lojaId).maybeSingle(),
    ])
    // Import manual do Excel MOV_DRV só existia pra loja 3 -- pra qualquer
    // outra loja sem import, reconstrói a mesma matriz automaticamente a
    // partir de NF (compra), fato de cupom (PDV) e ajustes (manual/inventário),
    // já sincronizados pra todas as lojas (ver lib/movimentacao-operacao-auto.ts).
    const usarAutomatico = rowsImportadas.length === 0
    const rows = usarAutomatico ? await gerarMovimentacaoOperacaoAutomatica(lojaId, sp.produto) : rowsImportadas

    // Filtros (multi-select): operação, local, sentido, família, tipo.
    const opsSel = valoresMulti(sp.op)
    const locsSel = valoresMulti(sp.loc)
    const sentSel = valoresMulti(sp.sent).filter((v): v is 'E' | 'S' => v === 'E' || v === 'S')
    const familiasSel = valoresMulti(sp.familia)
    const tiposSel = valoresMulti(sp.tipo)
    // Periodo: movimentacao_operacao guarda so 'YYYY-MM' (sem dia) — o filtro tem
    // granularidade de MES; o dia escolhido no seletor e ignorado de proposito.
    // Sem filtro explicito, escopo pedido pelo usuario 2026-07-19: só ano
    // corrente (não precisa de nada do ano passado por padrão).
    const anoCorrenteOp = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' }).slice(0, 4)
    const mesIniOp = sp.data_inicio ? sp.data_inicio.slice(0, 7) : `${anoCorrenteOp}-01`
    const mesFimOp = sp.data_final ? sp.data_final.slice(0, 7) : null
    const origens = [...new Set(rows.map((r) => r.origem))].sort()
    const locais = [...new Set(rows.map((r) => r.local))].sort()
    const familiasOper = [...new Set(rows.map((r) => r.familia))].filter(Boolean).sort()
    const tiposSped = [...new Set(rows.map((r) => r.tipo_sped))].filter(Boolean).sort()

    const campos: CampoFiltro[] = [
      { tipo: 'texto', nome: 'produto', label: 'Produto (nome ou código)' },
      { tipo: 'multi-select', nome: 'op', label: 'Operação', opcoes: origens.map((o) => ({ value: o, label: o })) },
      { tipo: 'multi-select', nome: 'loc', label: 'Local de estoque', opcoes: locais.map((l) => ({ value: l, label: l })) },
      { tipo: 'multi-select', nome: 'sent', label: 'Sentido', opcoes: [{ value: 'E', label: 'Entrada' }, { value: 'S', label: 'Saída' }] },
      { tipo: 'multi-select', nome: 'familia', label: 'Família', opcoes: familiasOper.map((f) => ({ value: f, label: f })) },
      { tipo: 'multi-select', nome: 'tipo', label: 'Tipo (SPED)', opcoes: tiposSped.map((t) => ({ value: t, label: t })) },
      { tipo: 'data', nome: 'data_inicio', label: 'Mês inicial (dia é ignorado)' },
      { tipo: 'data', nome: 'data_final', label: 'Mês final (dia é ignorado)' },
    ]

    const anoCorrenteChip = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' }).slice(0, 4)
    const chipsPeriodoOp = chipsPeriodoPadrao({ value: '', label: 'Ano corrente', dataIni: `${anoCorrenteChip}-01-01`, dataFim: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' }) })
    const header = (
      <ListaHeader>
        <PageHeader
          title="Movimentação"
          icon={ArrowDownUp}
          description={
            usarAutomatico
              ? 'Por operação, local e tipo — em R$ (automático: NF + PDV + ajustes) — BETA'
              : 'Por operação, local e tipo — em R$ (importado do MOV_DRV) — BETA'
          }
          voltarHref="/relatorios"
          actions={
            <>
              <FiltrosGaveta
                basePath="/relatorio-movimentacao"
                campos={campos}
                defaults={{ produto: sp.produto ?? '', op: sp.op ?? '', loc: sp.loc ?? '', sent: sp.sent ?? '', familia: sp.familia ?? '', tipo: sp.tipo ?? '', data_inicio: sp.data_inicio ?? '', data_final: sp.data_final ?? '' }}
                persistirEm="/relatorio-movimentacao-op"
              />
              <a
                href={`/relatorio-movimentacao/export?modo=operacao${sp.produto ? `&produto=${encodeURIComponent(sp.produto)}` : ''}${sp.op ? `&op=${encodeURIComponent(sp.op)}` : ''}${sp.loc ? `&loc=${encodeURIComponent(sp.loc)}` : ''}${sp.sent ? `&sent=${encodeURIComponent(sp.sent)}` : ''}${sp.familia ? `&familia=${encodeURIComponent(sp.familia)}` : ''}${sp.tipo ? `&tipo=${encodeURIComponent(sp.tipo)}` : ''}${sp.data_inicio ? `&data_inicio=${sp.data_inicio}` : ''}${sp.data_final ? `&data_final=${sp.data_final}` : ''}`}
                target="_blank" rel="noopener noreferrer" className={btnClass('outline')}
                title="Excel: operações + perdas + matriz (com filtros)"
              >
                <Download className="size-4" /> Baixar
              </a>
            </>
          }
        />
        <ChipsFiltrosAtivos basePath="/relatorio-movimentacao" campos={campos} persistirEm="/relatorio-movimentacao-op" />
        <ChipsPeriodo basePath="/relatorio-movimentacao" opcoes={chipsPeriodoOp} />
      </ListaHeader>
    )

    if (!rows.length) {
      return (
        <div className="space-y-4">
          {header}
          {seg}
          <EmptyState
            icon={ArrowDownUp}
            title="Sem movimentação por operação importada"
            hint='A operação (compra, perda, OP, PDV) e o local só vêm da aba "BD" do MOV_DRV do Omie. Esse arquivo é grande — a importação é feita pelo suporte (script). Fale com o Joaquim para atualizar.'
          />
        </div>
      )
    }

    // --- Cards executivos (sempre sobre TODOS os dados, visão de gestão) ---
    const somaSe = (fn: (r: LinhaOper) => boolean) => rows.filter(fn).reduce((s, r) => s + Number(r.valor), 0)
    const perdasReais = somaSe((r) => r.origem === 'Movimento Manual de Estoque' && r.sentido === 'S' && !r.inventario)
    const ajusteInv = somaSe((r) => r.origem === 'Movimento Manual de Estoque' && r.sentido === 'S' && r.inventario)
    const compras = somaSe((r) => /compra/i.test(r.origem) && r.sentido === 'E')
    const consumoOP = somaSe((r) => /consumo da ordem/i.test(r.origem) && r.sentido === 'S')

    // --- Tabela por operação (origem × sentido), respeitando filtro de local ---
    const baseLocal = locsSel.length ? rows.filter((r) => locsSel.includes(r.local)) : rows
    const porOper = new Map<string, { origem: string; sentido: 'E' | 'S'; qtde: number; valor: number; conf: boolean }>()
    for (const r of baseLocal) {
      const k = `${r.origem}|${r.sentido}`
      const e = porOper.get(k) ?? { origem: r.origem, sentido: r.sentido, qtde: 0, valor: 0, conf: valorConfiavel(r.origem, r.sentido, usarAutomatico) }
      e.qtde += Number(r.qtde); e.valor += Number(r.valor)
      porOper.set(k, e)
    }
    const opers = [...porOper.values()].sort((a, b) => (b.conf ? b.valor : 0) - (a.conf ? a.valor : 0))
    const totalOperValor = opers.filter((o) => o.conf).reduce((s, o) => s + o.valor, 0)

    // --- Matriz mês a mês, sempre com família + local + tipo juntos (sem
    // precisar clicar numa linha pra "entrar" na próxima dimensão) --- filtros
    // op/loc/sent/familia/tipo já estreitam o recorte pela gaveta de filtros.
    const filtradas = rows.filter((r) =>
      (!opsSel.length || opsSel.includes(r.origem)) &&
      (!locsSel.length || locsSel.includes(r.local)) &&
      (!sentSel.length || sentSel.includes(r.sentido)) &&
      (!familiasSel.length || familiasSel.includes(r.familia)) &&
      (!tiposSel.length || tiposSel.includes(r.tipo_sped)) &&
      (!mesIniOp || r.mes >= mesIniOp) &&
      (!mesFimOp || r.mes <= mesFimOp)
    )
    // Se o recorte ficou só com PDV-saída (valor lixo), a matriz mostra QUANTIDADE.
    const soPdvSaida = filtradas.length > 0 && filtradas.every((r) => !valorConfiavel(r.origem, r.sentido, usarAutomatico))
    const usarQtde = soPdvSaida
    const meses = [...new Set(filtradas.map((r) => r.mes))].sort()
    // Chave combinada (família, local, tipo) -- JSON.stringify em vez de
    // concatenar com separador: rótulo de família/local vem de cadastro sem
    // sanitização e pode conter qualquer caractere (achado real desta sessão
    // em lib/omie/faturamento.ts, mesma classe de bug).
    const porDim = new Map<string, { familia: string; local: string; tipo: string; total: number; meses: Record<string, number> }>()
    for (const r of filtradas) {
      const familia = r.familia || 'N/D'
      const local = r.local || 'N/D'
      const tipo = r.tipo_sped || 'N/D'
      const chave = JSON.stringify([familia, local, tipo])
      const v = usarQtde ? Number(r.qtde) : (valorConfiavel(r.origem, r.sentido, usarAutomatico) ? Number(r.valor) : 0)
      const ent = porDim.get(chave) ?? { familia, local, tipo, total: 0, meses: {} }
      ent.meses[r.mes] = (ent.meses[r.mes] ?? 0) + v
      ent.total += v
      porDim.set(chave, ent)
    }
    const linhasDim = [...porDim.values()].filter((e) => e.total !== 0).sort((a, b) => b.total - a.total)
    const totalPorMes: Record<string, number> = {}
    for (const e of linhasDim) for (const m of meses) totalPorMes[m] = (totalPorMes[m] ?? 0) + (e.meses[m] ?? 0)
    const totalGeral = Object.values(totalPorMes).reduce((s, v) => s + v, 0)
    const fmtCel = usarQtde ? fmtQtd : (n: number) => (n ? fmtMoeda(n) : '-')

    const cardCls = 'rounded-lg border border-border bg-surface px-3.5 py-3'

    return (
      <div className="space-y-4">
        {header}
        {seg}

        {/* Cards executivos */}
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <div className={cardCls}>
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-err">
              <AlertTriangle className="size-3.5" /> Perdas reais
            </p>
            <p className="num mt-1 text-[15px] font-semibold text-text">{fmtMoeda(perdasReais)}</p>
            <p className="text-[12px] text-text-muted">baixa manual (fora inventário)</p>
          </div>
          <div className={cardCls}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-warn">Ajuste por inventário</p>
            <p className="num mt-1 text-[15px] font-semibold text-text">{fmtMoeda(ajusteInv)}</p>
            <p className="text-[12px] text-text-muted">baixa manual por contagem</p>
          </div>
          <div className={cardCls}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-info">Compras (entrada)</p>
            <p className="num mt-1 text-[15px] font-semibold text-text">{fmtMoeda(compras)}</p>
            <p className="text-[12px] text-text-muted">entrada por nota</p>
          </div>
          <div className={cardCls}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Consumo de OP</p>
            <p className="num mt-1 text-[15px] font-semibold text-text">{fmtMoeda(consumoOP)}</p>
            <p className="text-[12px] text-text-muted">insumo consumido na produção</p>
          </div>
        </div>

        {/* Tabela por operação */}
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="bg-surface-2">
                <th className={`text-left ${th}`}>Operação{locsSel.length ? ` · ${locsSel.join(', ')}` : ''}</th>
                <th className={`text-left ${th}`}>Sentido</th>
                <th className={`text-right ${th}`}>Quantidade</th>
                <th className={`text-right ${th}`}>Valor</th>
                <th className={`text-right ${th}`}>%</th>
              </tr>
            </thead>
            <tbody>
              {opers.map((o) => (
                <tr key={`${o.origem}|${o.sentido}`} className="border-t border-border/60 hover:bg-surface-2/40">
                  <td className="max-w-[280px] truncate px-3 py-2 text-text" title={o.origem}>{o.origem}</td>
                  <td className="px-3 py-2 text-text-muted">{o.sentido === 'E' ? 'Entrada' : 'Saída'}</td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{fmtQtd(o.qtde)}</td>
                  <td className={`num whitespace-nowrap px-3 py-2 text-right ${o.conf ? 'font-medium text-text' : 'text-text-muted'}`}>
                    {o.conf ? fmtMoeda(o.valor) : 'não-confiável'}
                  </td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">
                    {o.conf && totalOperValor > 0 ? `${((o.valor / totalOperValor) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-1 text-[11px] text-text-muted">
          {usarAutomatico
            ? 'Valor do PDV vem do fato de cupom (item a item, valor real de venda).'
            : 'O valor do PDV na saída não é confiável (custo médio de produto acabado fica distorcido no Omie) — use o modo "Em quantidade" para volume de venda.'}
          {metaRow?.importado_em && <> · Importado em {fmtQuando(metaRow.importado_em as string)}.</>}
        </p>

        {/* Matriz mês a mês: família + local + tipo sempre juntos, sem precisar
            clicar numa linha pra ver o resto -- estreita pelos filtros da gaveta. */}
        {linhasDim.length === 0 ? (
          <EmptyState icon={ArrowDownUp} title="Sem dados no recorte" hint="Ajuste os filtros de operação, local, família e tipo." />
        ) : (
          <div className="space-y-1.5">
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="bg-surface-2">
                    <th className={`sticky left-0 z-20 bg-surface-2 text-left ${th}`}>Família</th>
                    <th className={`text-left ${th}`}>Local</th>
                    <th className={`text-left ${th}`}>Tipo (SPED)</th>
                    {meses.map((m) => (<th key={m} className={`text-right ${th}`}>{mesLabel(m)}</th>))}
                    <th className={`text-right ${th}`}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasDim.slice(0, LIMITE_LINHAS).map((e) => {
                    const opaco = explicarRotulo(e.familia)
                    const chave = `${e.familia}|${e.local}|${e.tipo}`
                    return (
                    <tr key={chave} className="border-t border-border/60 hover:bg-surface-2/40">
                      <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-text" title={opaco?.motivo ?? e.familia}>
                        <div className="max-w-[160px] truncate">
                          {opaco?.label ?? (formatarNomeProduto(e.familia) || e.familia)}
                          {opaco && <span className="ml-1 text-text-muted" aria-hidden>ⓘ</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-text-muted"><div className="max-w-[140px] truncate">{e.local}</div></td>
                      <td className="px-3 py-2 text-text-muted"><div className="max-w-[140px] truncate">{e.tipo}</div></td>
                      {meses.map((m) => (<td key={m} className="num whitespace-nowrap px-2 py-1.5 text-right text-text-muted">{fmtCel(e.meses[m] ?? 0)}</td>))}
                      <td className="num whitespace-nowrap px-2 py-1.5 text-right font-medium text-text">{fmtCel(e.total)}</td>
                    </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-surface-2/70 font-semibold">
                    <td className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-text" colSpan={3}>Total</td>
                    {meses.map((m) => (<td key={m} className="num whitespace-nowrap px-2 py-1.5 text-right text-text">{fmtCel(totalPorMes[m] ?? 0)}</td>))}
                    <td className="num whitespace-nowrap px-2 py-1.5 text-right text-text">{fmtCel(totalGeral)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="px-1 text-[11px] text-text-muted">
              {usarQtde
                ? 'Recorte só com PDV na saída: mostrando QUANTIDADE (valor não-confiável).'
                : 'Valores em R$ por mês. O PDV na saída entra como 0 (valor distorcido no Omie).'}
              {linhasDim.length > LIMITE_LINHAS && ` Mostrando as ${LIMITE_LINHAS} maiores de ${linhasDim.length}.`}
            </p>
          </div>
        )}
      </div>
    )
  }

  // ---------- Modo: Em quantidade (por produto, dado nativo) ----------
  const tiposSel = valoresMulti(sp.tipo)
  const familiasSel = valoresMulti(sp.familia)
  const locaisSel = valoresMulti(sp.local)
  const produtoBusca = sp.produto?.trim() || null

  const [familiasOpcoes, { data: locaisRaw }] = await Promise.all([
    buscarFamilias(),
    supabase
      .from('local_estoques')
      .select('codigo_local_estoque, descricao')
      .eq('loja_id', lojaId)
      .neq('inativo', 'S')
      .order('descricao'),
  ])
  const locaisOpcoes = locaisRaw ?? []

  // Produtos que casam com tipo/família — mesmo padrão de codigosFiltro usado em
  // /movimentacoes e /ordem-producao (cruza via a tabela produtos).
  // Paginado com .range()+.order('id') -- achado real (auditoria 2026-07-18, mesmo
  // padrao do bug ja corrigido em relatorio-indicadores/page.tsx): 5 das 6 lojas
  // ativas tem mais de 1000 produtos, e um .select() sem paginacao cortava
  // silenciosamente no limite do PostgREST, excluindo produtos do filtro de
  // tipo/familia sem erro nem aviso.
  let codigosFiltro: number[] | null = null
  if (tiposSel.length || familiasSel.length) {
    const PAGE = 1000
    const produtosFiltrados: { codigo_produto: number | null }[] = []
    for (let p = 0; ; p++) {
      let pq = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId).order('id').range(p * PAGE, p * PAGE + PAGE - 1)
      if (tiposSel.length) pq = pq.in('tipo_item', tiposSel)
      if (familiasSel.length) pq = pq.in('descricao_familia', familiasSel)
      const { data, error } = await pq
      if (error || !data?.length) break
      produtosFiltrados.push(...data)
      if (data.length < PAGE) break
    }
    codigosFiltro = [...new Set(produtosFiltrados.map((p) => p.codigo_produto).filter((v): v is number => v != null))]
  }
  // Local de estoque: movimentos_historico não guarda local por movimento (o
  // ListarMovimentos do Omie não traz essa informação) — restringe aos produtos
  // que têm posição de estoque no(s) local(is) escolhido(s) (mesmo padrão de
  // relatorio_estoque_valorizado). Paginado pelo mesmo motivo acima: locais
  // "principais" (depósito) rotineiramente passam de 1000 posições por loja.
  if (locaisSel.length) {
    const PAGE = 1000
    const posicoes: { n_cod_prod: number | null }[] = []
    for (let p = 0; ; p++) {
      const { data, error } = await supabase
        .from('posicao_estoques')
        .select('n_cod_prod')
        .eq('loja_id', lojaId)
        .in('codigo_local_estoque', locaisSel.map(Number))
        .order('id')
        .range(p * PAGE, p * PAGE + PAGE - 1)
      if (error || !data?.length) break
      posicoes.push(...data)
      if (data.length < PAGE) break
    }
    const codigosLocal = new Set(posicoes.map((p) => p.n_cod_prod as number))
    codigosFiltro = codigosFiltro === null ? [...codigosLocal] : codigosFiltro.filter((c) => codigosLocal.has(c))
  }
  const codigosIn = codigosFiltro !== null ? (codigosFiltro.length ? codigosFiltro : [-1]) : null

  const exportQs = new URLSearchParams()
  if (sp.data_inicio) exportQs.set('data_inicio', sp.data_inicio)
  if (sp.data_final) exportQs.set('data_final', sp.data_final)
  if (sp.produto) exportQs.set('produto', sp.produto)
  if (sp.tipo) exportQs.set('tipo', sp.tipo)
  if (sp.familia) exportQs.set('familia', sp.familia)
  if (sp.local) exportQs.set('local', sp.local)
  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
    { tipo: 'texto', nome: 'produto', label: 'Produto (nome ou código)' },
    { tipo: 'multi-select', nome: 'tipo', label: 'Tipo de produto', opcoes: PRODUTO_TIPO_ITEM },
    { tipo: 'multi-select', nome: 'familia', label: 'Família', opcoes: familiasOpcoes.map((f) => ({ value: f.descricao, label: f.descricao })) },
    {
      tipo: 'multi-select',
      nome: 'local',
      label: 'Local de estoque',
      opcoes: locaisOpcoes.map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })),
    },
  ]
  const hojeISOQtd = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const chipsPeriodoQtd = chipsPeriodoPadrao({ value: '', label: 'Ano corrente', dataIni: `${hojeISOQtd.slice(0, 4)}-01-01`, dataFim: hojeISOQtd })
  const header = (
    <ListaHeader>
      <PageHeader
        title="Movimentação"
        icon={ArrowDownUp}
        description="Consumo e baixas — em quantidade por produto ou em R$ por operação (BETA)"
        voltarHref="/relatorios"
        actions={
          <>
            <FiltrosGaveta
              basePath="/relatorio-movimentacao"
              campos={campos}
              defaults={{
                data_inicio: sp.data_inicio ?? '',
                data_final: sp.data_final ?? '',
                produto: sp.produto ?? '',
                tipo: sp.tipo ?? '',
                familia: sp.familia ?? '',
                local: sp.local ?? '',
              }}
              persistirEm="/relatorio-movimentacao"
            />
            <a href={`/relatorio-movimentacao/export${exportQs.toString() ? `?${exportQs}` : ''}`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')} title="Excel: saídas/entradas por produto (com filtros)">
              <Download className="size-4" /> Baixar
            </a>
          </>
        }
      />
      <ChipsFiltrosAtivos basePath="/relatorio-movimentacao" campos={campos} persistirEm="/relatorio-movimentacao" />
      <ChipsPeriodo basePath="/relatorio-movimentacao" opcoes={chipsPeriodoQtd} />
    </ListaHeader>
  )

  const sentido = sp.sentido === 'entradas' ? 'entradas' : 'saidas'
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_inicio ?? '') ? sp.data_inicio! : `${hojeISOQtd.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_final ?? '') ? sp.data_final! : hojeISOQtd

  async function rpcTodos<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
    const PAGE = 1000
    const todos: T[] = []
    for (let p = 0; ; p++) {
      const { data, error } = await supabase.rpc(fn, args).range(p * PAGE, p * PAGE + PAGE - 1)
      if (error || !data?.length) break
      todos.push(...(data as T[]))
      if (data.length < PAGE) break
    }
    return todos
  }

  const cutoff = limiteJanelaQuente()
  const iniRpc = ini < cutoff ? cutoff : ini
  // Achado real (auditoria de relatorios, 2026-07-26): iniRpc inclui `cutoff`
  // (piso do lado quente) e o fetch frio abaixo tambem incluia `cutoff`
  // (teto do lado frio) -- o dia exato do corte entrava 2x (RPC + JS),
  // inflando entradas/saidas. corteExcl (1 dia antes) mesmo padrao ja usado
  // em relatorio-compras/page.tsx (corteExcl/dataFinalFria).
  const corteExcl = new Date(Date.parse(cutoff) - 86400000).toISOString().slice(0, 10)
  const matrizRecente = await rpcTodos<LinhaMatriz>('relatorio_movimentacao_matriz', {
    p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, p_dim: 'produto', p_sentido: sentido,
    p_cod_prods: codigosIn, p_produto: produtoBusca ? escapeIlike(produtoBusca) : null,
  })

  let matriz = matrizRecente
  if (ini < cutoff) {
    // Se o periodo pedido termina antes do corte (fim < corteExcl -- recorte
    // todo dentro do historico frio), usa fim; senao usa corteExcl fixo (o
    // resto, de cutoff em diante, ja vem do RPC acima).
    const dataFinalFria = fim < corteExcl ? fim : corteExcl
    const brutasTodas = await buscarMovimentosHistoricoBrutos<LinhaMovHistoricoBruta>({
      lojaId, dataInicio: ini, dataFinal: dataFinalFria,
    })
    const brutas = filtrarLinhasMovHistorico(brutasTodas, codigosIn, produtoBusca)
    const { data: metaRows } = await supabase
      .from('produtos')
      .select('codigo_produto, tipo_item, descricao_familia')
      .eq('loja_id', lojaId)
    const metaPorCodigo = new Map((metaRows ?? []).map((m) => [m.codigo_produto, m]))
    const { data: precoRows } = await supabase
      .from('nota_fiscal_items')
      .select('n_id_produto, n_preco_unit, notas_fiscais!inner(deleted_at)')
      .eq('loja_id', lojaId)
      .gt('n_preco_unit', 0)
    const precoPorProduto = new Map<number, number>()
    for (const r of (precoRows ?? []) as { n_id_produto: number; n_preco_unit: number }[]) {
      if (r.n_id_produto && !precoPorProduto.has(r.n_id_produto)) precoPorProduto.set(r.n_id_produto, r.n_preco_unit)
    }
    const antiga = agregarMovimentacaoJS(brutas, metaPorCodigo, precoPorProduto, 'produto', sentido)
    const combinados = new Map<string, LinhaMatriz>()
    for (const linha of [...antiga, ...matrizRecente]) {
      // JSON.stringify em vez de "|" concatenado: rotulo vem de descricao de
      // produto sem sanitizacao, e um "|" no nome colidiria 2 chaves
      // diferentes (mesmo achado real ja corrigido em lib/omie/faturamento.ts).
      const chave = JSON.stringify([linha.rotulo, linha.mes])
      const acc = combinados.get(chave) ?? { rotulo: linha.rotulo, mes: linha.mes, qtde: 0, valor: 0 }
      // Number() e essencial aqui: matrizRecente vem de uma RPC (numeric via
      // PostgREST serializa como STRING no JSON, apesar do tipo TS dizer
      // number) -- sem isso, "+=" concatena string em vez de somar, e o
      // valor final vira um numero gigante sem sentido (achado real: tela
      // de Movimentacao mostrando "650.130.950...000" com 50+ digitos).
      acc.qtde += Number(linha.qtde) || 0
      acc.valor += Number(linha.valor) || 0
      combinados.set(chave, acc)
    }
    matriz = [...combinados.values()]
  }

  const meses = [...new Set(matriz.map((m) => m.mes))].sort()
  const porRotulo = new Map<string, { total: number; meses: Record<string, number> }>()
  for (const r of matriz) {
    const ent = porRotulo.get(r.rotulo) ?? { total: 0, meses: {} }
    const q = Number(r.qtde) || 0
    ent.meses[r.mes] = (ent.meses[r.mes] ?? 0) + q
    ent.total += q
    porRotulo.set(r.rotulo, ent)
  }
  const ordenadas = [...porRotulo.entries()].sort((a, b) => b[1].total - a[1].total)
  const linhas = ordenadas.slice(0, LIMITE_LINHAS).map(([rotulo, ent]) => ({ rotuloRaw: rotulo, rotulo: formatarNomeProduto(rotulo) || rotulo, meses: ent.meses, total: ent.total }))
  const ocultadas = ordenadas.length - linhas.length
  const totalPorMes: Record<string, number> = {}
  for (const [, ent] of porRotulo) for (const m of meses) totalPorMes[m] = (totalPorMes[m] ?? 0) + (ent.meses[m] ?? 0)

  return (
    <div className="space-y-4">
      {header}
      {seg}

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13px] text-text-muted">Período: {fmtData(ini)} a {fmtData(fim)}</span>
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Produtos <span className="num font-semibold text-text">{ordenadas.length}</span>
        </span>
      </div>

      <SegmentLinks
        basePath="/relatorio-movimentacao"
        param="sentido"
        aria-label="Sentido"
        opcoes={[
          { value: '', label: 'Saídas (consumo/venda)' },
          { value: 'entradas', label: 'Entradas' },
        ]}
      />

      {linhas.length === 0 ? (
        <EmptyState icon={ArrowDownUp} title="Sem movimentação no período" hint="Ajuste o período. O histórico cobre cerca de 1 ano." />
      ) : (
        <div className="space-y-1.5">
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2">
                  <th className={`sticky left-0 z-20 bg-surface-2 text-left ${th}`}>Produto</th>
                  {meses.map((m) => (<th key={m} className={`text-right ${th}`}>{mesLabel(m)}</th>))}
                  <th className={`text-right ${th}`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.rotulo} className="border-t border-border/60 hover:bg-surface-2/40">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-text" title={l.rotulo}>
                      <div className="max-w-[140px] truncate">
                        {/* Nível máximo do dado aqui é o produto: o "item" é o extrato
                            da aba Movimentos, que já existe — leva pra lá. */}
                        <Link href={`/movimentacoes?produto=${encodeURIComponent(l.rotuloRaw)}`} className="hover:underline">{l.rotulo}</Link>
                      </div>
                    </td>
                    {meses.map((m) => (<td key={m} className="num whitespace-nowrap px-2 py-1.5 text-right text-[12px] text-text-muted">{fmtQtd(l.meses[m] ?? 0)}</td>))}
                    <td className="num whitespace-nowrap px-2 py-1.5 text-right text-[12px] font-medium text-text">{fmtQtd(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-1 text-[11px] text-text-muted">
            {/* Sem linha de total geral de propósito: somar kg + un + cx de produtos
                diferentes dava um numero gigante sem significado (feedback 18/07). */}
            Quantidades na unidade de cada produto (kg, un, cx...) — por isso não há total geral. Para R$, use o modo &quot;Por operação&quot;.
            {ocultadas > 0 && ` Mostrando os ${LIMITE_LINHAS} maiores de ${ordenadas.length}.`}
          </p>
        </div>
      )}
    </div>
  )
}
