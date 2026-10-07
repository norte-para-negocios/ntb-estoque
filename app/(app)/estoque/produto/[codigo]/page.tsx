import { notFound } from 'next/navigation'
import { Coins, Layers, Scale, Wallet } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { BarraSaldo, fmtBRL, fmtQtd, Indicador, Saldo, SituacaoPill } from '@/components/estoque-proprio/Apresentacao'
import { AcoesProduto } from '@/components/estoque-proprio/Acoes'
import { Kardex } from '@/components/estoque-proprio/Kardex'
import { carregarEstoque, carregarMovimentos, situacaoDe, TIPOS_ITEM } from '../../dados'
import { formatCustoUnit } from '@/lib/num-br'

export default async function ProdutoEstoquePage({ params }: { params: Promise<{ codigo: string }> }) {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) notFound()
  const podeMovimentar = await requirePermissao(lojaId, 'Movimentacoes - Criar')

  const { codigo } = await params
  const cod = Number(codigo)
  if (!Number.isFinite(cod)) notFound()

  const visao = await carregarEstoque(lojaId)
  const p = visao.linhas.find((l) => l.codigoProduto === cod)
  if (!p) notFound()
  const movimentos = await carregarMovimentos(lojaId, { codigoProduto: cod }, 100)

  const locaisAtivos = visao.locais.filter((l) => !l.inativo)
  const saldos = p.locais.map((x) => ({ codigoLocal: x.codigoLocal, saldo: x.saldo, minimo: x.minimo }))
  // Mostra todo local ativo, mesmo sem movimento (saldo 0), para dar para receber/transferir nele.
  const porLocal = locaisAtivos.map((l) => {
    const s = p.locais.find((x) => x.codigoLocal === l.codigoLocal)
    const saldo = s?.saldo ?? 0
    const minimo = s?.minimo ?? null
    return { ...l, saldo, minimo, situacao: situacaoDe(saldo, minimo) }
  })

  return (
    <div className="space-y-5">
      <PageHeader
        voltarHref="/estoque"
        title={p.descricao}
        description={`Código ${p.codigo} · ${p.familia}${p.tipoItem ? ` · ${TIPOS_ITEM[p.tipoItem] ?? p.tipoItem}` : ''} · unidade ${p.unidade}`}
        actions={podeMovimentar ? (
          <AcoesProduto
            produto={{ codigoProduto: p.codigoProduto, codigo: p.codigo, descricao: p.descricao, unidade: p.unidade }}
            locais={locaisAtivos.map((l) => ({ codigoLocal: l.codigoLocal, descricao: l.descricao }))}
            saldos={saldos}
          />
        ) : undefined}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador icon={Layers} rotulo="Saldo total" valor={`${fmtQtd(p.saldo)} ${p.unidade}`} tom={p.situacao === 'negativo' ? 'erro' : p.situacao === 'baixo' ? 'aviso' : undefined} dica={p.situacao === 'negativo' ? 'Saldo negativo: lance a entrada' : undefined} />
        <Indicador icon={Coins} rotulo="Custo médio" valor={p.cmc ? formatCustoUnit(p.cmc) : '-'} dica={`por ${p.unidade}`} />
        <Indicador icon={Wallet} rotulo="Valor em estoque" valor={fmtBRL(p.valor)} dica="saldo × custo médio" />
        <Indicador icon={Scale} rotulo="Estoque mínimo" valor={p.minimo != null ? `${fmtQtd(p.minimo)} ${p.unidade}` : 'Não definido'} />
      </div>

      <section aria-label="Saldo por local">
        <h2 className="mb-2 text-[15px] font-semibold text-text">Saldo por local</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {porLocal.map((l) => (
            <div key={l.codigoLocal} className="rounded-[var(--r-lg)] bg-surface p-4 u-card">
              <div className="flex items-start justify-between gap-2">
                <a href={`/estoque/local/${l.codigoLocal}`} className="text-[14px] font-medium text-text hover:underline">{l.descricao}</a>
                <SituacaoPill situacao={l.situacao} />
              </div>
              <div className="mt-2 text-[22px] font-semibold tracking-[-0.02em]"><Saldo valor={l.saldo} unidade={p.unidade} /></div>
              <div className="mt-2"><BarraSaldo saldo={l.saldo} minimo={l.minimo} situacao={l.situacao} /></div>
              <div className="mt-1.5 text-[12px] text-text-muted">{l.minimo != null ? `Mínimo ${fmtQtd(l.minimo)} ${p.unidade}` : 'Sem mínimo definido'}</div>
            </div>
          ))}
          {porLocal.length === 0 && <p className="text-[13px] text-text-muted">Nenhum local de estoque ativo. Crie um local para começar.</p>}
        </div>
      </section>

      <section aria-label="Kardex">
        <h2 className="mb-2 text-[15px] font-semibold text-text">Movimentos (kardex)</h2>
        <Kardex movimentos={movimentos} unidade={p.unidade} podeEstornar={podeMovimentar} />
        <p className="mt-2 text-[12px] text-text-muted">* entrada sem custo informado: o custo médio não foi alterado.</p>
      </section>
    </div>
  )
}
