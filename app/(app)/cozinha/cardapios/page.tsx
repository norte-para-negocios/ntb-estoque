import Link from 'next/link'
import { BookOpen, ChefHat } from 'lucide-react'
import { getCurrentLojaId } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { DataTable } from '@/components/ui-kit/DataTable'
import { CartaoResumo } from '@/components/faturamento/CartaoResumo'
import { FormCardapio } from '@/components/custo-cardapio/cardapios/FormCardapio'
import { carregarBase } from '@/lib/custo-cardapio/carregar'
import { listarCardapios, type CardapioComConta } from '@/lib/custo-cardapio/cardapios'
import { NOME_CANAL } from '@/lib/custo-cardapio/cardapios-puro'
import { brl, pct } from '@/lib/custo-cardapio/formato'

// Norte Cozinha (módulo da loja), Cardápios: seleções de pratos por canal, com o CMV de cada uma.
export default async function CardapiosPage({ searchParams }: { searchParams: Promise<{ arquivados?: string }> }) {
  const sp = await searchParams
  const lojaId = await getCurrentLojaId()
  const base = await carregarBase(lojaId)
  if (!base) {
    return (
      <div className="space-y-4">
        <PageHeader title="Cardápios" icon={BookOpen} />
        <EmptyState icon={ChefHat} title="Esta loja não controla estoque" hint="O custo do prato sai das fichas técnicas e do custo dos insumos, que esta loja não tem." />
      </div>
    )
  }
  const { cardapios, erro } = await listarCardapios(base)
  const meta = base.taxas.metaCmv
  const ativos = cardapios.filter((c) => c.ativo)
  const arquivados = cardapios.filter((c) => !c.ativo)
  const verArquivados = sp.arquivados === '1'
  const lista = verArquivados ? arquivados : ativos
  const acimaTotal = ativos.reduce((a, c) => a + c.resumo.acima, 0)
  const piorCardapio = [...ativos].filter((c) => c.resumo.cmvCardapio != null).sort((a, b) => (b.resumo.cmvCardapio as number) - (a.resumo.cmvCardapio as number))[0]

  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chip = (ativo: boolean) => `${chipBase} ${ativo ? 'bg-brand-fill text-white' : 'bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text'}`
  const nomeDe = (c: CardapioComConta, idx: number | null) => (idx == null ? null : c.itens[idx])

  return (
    <div className="space-y-4">
      <PageHeader title="Cardápios" icon={BookOpen}
        description={`Monte o cardápio de cada canal e veja o CMV dele contra a meta de ${pct(meta, 0)}.`}
        actions={<FormCardapio />} />

      {erro && <p className="rounded-[var(--r-md)] bg-warn/10 px-3 py-2 text-[13px] text-warn">Parte dos pratos não carregou: {erro}</p>}

      {ativos.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <CartaoResumo titulo="Cardápios ativos" valor={ativos.length} sub={`${ativos.reduce((a, c) => a + c.itens.length, 0)} pratos no total`} />
          <CartaoResumo titulo="Pratos acima da meta" valor={<span className={acimaTotal ? 'text-err' : ''}>{acimaTotal}</span>} sub="somando todos os cardápios ativos" />
          <CartaoResumo titulo="Cardápio com CMV mais alto" valor={piorCardapio ? pct(piorCardapio.resumo.cmvCardapio) : '—'} sub={piorCardapio?.nome ?? 'nenhum com preço e custo'} />
        </div>
      )}

      {(arquivados.length > 0 || verArquivados) && (
        <div className="flex gap-2">
          <Link href="/cozinha/cardapios" className={chip(!verArquivados)}>Ativos <span className="num ml-1.5 opacity-70">{ativos.length}</span></Link>
          <Link href="/cozinha/cardapios?arquivados=1" className={chip(verArquivados)}>Arquivados <span className="num ml-1.5 opacity-70">{arquivados.length}</span></Link>
        </div>
      )}

      {lista.length === 0 ? (
        <EmptyState icon={BookOpen} title={verArquivados ? 'Nenhum cardápio arquivado' : 'Nenhum cardápio ainda'}
          hint={verArquivados ? undefined : 'Crie um cardápio para o salão, o delivery ou um evento e escolha os pratos dele.'}>
          {!verArquivados && <FormCardapio />}
        </EmptyState>
      ) : (
        <DataTable minLargura="max-2xl:min-w-[1040px]">
          <thead>
            <tr>
              <th className="w-[24%]">Cardápio</th>
              <th className="w-[7%] text-right">Pratos</th>
              <th className="w-[10%] text-right">CMV</th>
              <th className="w-[13%] text-right">Margem</th>
              <th className="w-[10%] text-right">Acima da meta</th>
              <th className="w-[18%]">Melhor prato</th>
              <th className="w-[18%]">Pior prato</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((c) => {
              const melhor = nomeDe(c, c.resumo.melhor)
              const pior = nomeDe(c, c.resumo.pior)
              return (
                <tr key={c.id}>
                  <td>
                    <Link href={`/cozinha/cardapios/${c.id}`} className="block min-w-0 hover:text-brand">
                      <span className="block truncate font-medium text-text">{c.nome}</span>
                      <span className="block truncate text-[12px] text-text-muted">{NOME_CANAL[c.canal]}{c.resumo.semPreco ? ` · ${c.resumo.semPreco} sem preço` : ''}</span>
                    </Link>
                  </td>
                  <td className="num text-right">{c.itens.length}</td>
                  <td className={`num text-right font-semibold ${c.resumo.cmvCardapio == null ? 'text-text-muted' : c.resumo.cmvCardapio > meta ? 'text-err' : 'text-ok'}`}>{pct(c.resumo.cmvCardapio)}</td>
                  <td className="num text-right">
                    {c.resumo.margem == null ? <span className="text-text-muted">—</span> : <>
                      <span className={c.resumo.margem < 0 ? 'text-err' : ''}>{brl(c.resumo.margem)}</span>
                      <span className="block text-[12px] text-text-muted">ROI {c.resumo.roi == null ? '—' : `${c.resumo.roi.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}×`}</span>
                    </>}
                  </td>
                  <td className={`num text-right ${c.resumo.acima ? 'font-semibold text-err' : 'text-text-muted'}`}>{c.resumo.acima}{c.resumo.atencao ? <span className="font-normal text-warn"> +{c.resumo.atencao}</span> : null}</td>
                  <td className="truncate text-[13px]">{melhor ? <>{melhor.descricao} <span className="num text-ok">{pct(melhor.conta.cmv)}</span></> : <span className="text-text-muted">—</span>}</td>
                  <td className="truncate text-[13px]">{pior ? <>{pior.descricao} <span className={`num ${pior.conta.cmv != null && pior.conta.cmv > meta ? 'text-err' : ''}`}>{pct(pior.conta.cmv)}</span></> : <span className="text-text-muted">—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </DataTable>
      )}
      <p className="text-[12px] text-text-muted">CMV do cardápio = custo ÷ preço do conjunto, cada prato pelas suas porções. Margem = venda − custo do conjunto; ROI = margem ÷ custo. No delivery entram a embalagem e as taxas do app, do cartão e o imposto. Os números com + são os pratos perto do limite.</p>
    </div>
  )
}
