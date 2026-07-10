import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { CategoriaContabilForm } from '@/components/categoria-contabil/CategoriaContabilForm'
import { ExcluirCategoriaContabil } from '@/components/categoria-contabil/ExcluirCategoriaContabil'
import { Tags } from 'lucide-react'

type CategoriaRow = { id: number; nome: string; ativa: boolean }

export default async function CategoriaContabilPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Categorias Contabeis'))) notFound()

  const supabase = await createClient()
  const podeCriar = await requirePermissao(lojaId, 'Categorias Contabeis - Criar')
  const podeEditar = await requirePermissao(lojaId, 'Categorias Contabeis - Editar')
  const podeExcluir = await requirePermissao(lojaId, 'Categorias Contabeis - Excluir')

  const { data: categorias } = await supabase
    .from('categorias_contabeis')
    .select('id, nome, ativa')
    .eq('loja_id', lojaId)
    .order('nome')

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Categorias Contábeis"
          icon={Tags}
          description="Classificação local de itens de NF de entrada (matéria-prima, revenda, embalagem etc)"
          voltarHref="/nota-fiscal"
          actions={podeCriar ? <CategoriaContabilForm /> : undefined}
        />
      </ListaHeader>

      <Lista<CategoriaRow>
        linhas={(categorias ?? []) as CategoriaRow[]}
        chaveLinha={(c) => c.id}
        colunas={[
          { label: 'Nome', primaria: true, flexivel: true, render: (c) => c.nome },
          {
            label: 'Situação',
            alinhar: 'right',
            render: (c) => <StatusPill status={c.ativa ? 'Ativa' : 'Inativa'} />,
          },
        ]}
        acao={(c) => (
          <div className="flex items-center justify-end gap-1">
            {podeEditar && <CategoriaContabilForm categoria={{ id: c.id, nome: c.nome, ativa: c.ativa }} />}
            {podeExcluir && <ExcluirCategoriaContabil id={c.id} nome={c.nome} />}
          </div>
        )}
        vazio={
          <EmptyState
            icon={Tags}
            title="Nenhuma categoria cadastrada"
            hint='Crie uma categoria contábil para classificar os itens das NFs de entrada.'
          />
        }
      />

      <p className="px-1 text-[11px] text-text-muted">
        Cadastro só local (não sincroniza com o Omie). Usada para marcar cada item de NF de entrada com o tipo de gasto contábil.
      </p>
    </div>
  )
}
