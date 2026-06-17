import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Package } from 'lucide-react'
import { buscarFamilias } from '@/lib/actions/produto'
import { FormNovoProduto } from '@/components/produtos/FormNovoProduto'

// Tela dedicada de cadastro de produto (sai do modal apertado): aproveita o
// espaco horizontal, campos organizados em secoes. Familias carregadas no server.
export default async function NovoProdutoPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) notFound()

  const familias = await buscarFamilias()

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/produto"
          className="inline-flex items-center gap-1 text-[13px] text-text-muted transition-colors hover:text-text"
        >
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold tracking-[-0.01em] text-text">
          <Package className="size-5 text-brand" /> Novo produto
        </h1>
        <p className="mt-0.5 text-[13px] text-text-muted">Criado direto no Omie</p>
      </div>
      <FormNovoProduto familias={familias} />
    </div>
  )
}
