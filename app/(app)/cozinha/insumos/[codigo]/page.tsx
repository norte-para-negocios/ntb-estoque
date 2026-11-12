import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Carrot, ExternalLink } from 'lucide-react'
import { getCurrentLojaId } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { btnClass } from '@/components/ui-kit/Button'
import { CartaoResumo } from '@/components/faturamento/CartaoResumo'
import { GraficoCusto } from '@/components/estoque-proprio/CustoProduto'
import { Secao, Vazio, dataLonga } from '@/components/custo-cardapio/inicio/Secao'
import { SimularPreco, type UsoSimulavel } from '@/components/custo-cardapio/insumos/SimularPreco'
import { dadosInsumos, historicoCusto, rotuloFonte, ultimasNotas, variacaoDeCompras, variacoes } from '@/lib/custo-cardapio/insumos'
import { precoReal } from '@/lib/custo-cardapio/preco-puro'
import { brl, pct, qtd } from '@/lib/custo-cardapio/formato'
import { formatCustoUnit } from '@/lib/num-br'

// Norte Cozinha, um insumo: custo no tempo, últimas compras, onde é usado (e quanto pesa em cada prato) e o "e se".
// Consultas: carregarBase (cache), variacaoDeCompras (notas de compra de 120 dias, cache), histórico do custo (1 consulta; Omie sem
// fotos suficientes: + kardex) e últimas notas (1 consulta).

export default async function InsumoPage({ params }: { params: Promise<{ codigo: string }> }) {
  const codigo = Number((await params).codigo)
  if (!Number.isFinite(codigo)) notFound()
  const lojaId = await getCurrentLojaId()
  const d = await dadosInsumos(lojaId)
  if (!d) notFound()
  const { base } = d
  const ins = d.insumos.find((i) => i.codigo === codigo)
  if (!ins) {
    if (base.fichas.has(codigo)) redirect(`/cozinha/pratos/${codigo}`)
    const p = base.produtos.get(codigo)
    return (
      <div className="space-y-4">
        <PageHeader title={p?.descricao ?? `Produto ${codigo}`} icon={Carrot} voltarHref="/cozinha/insumos" />
        <EmptyState icon={Carrot} title="Este produto não entra em nenhuma ficha" hint="Insumo é o que aparece na ficha técnica de algum prato ou preparação ativo.">
          <Link href={`/estoque/produto/${codigo}`} className={btnClass('outline')}>Abrir no estoque</Link>
        </EmptyState>
      </div>
    )
  }

  const [vc, historico, notas] = await Promise.all([
    variacaoDeCompras(lojaId, base.modo), historicoCusto(lojaId, base.modo, codigo), ultimasNotas(lojaId, codigo),
  ])
  const v = variacoes(d, vc).get(codigo) ?? null
  const compra = vc.porProduto.get(codigo)
  // Sem fotos de custo médio no tempo: o gráfico usa o custo das compras (nota a nota).
  const pelasCompras = historico.length < 2
  const serie = pelasCompras
    ? [...notas.reduce((m, n) => (n.emissao && n.custoEstoque != null ? m.set(n.emissao, n.custoEstoque) : m), new Map<string, number>())] // um ponto por dia
      .map(([data, cmc]) => ({ data, cmc })).sort((x, y) => x.data.localeCompare(y.data))
    : historico

  const usos: UsoSimulavel[] = (d.usos.get(codigo) ?? []).map((u) => {
    const p = base.produtos.get(u.raiz)
    const prato = d.ehPrato(u.raiz)
    return { ...u, descricao: p?.descricao ?? `Produto ${u.raiz}`, prato, preco: prato && precoReal(p?.preco) ? p!.preco : null }
  }).sort((a, b) => Number(b.prato) - Number(a.prato) || (b.custoRaiz > 0 ? b.custo / b.custoRaiz : 0) - (a.custoRaiz > 0 ? a.custo / a.custoRaiz : 0))
  const ultima = notas[0]

  return (
    <div className="space-y-6">
      <PageHeader title={ins.descricao} icon={Carrot} voltarHref="/cozinha/insumos"
        description={`${ins.codigoTexto}${ins.familia ? ` · ${ins.familia}` : ''}${ins.unidade ? ` · custo por ${ins.unidade.toLowerCase()}` : ''}${ins.inativo ? ' · inativo no cadastro' : ''}`}
        actions={<Link href={`/estoque/produto/${codigo}`} className={btnClass('outline')}><ExternalLink className="size-4" /> Abrir no estoque</Link>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CartaoResumo titulo="Custo médio"
          valor={<span className={ins.custo == null || ins.suspeito ? 'text-warn' : ''}>{ins.custo == null ? 'sem custo' : formatCustoUnit(ins.custo, ins.unidade)}</span>}
          sub={ins.suspeito ? 'fora do normal para a unidade: confira a última entrada' : base.modo === 'omie' ? `Omie${base.dataCusto ? ` em ${dataLonga(base.dataCusto)}` : ''}` : 'custo médio do estoque'} />
        <CartaoResumo titulo="No mês"
          valor={<span className={v == null ? 'text-text-muted' : v >= 0.03 ? 'text-err' : v <= -0.03 ? 'text-ok' : ''}>{v == null ? '—' : `${v > 0 ? '+' : ''}${pct(v)}`}</span>}
          sub={compra ? `compra de ${formatCustoUnit(compra.antes, ins.unidade)} para ${formatCustoUnit(compra.agora, ins.unidade)}, ${rotuloFonte(vc)}` : 'sem compras nos últimos 30 dias e nos 90 antes'} />
        <CartaoResumo titulo="Última compra"
          valor={ultima ? (ultima.custoEstoque != null ? formatCustoUnit(ultima.custoEstoque, ins.unidade) : ultima.precoNota != null ? `${formatCustoUnit(ultima.precoNota)}/${(ultima.unidadeNota ?? 'un').toLowerCase()}` : '—') : '—'}
          sub={ultima ? `${ultima.fornecedor ?? 'fornecedor não informado'} · ${dataLonga(ultima.emissao)}` : 'nenhuma nota de entrada encontrada'} />
        <CartaoResumo titulo="Usado em" valor={`${ins.pratos} ${ins.pratos === 1 ? 'prato' : 'pratos'}`}
          sub={ins.preparacoes ? `e ${ins.preparacoes} ${ins.preparacoes === 1 ? 'preparação' : 'preparações'}` : 'direto ou por uma preparação'} />
      </div>

      <SimularPreco usos={usos} custoAtual={ins.custo} unidade={ins.unidade} meta={base.taxas.metaCmv} />

      <Secao titulo="Onde é usado" sub="Quantidade em 1 unidade do prato (já descendo pelas preparações) e quanto do custo do prato é este insumo.">
        {usos.length === 0 ? <Vazio>Nenhum prato ativo usa este insumo.</Vazio> : (
          <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
            <table className="w-full min-w-[640px] text-left text-[13.5px]">
              <thead>
                <tr className="text-[12px] text-text-muted">
                  <th className="px-4 py-2.5 font-medium">Prato ou preparação</th>
                  <th className="px-2 py-2.5 text-right font-medium">Quantidade</th>
                  <th className="px-2 py-2.5 text-right font-medium">Custo no prato</th>
                  <th className="w-[26%] px-2 py-2.5 font-medium">Parte do custo</th>
                  <th className="px-4 py-2.5 text-right font-medium">CMV</th>
                </tr>
              </thead>
              <tbody>
                {usos.map((u) => {
                  const parte = u.custoRaiz > 0 ? u.custo / u.custoRaiz : 0
                  return (
                    <tr key={u.raiz} className="border-t border-border/60">
                      <td className="px-4 py-2.5">
                        <Link href={`/cozinha/pratos/${u.raiz}`} className="font-medium text-text hover:text-brand">{u.descricao}</Link>
                        <span className="block text-[12px] text-text-muted">{u.prato ? 'prato' : 'preparação'}{u.direto ? '' : ' · dentro de uma preparação'}</span>
                      </td>
                      <td className="num whitespace-nowrap px-2 py-2.5 text-right text-text-muted">{qtd(u.quantidade, ins.unidade)}</td>
                      <td className="num whitespace-nowrap px-2 py-2.5 text-right">{ins.custo == null ? 'sem custo' : brl(u.custo)}</td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="num w-[52px] shrink-0 text-right text-text">{pct(parte, 0)}</span>
                          <div className="h-1.5 w-full rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand-fill" style={{ width: `${Math.min(parte, 1) * 100}%` }} /></div>
                        </div>
                      </td>
                      <td className="num whitespace-nowrap px-4 py-2.5 text-right text-text-muted">{u.preco ? pct(u.custoRaiz / u.preco) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Secao>

      <Secao titulo={pelasCompras ? 'Custo das compras no tempo' : 'Custo médio no tempo'} sub={pelasCompras ? 'Custo por unidade do estoque em cada nota de entrada recente.' : 'Últimos seis meses.'}>
        <div className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
          <GraficoCusto series={new Map([[0, serie]])} nomeLocal={new Map([[0, pelasCompras ? 'Custo na nota' : 'Custo médio']])} />
        </div>
      </Secao>

      <Secao titulo="Últimas compras" sub="Notas fiscais de entrada com este produto." acao={{ href: `/nota-fiscal?produto=${encodeURIComponent(ins.codigoTexto)}&data_inicio=2025-01-01`, rotulo: 'Ver todas' }}>
        {notas.length === 0 ? <Vazio>Nenhuma nota de entrada com este produto.</Vazio> : (
          <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
            <table className="w-full min-w-[640px] text-left text-[13.5px]">
              <thead>
                <tr className="text-[12px] text-text-muted">
                  <th className="px-4 py-2.5 font-medium">Emissão</th>
                  <th className="px-2 py-2.5 font-medium">Fornecedor</th>
                  <th className="px-2 py-2.5 text-right font-medium">Quantidade</th>
                  <th className="px-2 py-2.5 text-right font-medium">Preço na nota</th>
                  <th className="px-4 py-2.5 text-right font-medium">Por {(ins.unidade ?? 'unidade').toLowerCase()}</th>
                </tr>
              </thead>
              <tbody>
                {notas.map((n, k) => (
                  <tr key={`${n.notaId}-${k}`} className="border-t border-border/60">
                    <td className="num whitespace-nowrap px-4 py-2.5"><Link href={`/nota-fiscal/${n.notaId}`} className="text-text hover:text-brand">{dataLonga(n.emissao)}</Link><span className="block text-[12px] text-text-muted">NF {n.numero ?? n.notaId}</span></td>
                    <td className="max-w-[260px] truncate px-2 py-2.5 text-text-muted">{n.fornecedor ?? '—'}</td>
                    <td className="num whitespace-nowrap px-2 py-2.5 text-right">{n.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} <span className="text-[12px] text-text-muted">{(n.unidadeNota ?? '').toLowerCase()}</span></td>
                    <td className="num whitespace-nowrap px-2 py-2.5 text-right">{n.precoNota != null ? formatCustoUnit(n.precoNota) : '—'}</td>
                    <td className="num whitespace-nowrap px-4 py-2.5 text-right">{n.custoEstoque != null ? formatCustoUnit(n.custoEstoque) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>
    </div>
  )
}
