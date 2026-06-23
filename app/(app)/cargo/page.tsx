import { createServiceClient } from '@/lib/supabase/server'
import { getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { listarCargos } from '@/lib/actions/cargo'
import { CargosManager } from '@/components/cargo/CargosManager'
import { IdCard } from 'lucide-react'

export default async function CargosPage() {
  if (!(await getAtorGestao()).podeGerir) notFound()

  const supabase = createServiceClient()
  const [cargos, { data: permsRaw }] = await Promise.all([
    listarCargos(),
    supabase.from('permissoes').select('id, nome').order('nome'),
  ])
  const permissoes = (permsRaw ?? []) as { id: number; nome: string }[]

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Cargos"
          icon={IdCard}
          description="Conjuntos de permissão reutilizáveis (Gerente, Estoquista...) — atribua um cargo ao funcionário no cadastro de Usuários"
        />
      </ListaHeader>
      <CargosManager cargos={cargos} permissoes={permissoes} />
    </div>
  )
}
