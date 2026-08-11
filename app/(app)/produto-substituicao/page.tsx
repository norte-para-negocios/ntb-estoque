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

const COLUNAS_SORT = ['n_cod_prod', 'substitui_n_cod_prod'] as const
type ColSort = (typeof COLUNAS_SORT)[number]

export default async function ProdutoSubstituicaoPage({
  searchParams,
}: {
  searchParams: Promise<{ ord?: string; dir?: string }>
}) {
  const sp = await searchParams
  const ordRaw = sp.ord ?? 'n_cod_prod'
  const ord: ColSort = (COLUNAS_SORT as readonly string[]).includes(ordRaw) ? (ordRaw as ColSort) : 'n_cod_prod'
  const dir = sp.dir === 'desc' ? 'desc' : 'asc'

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

  // Sort em JS: ordena pelo NOME resolvido (não pelo código cru), já que é
  // isso que o usuário vê na coluna. Dataset pequeno (cadastro manual de
  // vínculos), sem paginação -- seguro ordenar em memória depois de buscar.
  const vinculosOrdenados = [...(vinculos ?? [])].sort((a, b) => {
    const campo = ord === 'n_cod_prod' ? 'n_cod_prod' : 'substitui_n_cod_prod'
    const cmp = nomeDe(a[campo]).localeCompare(nomeDe(b[campo]), 'pt-BR')
    return dir === 'asc' ? cmp : -cmp
  })

  function buildSortHref(key: string, newDir: 'asc' | 'desc'): string {
    const p = new URLSearchParams()
    p.set('ord', key)
    p.set('dir', newDir)
    return `/produto-substituicao?${p.toString()}`
  }

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
        linhas={vinculosOrdenados as VinculoRow[]}
        chaveLinha={(v) => v.id}
        sortAtual={ord}
        dirAtual={dir}
        sortHref={buildSortHref}
        colunas={[
          {
            label: 'Produto sem histórico',
            primaria: true,
            flexivel: true,
            sort: 'n_cod_prod',
            render: (v) => nomeDe(v.n_cod_prod),
          },
          {
            label: 'Usa o histórico de',
            flexivel: true,
            sort: 'substitui_n_cod_prod',
            render: (v) => nomeDe(v.substitui_n_cod_prod),
          },
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
