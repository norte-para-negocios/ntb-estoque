import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Boxes, PackageX, Wallet } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { BarraSaldo, fmtBRL, Indicador, Saldo, SituacaoPill } from '@/components/estoque-proprio/Apresentacao'
import { Kardex } from '@/components/estoque-proprio/Kardex'
import { carregarEstoque, carregarMovimentos, situacaoDe } from '../../dados'

export default async function LocalEstoqueProprioPage({ params }: { params: Promise<{ codigo: string }> }) {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) notFound()
  const podeMovimentar = await requirePermissao(lojaId, 'Movimentacoes - Criar')

  const { codigo } = await params
  const cod = Number(codigo)
  if (!Number.isFinite(cod)) notFound()

  const visao = await carregarEstoque(lojaId)
  const local = visao.locais.find((l) => l.codigoLocal === cod)
  if (!local) notFound()
  const movimentos = await carregarMovimentos(lojaId, { codigoLocal: cod }, 50)

  const itens = visao.linhas.flatMap((l) => {
    const s = l.locais.find((x) => x.codigoLocal === cod)
    if (!s || s.saldo === 0 && s.minimo == null) return []
    return [{ ...l, saldoLocal: s.saldo, minimoLocal: s.minimo, valorLocal: s.saldo * l.cmc, situacaoLocal: situacaoDe(s.saldo, s.minimo) }]
  }).sort((a, b) => a.saldoLocal - b.saldoLocal || a.descricao.localeCompare(b.descricao, 'pt-BR'))

  const valor = itens.reduce((a, i) => a + i.valorLocal, 0)
  const negativos = itens.filter((i) => i.saldoLocal < 0).length

  return (
    <div className="space-y-5">
      <PageHeader voltarHref="/estoque" title={local.descricao} description="Itens, valor e movimentos deste local de estoque" />

      <div className="grid grid-cols-3 gap-3">
        <Indicador icon={Boxes} rotulo="Itens com saldo" valor={String(itens.filter((i) => i.saldoLocal !== 0).length)} />
        <Indicador icon={Wallet} rotulo="Valor no local" valor={fmtBRL(valor)} />
        <Indicador icon={PackageX} rotulo="Negativos" valor={String(negativos)} tom={negativos ? 'erro' : undefined} />
      </div>

      <section aria-label="Itens do local">
        <h2 className="mb-2 text-[15px] font-semibold text-text">Itens</h2>
        {itens.length === 0 ? (
          <div className="rounded-[var(--r-lg)] bg-surface u-card"><EmptyState icon={Boxes} title="Nada neste local ainda" hint="Registre uma entrada ou transfira de outro local." /></div>
        ) : (
          <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--r-lg)] bg-surface u-card">
            {itens.map((i) => (
              <li key={i.codigoProduto} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[1fr_160px_110px_150px]">
                <Link href={`/estoque/produto/${i.codigoProduto}`} className="min-w-0">
                  <span className="block truncate text-[14px] font-medium text-text hover:underline">{i.descricao}</span>
                  <span className="num text-[12px] text-text-muted">{i.codigo} · {i.familia}</span>
                </Link>
                <div className="text-right sm:text-left">
                  <Saldo valor={i.saldoLocal} unidade={i.unidade} />
                  <div className="mt-1 hidden sm:block"><BarraSaldo saldo={i.saldoLocal} minimo={i.minimoLocal} situacao={i.situacaoLocal} /></div>
                </div>
                <span className={`num hidden text-right text-[13px] sm:block ${i.valorLocal < 0 ? 'text-err' : ''}`}>{fmtBRL(i.valorLocal)}</span>
                <span className="hidden sm:block"><SituacaoPill situacao={i.situacaoLocal} /></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Movimentos recentes">
        <h2 className="mb-2 text-[15px] font-semibold text-text">Movimentos recentes</h2>
        <Kardex movimentos={movimentos} mostrarProduto podeEstornar={podeMovimentar} />
      </section>
    </div>
  )
}
