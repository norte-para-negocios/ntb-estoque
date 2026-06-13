import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { NovoUsuario } from '@/components/usuario/NovoUsuario'
import { EditarUsuario, type UsuarioEditavel } from '@/components/usuario/EditarUsuario'
import { Users, ArrowLeft } from 'lucide-react'

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
    <div className="space-y-4">
      {/* Título estilo original: voltar + ícone + nome */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/home" className="text-[#8a8a8a] hover:text-[#5d5d5d]" title="Voltar">
            <ArrowLeft className="size-5" strokeWidth={2} />
          </Link>
          <Users className="size-5 text-[#2eb5c3]" strokeWidth={2} />
          <h1 className="text-lg font-semibold text-[#5d5d5d]">Usuários</h1>
        </div>
        <NovoUsuario lojas={lojas ?? []} />
      </div>

      {/* Lista de cards empilhados (fiel ao original) */}
      <div className="space-y-4">
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
              <div key={u.id} className="ntb-card">
                <div className="ntb-card-header flex items-center justify-between gap-3">
                  <span className="truncate">{u.name}</span>
                  <span className="shrink-0 text-sm font-normal text-white/90">{u.perfil}</span>
                </div>
                <div className="ntb-card-body flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <small className="text-[#8a8a8a]">Lojas com acesso</small>
                    <p className="font-semibold text-[#5d5d5d]">{lojaUser.length}</p>
                  </div>
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
          <div className="ntb-card">
            <div className="ntb-card-body text-center text-[#8a8a8a]">
              Nenhum usuário cadastrado. Clique em &quot;Novo usuário&quot; para começar.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
