import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { NovoUsuario } from '@/components/usuario/NovoUsuario'
import { EditarUsuario, type UsuarioEditavel } from '@/components/usuario/EditarUsuario'

type UsuarioRow = {
  id: string
  name: string
  perfil: string | null
  loja_user: { loja_id: number }[]
  permissao_user: { loja_id: number; permissao_id: number }[]
  local_estoque_user: { loja_id: number; local_estoque_id: number }[]
}

export default async function UsuarioPage() {
  if (!(await isAdmin())) notFound()

  const supabase = await createClient()
  const { data: usuarios } = await supabase
    .from('profiles')
    .select(
      'id, name, perfil, loja_user(loja_id), permissao_user(loja_id, permissao_id), local_estoque_user(loja_id, local_estoque_id)'
    )
    .order('name')
    .returns<UsuarioRow[]>()

  const { data: lojas } = await supabase
    .from('lojas')
    .select('id, nome, nome_fantasia')
    .eq('ativo', true)
    .order('nome_fantasia')

  const { data: permissoes } = await supabase
    .from('permissoes')
    .select('id, nome')
    .order('id')

  const { data: locais } = await supabase
    .from('local_estoques')
    .select('id, loja_id, descricao')
    .neq('inativo', 'S')
    .order('descricao')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Usuários</h1>
        <NovoUsuario lojas={lojas ?? []} />
      </div>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium">Nome</th>
              <th className="text-left p-3 font-medium">Perfil</th>
              <th className="text-right p-3 font-medium">Lojas</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {usuarios?.map((u) => {
              const lojaUser = Array.isArray(u.loja_user) ? u.loja_user : []
              const permUser = Array.isArray(u.permissao_user) ? u.permissao_user : []
              const localUser = Array.isArray(u.local_estoque_user) ? u.local_estoque_user : []
              const editavel: UsuarioEditavel = {
                id: u.id,
                name: u.name,
                perfil: u.perfil,
                lojaIds: lojaUser.map((r) => r.loja_id),
                permissoesAtivas: permUser.map((r) => `${r.loja_id}:${r.permissao_id}`),
                locaisAtivos: localUser.map((r) => `${r.loja_id}:${r.local_estoque_id}`),
              }
              return (
                <tr key={u.id} className="border-b hover:bg-gray-50">
                  <td className="p-3 font-medium">{u.name}</td>
                  <td className="p-3">
                    <Badge variant={u.perfil === 'Admin' ? 'default' : 'secondary'}>
                      {u.perfil}
                    </Badge>
                  </td>
                  <td className="p-3 text-right">{lojaUser.length}</td>
                  <td className="p-3 text-right">
                    <EditarUsuario
                      usuario={editavel}
                      lojas={lojas ?? []}
                      permissoes={permissoes ?? []}
                      locais={locais ?? []}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
