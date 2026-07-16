import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { ProdutoSubstituicaoForm } from '@/components/produto-substituicao/ProdutoSubstituicaoForm'
import { ExcluirProdutoSubstituicao } from '@/components/produto-substituicao/ExcluirProdutoSubstituicao'
import { Shuffle } from 'lucide-react'

type VinculoRow = { id: number; n_cod_prod: number; substitui_n_cod_prod: number }
type Produto = { n_cod_prod: number; descricao: string | null }

export default async function ProdutoSubstituicaoPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produto Substituicoes'))) notFound()

  const supabase = await createClient()
  const podeCriar = await requirePermissao(lojaId, 'Produto Substituicoes - Criar')
  const podeExcluir = await requirePermissao(lojaId, 'Produto Substituicoes - Excluir')

  const { data: vinculos } = await supabase
    .from('produto_substituicoes')
    .select('id, n_cod_prod, substitui_n_cod_prod')
    .eq('loja_id', lojaId)
    .order('id')

  const { data: todosProdutos } = await supabase
    .from('produtos')
    .select('n_cod_prod:codigo_produto, descricao')
    .eq('loja_id', lojaId)
    .order('descricao')

  const nomeDe = (cod: number) =>
    (todosProdutos as Produto[] | null)?.find((p) => p.n_cod_prod === cod)?.descricao ?? `#${cod}`

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Produtos Substitutos"
          icon={Shuffle}
          description="Quando um produto não tem histórico de venda próprio (ex.: troca de marca/fornecedor), a previsão usa o histórico do produto vinculado aqui."
          voltarHref="/produto"
          actions={podeCriar ? <ProdutoSubstituicaoForm produtos={(todosProdutos ?? []) as Produto[]} /> : undefined}
        />
      </ListaHeader>

      <Lista<VinculoRow>
        linhas={(vinculos ?? []) as VinculoRow[]}
        chaveLinha={(v) => v.id}
        colunas={[
          { label: 'Produto sem histórico', primaria: true, flexivel: true, render: (v) => nomeDe(v.n_cod_prod) },
          { label: 'Usa o histórico de', flexivel: true, render: (v) => nomeDe(v.substitui_n_cod_prod) },
        ]}
        acao={(v) => (podeExcluir ? <ExcluirProdutoSubstituicao id={v.id} descricao={nomeDe(v.n_cod_prod)} /> : null)}
        vazio={
          <EmptyState
            icon={Shuffle}
            title="Nenhum vínculo cadastrado"
            hint="Vincule um produto sem histórico próprio a outro cujo histórico deva ser usado na previsão de venda."
          />
        }
      />
    </div>
  )
}
