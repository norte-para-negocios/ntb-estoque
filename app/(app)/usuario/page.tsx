import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { NovoUsuario } from '@/components/usuario/NovoUsuario'

export default async function UsuarioPage() {
  if (!(await isAdmin())) notFound()

  const supabase = await createClient()
  const { data: usuarios } = await supabase
    .from('profiles')
    .select('id, name, perfil, loja_user(loja_id)')
    .order('name')

  const { data: lojas } = await supabase
    .from('lojas')
    .select('id, nome, nome_fantasia')
    .eq('ativo', true)
    .order('nome_fantasia')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Usuarios</h1>
        <NovoUsuario lojas={lojas ?? []} />
      </div>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium">Nome</th>
              <th className="text-left p-3 font-medium">Perfil</th>
              <th className="text-right p-3 font-medium">Lojas</th>
            </tr>
          </thead>
          <tbody>
            {usuarios?.map((u) => {
              const numLojas = Array.isArray(u.loja_user) ? u.loja_user.length : 0
              return (
                <tr key={u.id} className="border-b hover:bg-gray-50">
                  <td className="p-3 font-medium">{u.name}</td>
                  <td className="p-3">
                    <Badge variant={u.perfil === 'Admin' ? 'default' : 'secondary'}>
                      {u.perfil}
                    </Badge>
                  </td>
                  <td className="p-3 text-right">{numLojas}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
