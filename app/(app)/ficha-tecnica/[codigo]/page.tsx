import { notFound } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EditorFicha } from '@/components/ficha-tecnica/EditorFicha'
import { carregarBase, carregarVersoes } from '../dados'

export default async function FichaPage({ params }: { params: Promise<{ codigo: string }> }) {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Produtos'))) notFound()
  const podeEditar = await requirePermissao(lojaId, 'Produtos - Editar')

  const codigoProduto = Number((await params).codigo)
  if (!Number.isFinite(codigoProduto)) notFound()
  const { produtos, cmc, fichas } = await carregarBase(lojaId)
  const produto = produtos.find((p) => p.codigoProduto === codigoProduto)
  if (!produto) notFound()

  const atual = fichas.get(codigoProduto)
  const versoes = await carregarVersoes(lojaId, codigoProduto)
  const outras = [...fichas.values()].filter((f) => f.codigoProduto !== codigoProduto)

  return (
    <div className="space-y-4">
      <PageHeader
        voltarHref="/ficha-tecnica"
        title={produto.descricao}
        description={`Ficha técnica · ${produto.codigo} · quantidades em ${produto.unidade === 'UN' ? 'unidade' : produto.unidade} e nas unidades base dos insumos`}
      />
      <EditorFicha
        produto={produto}
        rendimentoInicial={atual?.rendimento ?? 1}
        itensIniciais={atual?.itens ?? []}
        expandirInicial={atual?.expandirNaVenda ?? false}
        ativaAtual={!!atual}
        versaoAtual={atual?.versao ?? (versoes[0]?.versao ?? null)}
        insumos={produtos.filter((p) => p.codigoProduto !== codigoProduto).map((p) => ({ ...p, cmc: cmc.get(p.codigoProduto) ?? 0 }))}
        outrasFichas={outras.map(({ codigoProduto: c, rendimento, expandirNaVenda, itens }) => ({ codigoProduto: c, rendimento, expandirNaVenda, itens }))}
        versoes={versoes}
        podeEditar={podeEditar}
      />
    </div>
  )
}
