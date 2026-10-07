import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BookOpenCheck, ChefHat, NotebookPen } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Lista, type Coluna } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Indicador, fmtBRL, fmtQtd } from '@/components/estoque-proprio/Apresentacao'
import { NovaFicha } from '@/components/ficha-tecnica/NovaFicha'
import { TIPOS_ITEM } from '@/app/(app)/estoque/tipos'
import { carregarListaFichas, type LinhaFicha } from './dados'

export default async function FichasPage() {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Produtos'))) notFound()
  const podeEditar = await requirePermissao(lojaId, 'Produtos - Editar')
  const { linhas, semFicha, vendaveisSemFicha } = await carregarListaFichas(lojaId)

  const colunas: Coluna<LinhaFicha>[] = [
    {
      label: 'Produto', primaria: true, flexivel: true,
      render: (l) => (
        <Link href={`/ficha-tecnica/${l.produto.codigoProduto}`} className="block min-w-0">
          <span className="block truncate font-medium text-text hover:underline">{l.produto.descricao}</span>
          <span className="num text-[12px] text-text-muted">{l.produto.codigo} · {TIPOS_ITEM[l.produto.tipoItem ?? ''] ?? 'Item'}</span>
        </Link>
      ),
    },
    { label: 'Rende', alinhar: 'right', render: (l) => <span className="num">{fmtQtd(l.rendimento)} <span className="text-[12px] text-text-muted">{l.produto.unidade}</span></span> },
    { label: 'Insumos', alinhar: 'right', ocultarMobile: true, render: (l) => <span className="num">{l.nInsumos}</span> },
    { label: 'Custo por unidade', alinhar: 'right', render: (l) => <span className="num">{l.custoUnitario != null ? fmtBRL(l.custoUnitario) : '-'}</span> },
    { label: 'Versão', ocultarMobile: true, render: (l) => <span className="text-[13px] text-text-muted">v{l.versao}{l.expandirNaVenda ? ' · abre na venda' : ''}</span> },
  ]

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Fichas técnicas"
          description="O que cada prato ou preparo leva, com perda e fator de correção. A venda baixa os insumos."
          actions={podeEditar ? <NovaFicha produtos={semFicha.map((p) => ({ value: String(p.codigoProduto), label: `${p.descricao} · ${p.codigo}` }))} /> : undefined}
        />
      </ListaHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Indicador icon={BookOpenCheck} rotulo="Fichas ativas" valor={String(linhas.length)} dica="receitas em uso" />
        <Indicador icon={NotebookPen} rotulo="Sem ficha" valor={String(vendaveisSemFicha)} dica="pratos e preparos" tom={vendaveisSemFicha ? 'aviso' : undefined} />
        <Indicador icon={ChefHat} rotulo="Como funciona" valor="Líquido × FC" dica="+ perda = o que sai do estoque" />
      </div>

      <Lista
        colunas={colunas}
        linhas={linhas}
        chaveLinha={(l) => l.produto.codigoProduto}
        vazio={
          <EmptyState
            icon={ChefHat}
            title="Nenhuma ficha técnica ainda"
            hint="Crie a ficha de um prato para a venda baixar os ingredientes em vez do prato inteiro."
          />
        }
      />
      {!podeEditar && linhas.length === 0 && <p className="text-[13px] text-text-muted">Peça a quem gerencia os produtos para criar as fichas.</p>}
    </div>
  )
}
