import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, Truck } from 'lucide-react'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { FiltrosFaturamento } from '@/components/faturamento/FiltrosFaturamento'
import { CartaoResumo } from '@/components/faturamento/CartaoResumo'
import { carregarProdutosFornecedor, lerOpcoesPF, paramsBasePF, type SpPF } from '@/lib/relatorios/produtos-fornecedor-loader'
import { avisoItensNota } from '@/lib/relatorios/produtos-fornecedor-puro'

const LIMITE = 500
const fmtQtd = (n: number | null) => (n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 3 }))
const fmtData = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')
const fmtPct = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

export default async function ProdutosFornecedorPage({ searchParams }: { searchParams: Promise<SpPF> }) {
  if (!(await getAtorGestao()).podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  const modo = await modoDaLoja(lojaId)
  if (modo === 'nenhum') notFound()
  const op = lerOpcoesPF(await searchParams)
  const { linhas, resumo, erros, opcoes, vazio } = await carregarProdutosFornecedor(lojaId, op)

  const base = paramsBasePF(op)
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) q.set(k, v)
    return `/relatorio-produtos-fornecedor${q.size ? `?${q}` : ''}`
  }
  const exportQs = new URLSearchParams(Object.entries(base).filter(([, v]) => v)).toString()
  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chip = (ativo: boolean) => `${chipBase} ${ativo ? 'bg-brand-fill text-white' : 'bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text'}`
  const th = 'whitespace-nowrap px-3 py-2 text-[13px] font-semibold text-text-muted'
  const proprio = modo === 'proprio'

  return (
    <div className="space-y-4">
      <PageHeader
        title="Produtos por fornecedor"
        icon={Truck}
        voltarHref="/relatorios"
        description={`De quem você compra cada produto e quanto pagou da última vez, na unidade de estoque. ${proprio ? 'Fonte: compras lançadas no estoque.' : 'Fonte: notas concluídas (mesma regra do Omie).'}`}
        actions={linhas.length > 0 ? <a href={`/relatorio-produtos-fornecedor/export?${exportQs}`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')}><Download className="size-4" /> Baixar</a> : undefined}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] text-text-muted">Ordem</span>
        <Link href={href({ ver: '' })} className={chip(op.ver === 'produto')}>Por produto</Link>
        <Link href={href({ ver: 'fornecedor' })} className={chip(op.ver === 'fornecedor')}>Por fornecedor</Link>
        <Link href={href({ inativos: op.inativos ? '0' : '' })} className={chip(!op.inativos)}>Sem inativos</Link>
      </div>
      <FiltrosFaturamento tipos={opcoes.tipos} familias={opcoes.familias} fornecedores={opcoes.fornecedores} semSituacao />

      {erros.length > 0 && (
        <p className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">Falha ao ler: {erros.join(', ')}. Os números podem estar incompletos; recarregue a página.</p>
      )}

      {vazio ? (
        <EmptyState icon={Truck} title="Nenhuma compra encontrada" hint={proprio ? 'Só entram compras já lançadas no estoque, com o item ligado a um produto.' : 'Só entram notas concluídas com o item ligado a um produto do cadastro.'} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <CartaoResumo titulo="Produtos" valor={resumo.produtos.toLocaleString('pt-BR')} sub="com pelo menos uma compra" />
            <CartaoResumo titulo="Fornecedores" valor={resumo.fornecedores.toLocaleString('pt-BR')} />
            <CartaoResumo titulo="Produto × fornecedor" valor={resumo.pares.toLocaleString('pt-BR')} />
            <CartaoResumo titulo="Com mais de um fornecedor" valor={resumo.multiFornecedor.toLocaleString('pt-BR')} sub="dá para comparar o preço" />
          </div>

          <form action="/relatorio-produtos-fornecedor" className="flex flex-wrap items-center gap-2">
            {Object.entries(base).filter(([k, v]) => v && k !== 'q').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input name="q" defaultValue={op.q} placeholder="Buscar produto ou código do fornecedor…" className="h-9 w-72 max-w-full rounded-[var(--r-md)] border border-border bg-surface px-3 text-sm text-text" />
            <button type="submit" className={chip(false)}>Buscar</button>
          </form>

          {linhas.length === 0 ? (
            <EmptyState icon={Truck} title="Nada encontrado" hint="Nenhum produto bate com a busca ou os filtros." />
          ) : (
            <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className={`text-left ${th}`}>Produto</th>
                    <th className={`text-left ${th}`}>Fornecedor</th>
                    <th className={`text-left ${th}`}>Última compra</th>
                    <th className={`text-right ${th}`}>Quantidade</th>
                    <th className={`text-right ${th}`}>Preço un.</th>
                    <th className={`text-right ${th}`} title="Valor que entrou no estoque ÷ quantidade (sem os impostos que viram crédito)">Custo un.</th>
                    <th className={`text-right ${th}`} title="Custo médio do estoque hoje">Custo médio hoje</th>
                    <th className={`text-right ${th}`}>Compras</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.slice(0, LIMITE).map((l) => (
                    <tr key={`${l.n_cod_prod}:${l.fornecedor_chave}`} className="border-t border-border/60 align-top">
                      <td className="px-3 py-2">
                        <Link href={`/estoque/produto/${l.n_cod_prod}`} className="block max-w-[260px] truncate text-text hover:underline" title={l.descricao}>{l.descricao}</Link>
                        <div className="num text-[12px] text-text-muted">{l.codigo}{l.inativo ? ' · inativo' : ''}{l.nFornecedores > 1 ? ` · ${l.nFornecedores} fornecedores` : ''}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="max-w-[220px] truncate text-text" title={l.fornecedor}>{l.fornecedor}</div>
                        {l.codigo_fornecedor && <div className="num text-[12px] text-text-muted">cód. {l.codigo_fornecedor}</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="num text-text">{fmtData(l.ultima_data)}</div>
                        <div className="num text-[12px] text-text-muted">
                          {!proprio && l.ultima_nota_id ? <Link href={`/nota-fiscal/${l.ultima_nota_id}`} className="hover:underline">NF {l.ultima_nota}</Link> : l.ultima_nota ? `Nº ${l.ultima_nota}` : ''}
                        </div>
                        {avisoItensNota(l.itens_ultima_nota) && <div className="text-[12px] text-warn" title="O Omie mostra uma linha por código do fornecedor; aqui fica o último item, com o custo do primeiro">{avisoItensNota(l.itens_ultima_nota)}</div>}
                      </td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-text">{fmtQtd(l.qtde)} <span className="text-text-muted">{l.unidade ?? ''}</span></td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-text">{l.preco_unit == null ? '—' : <Money value={l.preco_unit} />}</td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right">
                        <span className="font-medium text-text">{l.custo_unit == null ? '—' : <Money value={l.custo_unit} />}</span>
                        {l.maisBarato && <div className="text-[12px] font-semibold text-brand">mais barato</div>}
                      </td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">
                        {l.custoMedio == null ? '—' : <Money value={l.custoMedio} />}
                        {l.variacaoPct != null && Math.abs(l.variacaoPct) >= 0.1 && <div className={`text-[12px] ${l.variacaoPct > 0 ? 'text-err' : 'text-text-muted'}`}>{fmtPct(l.variacaoPct)} na última</div>}
                      </td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">
                        {l.compras}
                        <div className="text-[12px]"><Money value={Number(l.total_comprado) || 0} /></div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {linhas.length > LIMITE && <p className="text-[13px] text-text-muted">Mostrando {LIMITE} de {linhas.length.toLocaleString('pt-BR')}. O arquivo do botão Baixar traz todos.</p>}
          <p className="px-1 text-[12px] text-text-muted">
            Última compra = a nota {proprio ? 'lançada' : 'concluída'} mais recente daquele fornecedor (pela data do recebimento). &quot;Compras&quot; = quantas notas e quanto somaram em todo o histórico.
            {!proprio && ' O Omie guarda fornecedores de antes de 07/2025; aqui entra o histórico de notas que o Norte tem.'}
          </p>
        </>
      )}
    </div>
  )
}
