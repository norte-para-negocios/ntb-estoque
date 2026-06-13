import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { NovoUsuario } from '@/components/usuario/NovoUsuario'
import { EditarUsuario, type UsuarioEditavel } from '@/components/usuario/EditarUsuario'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { BuscaSimples } from '@/components/BuscaSimples'
import { Users } from 'lucide-react'

type UsuarioRow = {
  id: string
  name: string
  perfil: string | null
  loja_user: { loja_id: number }[]
  permissao_user: { loja_id: number; permissao_id: number }[]
  local_estoque_user: { loja_id: number; local_estoque_id: number }[]
}

export default async function UsuarioPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  if (!(await isAdmin())) notFound()

  const params = await searchParams
  const q = (params.q ?? '').trim()

  const supabase = await createClient()
  let usuariosQuery = supabase
    .from('profiles')
    .select(
      'id, name, perfil, loja_user(loja_id), permissao_user(loja_id, permissao_id), local_estoque_user(loja_id, local_estoque_id)'
    )
    .order('name')

  if (q) usuariosQuery = usuariosQuery.ilike('name', `%${q}%`)

  const { data: usuarios } = await usuariosQuery.returns<UsuarioRow[]>()

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
    <div className="space-y-4">
      <PageHeader
        title="Usuários"
        icon={Users}
        description="Acessos, permissoes e locais por loja"
        actions={<NovoUsuario lojas={lojas ?? []} />}
      />

      <BuscaSimples basePath="/usuario" placeholder="Buscar por nome" defaultValue={q} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {usuarios?.length ? (
          usuarios.map((u) => {
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
              <div
                key={u.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-text">{u.name}</div>
                    <div className="mt-0.5 text-[12px] text-text-muted">
                      <span className="num text-text">{lojaUser.length}</span> loja(s) com acesso
                    </div>
                  </div>
                  <StatusPill status={u.perfil} />
                </div>
                <div className="flex justify-end border-t border-border pt-3">
                  <EditarUsuario
                    usuario={editavel}
                    lojas={lojas ?? []}
                    permissoes={permissoes ?? []}
                    locais={locais ?? []}
                  />
                </div>
              </div>
            )
          })
        ) : (
          <div className="sm:col-span-2 lg:col-span-3">
            <EmptyState
              icon={Users}
              title="Nenhum usuário cadastrado"
              hint='Clique em "Novo usuário" para começar.'
            />
          </div>
        )}
      </div>
    </div>
  )
}
