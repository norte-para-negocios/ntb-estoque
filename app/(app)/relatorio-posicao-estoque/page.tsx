import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, Warehouse } from 'lucide-react'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { FiltrosFaturamento } from '@/components/faturamento/FiltrosFaturamento'
import { CartaoResumo } from '@/components/faturamento/CartaoResumo'
import { formatCustoUnit } from '@/lib/num-br'
import { carregarPosicao, lerOpcoesPosicao, paramsBasePosicao, rotuloTipo, type SpPosicao } from '@/lib/relatorios/posicao-estoque-loader'

const LIMITE = 500
const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const fmtData = (d: string) => d.split('-').reverse().join('/')

export default async function PosicaoEstoquePage({ searchParams }: { searchParams: Promise<SpPosicao> }) {
  if (!(await getAtorGestao()).podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  const op = lerOpcoesPosicao(await searchParams)
  const r = await carregarPosicao(lojaId, op)
  const base = paramsBasePosicao(op)
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) q.set(k, v)
    return `/relatorio-posicao-estoque${q.size ? `?${q}` : ''}`
  }
  const exportQs = new URLSearchParams(Object.entries(base).filter(([, v]) => v)).toString()
  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chip = (ativo: boolean) => `${chipBase} ${ativo ? 'bg-brand-fill text-white' : 'bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text'}`
  const th = 'whitespace-nowrap px-3 py-2 text-[13px] font-semibold text-text-muted'
  const sped = op.ver === 'sped'
  const temReservado = r.linhas.some((l) => l.reservado !== 0)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Posição de estoque"
        icon={Warehouse}
        voltarHref="/relatorios"
        description="Quantidade, custo médio e valor de cada produto em cada local, com um total só (negativos entram, como no Omie)."
        actions={r.linhas.length > 0 ? <a href={`/relatorio-posicao-estoque/export?${exportQs}`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')}><Download className="size-4" /> Baixar</a> : undefined}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <Link href={href({ ver: '' })} className={chip(op.ver === 'produto')}>Por produto</Link>
        <Link href={href({ ver: 'local' })} className={chip(op.ver === 'local')}>Por produto e local</Link>
        <Link href={href({ ver: 'sped' })} className={chip(sped)}>Tipo SPED (Bloco H)</Link>
        {!sped && (
          <>
            <span className="ml-2 text-[12px] text-text-muted">Mostrar</span>
            <Link href={href({ zerados: op.zerados ? '' : '1' })} className={chip(op.zerados)}>Zerados</Link>
            <Link href={href({ inativos: op.inativos ? '0' : '' })} className={chip(op.inativos)}>Inativos</Link>
          </>
        )}
      </div>
      <FiltrosFaturamento tipos={r.opcoes.tipos} familias={r.opcoes.familias} />

      {r.erros.length > 0 && <p className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">Falha ao ler {r.erros.join(', ')}. O total pode estar incompleto; recarregue a página.</p>}
      {r.locaisSumidos.length > 0 && <p className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">O Omie não devolveu na última leitura o(s) local(is) {r.locaisSumidos.join(', ')}, que tinham saldo na foto anterior: o saldo deles não está nesta posição.</p>}
      {r.fotoEmLeitura && <p className="text-[13px] text-text-muted">A foto de hoje ainda está sendo lida do Omie: mostrando a de {fmtData(r.dataFoto!)}.</p>}
      {sped && <p className="text-[13px] text-text-muted">Inventário no formato do Bloco H (registro H010): só produtos ativos com saldo positivo, somados em todos os locais, valor unitário = valor ÷ quantidade. Posição da foto de {r.dataFoto ? fmtData(r.dataFoto) : '—'}.</p>}
      {r.total.suspeitos > 0 && <p className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">{r.total.suspeitos} linha(s) com custo médio fora do normal no Omie (zero, negativo ou acima de R$ 10 milhões): entram com valor zero e aparecem marcadas.</p>}

      {!r.dataFoto ? (
        <EmptyState icon={Warehouse} title="Sem foto do estoque" hint="Aguarde a sincronização da posição de estoque." />
      ) : r.linhas.length === 0 ? (
        <EmptyState icon={Warehouse} title="Nada para mostrar" hint="Limpe os filtros ou ligue “Zerados”." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <CartaoResumo titulo="Valor total" valor={<Money value={r.total.valor} />} sub={`Foto de ${fmtData(r.dataFoto)}`} />
            <CartaoResumo titulo="Saldos positivos" valor={<Money value={r.total.positivo} />} />
            <CartaoResumo titulo="Saldos negativos" valor={<Money value={r.total.negativo} />} />
            <CartaoResumo titulo={op.ver === 'local' ? 'Linhas (produto × local)' : 'Produtos'} valor={r.total.linhas.toLocaleString('pt-BR')} />
          </div>
          <form action="/relatorio-posicao-estoque" className="flex flex-wrap items-center gap-2">
            {Object.entries(base).filter(([k, v]) => v && k !== 'q').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input name="q" defaultValue={op.q} placeholder="Buscar produto…" className="h-9 w-60 rounded-[var(--r-md)] border border-border bg-surface px-3 text-sm text-text" />
            <button type="submit" className={chip(false)}>Buscar</button>
          </form>
          <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className={`text-left ${th}`}>Produto</th>
                  {op.ver === 'local' && <th className={`text-left ${th}`}>Local</th>}
                  {sped ? <th className={`text-left ${th}`}>NCM</th> : <th className={`hidden text-left md:table-cell ${th}`}>Família</th>}
                  <th className={`hidden text-left lg:table-cell ${th}`}>Tipo</th>
                  <th className={`text-right ${th}`}>Quantidade</th>
                  {temReservado && !sped && <th className={`text-right ${th}`}>Reservado</th>}
                  {temReservado && !sped && <th className={`text-right ${th}`}>Disponível</th>}
                  <th className={`text-right ${th}`}>{sped ? 'Valor unitário' : 'Custo médio'}</th>
                  <th className={`text-right ${th}`}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {r.linhas.slice(0, LIMITE).map((l) => (
                  <tr key={l.chave} className="border-t border-border/60">
                    <td className="px-3 py-2">
                      <Link href={`/estoque/produto/${l.codProduto}`} className="block max-w-[260px] hover:underline">
                        <div className="truncate text-text" title={l.descricao}>{l.descricao}{l.inativo && <span className="ml-1 text-[12px] text-text-muted">(inativo)</span>}</div>
                        <div className="num text-[12px] text-text-muted">{l.codigo}</div>
                      </Link>
                    </td>
                    {op.ver === 'local' && <td className="px-3 py-2 text-text-muted">{l.local}</td>}
                    {sped ? <td className="num px-3 py-2 text-text-muted">{l.ncm || '—'}</td> : <td className="hidden px-3 py-2 text-text-muted md:table-cell">{l.familia}</td>}
                    <td className="hidden px-3 py-2 text-[12px] text-text-muted lg:table-cell">{rotuloTipo(l.tipo)}</td>
                    <td className={`num whitespace-nowrap px-3 py-2 text-right ${l.quant < 0 ? 'text-err' : 'text-text'}`}>{fmtQtd(l.quant)} {l.unidade}</td>
                    {temReservado && !sped && <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{fmtQtd(l.reservado)}</td>}
                    {temReservado && !sped && <td className="num whitespace-nowrap px-3 py-2 text-right text-text">{fmtQtd(l.disponivel)}</td>}
                    <td className={`num whitespace-nowrap px-3 py-2 text-right ${l.custoSuspeito ? 'text-warn' : 'text-text'}`} title={l.custoSuspeito ? 'Custo fora do normal no Omie: vale zero' : undefined}>{l.custoSuspeito ? 'suspeito' : formatCustoUnit(l.cmc)}</td>
                    <td className={`num whitespace-nowrap px-3 py-2 text-right font-medium ${l.valor < 0 ? 'text-err' : 'text-text'}`}><Money value={l.valor} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-surface-2 font-semibold">
                  <td className="px-3 py-2 text-text" colSpan={(op.ver === 'local' ? 2 : 1) + 1}>Total ({r.total.linhas.toLocaleString('pt-BR')})</td>
                  <td className="hidden lg:table-cell" />
                  <td />
                  {temReservado && !sped && <td />}
                  {temReservado && !sped && <td />}
                  <td />
                  <td className="num whitespace-nowrap px-3 py-2 text-right text-text"><Money value={r.total.valor} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
          {r.linhas.length > LIMITE && <p className="text-[13px] text-text-muted">Mostrando as {LIMITE} linhas de maior valor de {r.linhas.length.toLocaleString('pt-BR')}; o total soma todas. O arquivo do botão Baixar traz todas.</p>}
        </>
      )}
    </div>
  )
}
