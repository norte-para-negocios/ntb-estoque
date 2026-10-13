import Link from 'next/link'
import { ArrowLeftRight } from 'lucide-react'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { formatCustoUnit } from '@/lib/num-br'
import { hrefDocumento } from '@/lib/movimentacoes/movimentacoes-puro'
import type { LinhaMov } from '@/lib/movimentacoes/dados'

const fmtQtd = (n: number | null) => (n == null ? '-' : n.toLocaleString('pt-BR', { maximumFractionDigits: 3 }))
const fmtData = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '-')

/**
 * Tabela de movimentos (aba Movimentos, página da OP, página da nota). Cada linha leva ao produto e ao documento de
 * origem. `filtrarProduto` = href base (com os filtros atuais) para o link "só este produto".
 */
export function TabelaMovimentos({
  linhas, comSaldo, filtrarProduto, vazio,
}: {
  linhas: LinhaMov[]
  comSaldo: boolean
  filtrarProduto?: (cod: number) => string
  vazio?: { title: string; hint: string }
}) {
  if (!linhas.length) {
    return (
      <div className="rounded-[var(--r-lg)] bg-surface u-card">
        <EmptyState icon={ArrowLeftRight} title={vazio?.title ?? 'Nenhum movimento neste filtro'} hint={vazio?.hint ?? 'Mude o período ou os filtros.'} />
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface u-card">
      <table className={`w-full ${comSaldo ? 'min-w-[1040px]' : 'min-w-[860px]'} text-left text-[13px]`}>
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-text-muted">
            <th className="px-4 py-2.5 font-medium">Data</th>
            <th className="px-2 py-2.5 font-medium">Produto</th>
            <th className="px-2 py-2.5 font-medium">Local</th>
            <th className="px-2 py-2.5 font-medium">Origem</th>
            <th className="px-2 py-2.5 font-medium">Documento</th>
            <th className="px-2 py-2.5 text-right font-medium">Quantidade</th>
            {comSaldo && <th className="px-2 py-2.5 text-right font-medium">Custo médio após</th>}
            {comSaldo && <th className="px-2 py-2.5 text-right font-medium">Saldo após</th>}
            <th className="px-4 py-2.5 font-medium">Quem lançou</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((m) => {
            const href = m.doc ? hrefDocumento(m.doc) : null
            return (
              <tr key={m.chave} className={`border-t border-[var(--border)] ${m.cancelado ? 'line-through opacity-60' : ''}`}>
                <td className="whitespace-nowrap px-4 py-2 text-text-muted num">{fmtData(m.data)}</td>
                <td className="max-w-[280px] px-2 py-2">
                  <Link href={`/estoque/produto/${m.n_cod_prod}`} className="block truncate font-medium text-text hover:underline" title="Abrir o produto">{m.produto}</Link>
                  <span className="num text-[12px] text-text-muted">{m.codigo}</span>
                  {filtrarProduto && (
                    <Link href={filtrarProduto(m.n_cod_prod)} className="ml-2 text-[12px] text-brand hover:underline" title="Ver só os movimentos deste produto">só este</Link>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-text-muted">{m.local}{m.localDestino ? ` → ${m.localDestino}` : ''}</td>
                <td className="px-2 py-2 text-text-muted">{m.origemRotulo}</td>
                <td className="whitespace-nowrap px-2 py-2">
                  {m.doc ? (
                    href ? <Link href={href} className="text-brand hover:underline">{m.doc.rotulo}</Link> : <span className="text-text-muted" title="Documento não encontrado no Norte Estoque">{m.doc.rotulo}</span>
                  ) : <span className="text-text-muted">{m.obs ?? '-'}</span>}
                  {m.provavel && <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-muted">provável</span>}
                </td>
                <td className={`whitespace-nowrap px-2 py-2 text-right num font-medium ${m.contagem ? 'text-text' : m.quantidade > 0 ? 'text-ok' : 'text-err'}`}>
                  {m.contagem ? <>Contagem: {fmtQtd(m.quantidade)}</> : <>{m.quantidade > 0 ? '+' : ''}{fmtQtd(m.quantidade)}</>}{' '}
                  <span className="text-[12px] font-normal text-text-muted">{m.unidade}</span>
                </td>
                {comSaldo && <td className="whitespace-nowrap px-2 py-2 text-right num">{m.cmcApos != null ? formatCustoUnit(m.cmcApos) : '-'}</td>}
                {comSaldo && <td className={`whitespace-nowrap px-2 py-2 text-right num ${(m.saldoApos ?? 0) < 0 ? 'font-semibold text-err' : ''}`}>{fmtQtd(m.saldoApos)}</td>}
                <td className="whitespace-nowrap px-4 py-2 text-text-muted">{m.autor ?? '-'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
