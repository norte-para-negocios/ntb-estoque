import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, ShoppingCart } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import { valoresMulti, type CampoFiltro } from '@/components/ui-kit/filtros-utils'
import { CartaoResumo as Card } from '@/components/faturamento/CartaoResumo'
import { TabelaSugestao } from '@/components/compras/TabelaSugestao'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { carregarSugestao, lerParamsSugestao } from '@/lib/compras/sugestao-dados'
import { ehVisaoMinimo, filtrarSugestao, resumoMinimo, resumoSugestao } from '@/lib/compras/sugestao-puro'

type Sp = Record<string, string | undefined>

const LIMITE_LINHAS = 400
const campo = 'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-2.5 py-1.5 text-sm text-text outline-none focus:ring-2 focus:ring-brand/40'
const rotulo = 'mb-1 block text-[11px] font-medium text-text-muted'
const dataBR = (iso: string) => iso.split('-').reverse().join('/')

export default async function SugestaoCompraPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const lojaId = await getCurrentLojaId()
  const modo = await modoDaLoja(lojaId)
  if (modo === 'nenhum') notFound()
  if (!(await requirePermissao(lojaId, 'Compras - Sugestao'))) notFound()
  const proprio = modo === 'proprio'
  const podePedido = proprio && (await requirePermissao(lojaId, 'Compras - Pedidos'))
  const podeRequisicao = proprio && (await requirePermissao(lojaId, 'Compras - Requisicoes'))

  const sp = await searchParams
  const hoje = hojeBahiaISO()
  const p = lerParamsSugestao(sp, hoje)
  const { linhas, erro, avisos } = await carregarSugestao(lojaId, modo, p)
  const filtro = { q: sp.q, tipos: valoresMulti(sp.tipo), familia: sp.familia, ver: sp.ver, acao: sp.acao, fornecedor: sp.fornecedor }
  const vis = filtrarSugestao(linhas, filtro)
  const res = resumoSugestao(vis)
  const visaoMinimo = ehVisaoMinimo(sp.ver)
  const resMin = resumoMinimo(vis)
  const pagina = vis.slice(0, LIMITE_LINHAS)

  const familias = [...new Set(linhas.map((l) => l.familia))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const fornecedores = [...new Set(linhas.map((l) => l.fornecedorNome).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const campos: CampoFiltro[] = [
    { tipo: 'texto', nome: 'q', label: 'Produto (nome ou código)' },
    { tipo: 'select', nome: 'ver', label: 'Mostrar', opcoes: [{ value: '', label: 'Comprar ou produzir' }, { value: 'imediato', label: 'Só imediatamente' }, { value: 'todos', label: 'Todos (inclui não comprar)' }, { value: 'abaixo', label: 'Abaixo do estoque mínimo' }, { value: 'minimo', label: 'Estoque mínimo (todos com mínimo)' }] },
    { tipo: 'select', nome: 'acao', label: 'Ação', opcoes: [{ value: '', label: 'Comprar e produzir' }, { value: 'comprar', label: 'Só comprar' }, { value: 'produzir', label: 'Só produzir' }] },
    { tipo: 'multi-select', nome: 'tipo', label: 'Tipo do produto (padrão: sem ativo, serviço e outras)', opcoes: PRODUTO_TIPO_ITEM },
    { tipo: 'combobox', nome: 'familia', label: 'Família', opcoes: familias.map((f) => ({ value: f, label: f })) },
    { tipo: 'combobox', nome: 'fornecedor', label: 'Fornecedor (da última nota)', opcoes: fornecedores.map((f) => ({ value: f, label: f })) },
  ]
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString()

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sugestão de compra"
        icon={ShoppingCart}
        description="O que comprar ou produzir, pela mesma fórmula do Omie: consumo médio, ponto de pedido, entradas previstas e projeção de saídas. Os números podem diferir dos do Omie se o histórico de lá mudou depois da nossa leitura."
        voltarHref="/relatorios"
        actions={
          <>
            {proprio && <Link href="/pedido-compra" className={btnClass('outline')}>Pedidos de compra</Link>}
            <a href={`/sugestao-compra/excel${qs ? `?${qs}` : ''}`} className={btnClass('outline')}><Download className="size-4" /> Excel</a>
          </>
        }
      />

      <form method="get" className="grid grid-cols-2 items-end gap-3 rounded-[var(--r-lg)] bg-surface p-3 shadow-[var(--shadow-sm)] lg:grid-cols-[1fr_1fr_1fr_1fr_1.2fr_auto]">
        {Object.entries(sp).filter(([k, v]) => v && !['aIni', 'aFim', 'eIni', 'eFim', 'proj'].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div><label className={rotulo} htmlFor="s-ai">Análise do consumo: de</label><input id="s-ai" type="date" name="aIni" defaultValue={p.ini} className={campo} /></div>
        <div><label className={rotulo} htmlFor="s-af">até</label><input id="s-af" type="date" name="aFim" defaultValue={p.fim} max={hoje} className={campo} /></div>
        <div><label className={rotulo} htmlFor="s-ei">Estimativa: de</label><input id="s-ei" type="date" name="eIni" defaultValue={p.projIni} className={campo} /></div>
        <div><label className={rotulo} htmlFor="s-ef">até</label><input id="s-ef" type="date" name="eFim" defaultValue={p.projFim} className={campo} /></div>
        <div><label className={rotulo} htmlFor="s-pj">Projeção de saídas</label>
          <select id="s-pj" name="proj" defaultValue={p.base === 'previsao' ? 'previsao' : ''} className={campo}>
            <option value="">Consumo médio (fórmula do Omie)</option>
            <option value="previsao">Previsão de venda + OPs abertas</option>
          </select></div>
        <div className="flex gap-2"><button type="submit" className={btnClass('primary')}>Calcular</button><Link href="/sugestao-compra" className={btnClass('outline')}>Padrão</Link></div>
        <p className="col-span-full text-[12px] text-text-muted">
          {p.diasAnalise} dias de análise ({dataBR(p.ini)} a {dataBR(p.fim)}) · {p.diasEstimativa} dias de estimativa ({dataBR(p.projIni)} a {dataBR(p.projFim)}).
          Padrão do Omie: mês passado inteiro e de hoje até o fim do mês.
        </p>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <FiltrosGaveta basePath="/sugestao-compra" campos={campos} defaults={Object.fromEntries(campos.map((c) => [c.nome, sp[c.nome] ?? '']))} persistirEm="/sugestao-compra" />
      </div>
      <ChipsFiltrosAtivos basePath="/sugestao-compra" campos={campos} persistirEm="/sugestao-compra" />

      {erro && <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">{erro}</p>}
      {avisos.map((a) => (
        <p key={a} className="flex items-start gap-2 rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[13px] text-text-muted shadow-[var(--shadow-sm)]">
          <span className="mt-[5px] size-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <span>{a} A entrada prevista conta as notas do fornecedor ainda não recebidas e as OPs abertas.</span>
        </p>
      ))}

      {visaoMinimo ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card titulo="Com estoque mínimo" valor={resMin.comMinimo.toLocaleString('pt-BR')} sub="produtos ativos com mínimo definido" />
          <Card titulo="Abaixo do mínimo" valor={resMin.abaixo.toLocaleString('pt-BR')} sub="estoque atual menor que o mínimo" />
          <Card titulo="Para voltar ao mínimo" valor={<Money value={resMin.faltaValor} />} sub={resMin.semCusto ? `falta × custo médio · ${resMin.semCusto} sem custo` : 'falta × custo médio (ou último custo)'} />
          <Card titulo="Comprar imediatamente" valor={res.comprarJa.toLocaleString('pt-BR')} sub="pela fórmula da sugestão" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card titulo="Comprar imediatamente" valor={res.comprarJa.toLocaleString('pt-BR')} sub="o estoque já chegou no ponto de pedido" />
          <Card titulo="Comprar nos próximos dias" valor={res.comprarProximos.toLocaleString('pt-BR')} sub="chega no ponto dentro da estimativa" />
          <Card titulo="Produzir" valor={(res.produzirJa + res.produzirProximos).toLocaleString('pt-BR')} sub={`${res.produzirJa} imediatamente`} />
          <Card titulo="Compra estimada" valor={<Money value={res.valorEstimado} />} sub={res.semCusto ? `sugestão × custo médio · ${res.semCusto} sem custo` : 'sugestão × custo médio (ou último custo)'} />
        </div>
      )}

      {!erro && vis.length === 0 ? (
        <EmptyState icon={ShoppingCart} title={linhas.length ? (visaoMinimo ? (sp.ver === 'abaixo' ? 'Nada abaixo do mínimo' : 'Nenhum produto com estoque mínimo') : 'Nada a comprar neste filtro') : 'Sem dados para sugerir'}
          hint={linhas.length ? 'Mostre "Todos" no filtro para ver também o que não precisa comprar.' : 'Nenhum produto ativo teve saída, mínimo ou saldo no período.'} />
      ) : (
        <TabelaSugestao linhas={pagina} diasAnalise={p.diasAnalise} diasEstimativa={p.diasEstimativa} base={p.base}
          podeCriarPedido={podePedido} podeEditarLead={podePedido} modo={proprio ? 'proprio' : 'omie'} podeCriarRequisicao={podeRequisicao} />
      )}
      {vis.length > LIMITE_LINHAS && <p className="px-1 text-[12px] text-text-muted">Mostrando {LIMITE_LINHAS} de {vis.length.toLocaleString('pt-BR')}. O Excel traz todos.</p>}

      <details className="rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[12.5px] text-text-muted shadow-[var(--shadow-sm)]">
        <summary className="cursor-pointer font-semibold text-text">Como a conta é feita</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Consumo médio = saídas do período de análise (vendas, consumo de produção e ajustes de saída, todos os locais) ÷ dias. {proprio ? 'Saída estornada e transferência entre locais não contam.' : 'Fonte: o histórico de saídas do Omie.'}</li>
          <li>Ponto de pedido = estoque mínimo (soma dos locais) + consumo médio × lead time. Lead time {proprio ? 'editável por produto; sem ele, o prazo do fornecedor da última nota (Compradores e prazos)' : 'do cadastro do produto no Omie'}; sem lead time vale 1 dia (*).</li>
          <li>Projeção de saídas = consumo médio × dias de estimativa (como no Omie) ou, se escolhido, previsão de venda + consumo nas OPs abertas.</li>
          <li>Entrada prevista = notas do fornecedor ainda não recebidas + OPs abertas{proprio ? ' + saldo dos pedidos de compra aguardando ou aprovados que ainda não está em nota + requisições abertas ou aprovadas (como o Omie, que soma as requisições; contar também a aberta é escolha nossa)' : ''}.</li>
          <li>Sugestão = projeção + ponto de pedido − estoque atual − entrada prevista (nunca negativa). Imediatamente = já está no ponto de pedido; nos próximos dias = chega nele durante a estimativa.</li>
          <li>Produzir = produto acabado/em processo (tipo 04/03) ou com ficha técnica. Ativo imobilizado, serviço e &quot;outras&quot; ficam fora até serem escolhidos no filtro de tipo.</li>
        </ul>
      </details>
    </div>
  )
}
