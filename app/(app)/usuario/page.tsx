import { createClient } from '@/lib/supabase/server'
import { getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { NovoUsuario } from '@/components/usuario/NovoUsuario'
import { EditarUsuario, type UsuarioEditavel } from '@/components/usuario/EditarUsuario'
import { AprovarUsuario } from '@/components/usuario/AprovarUsuario'
import { ConvidarUsuario } from '@/components/usuario/ConvidarUsuario'
import { ConvitesLista, type ConviteItem } from '@/components/usuario/ConvitesLista'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { BuscaSimples } from '@/components/BuscaSimples'
import { escapeIlike } from '@/lib/utils-busca'
import { Users, UserPlus, Ticket } from 'lucide-react'

type UsuarioRow = {
  id: string
  name: string
  email: string | null
  perfil: string | null
  status: string | null
  loja_user: { loja_id: number }[]
  permissao_user: { loja_id: number; permissao_id: number }[]
  local_estoque_user: { loja_id: number; local_estoque_id: number }[]
}

export default async function UsuarioPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  // Frente C: Admin global OU AdminLoja (escopado). Outros perfis -> 404.
  const ator = await getAtorGestao()
  if (!ator.podeGerir) notFound()

  const params = await searchParams
  const q = (params.q ?? '').trim()

  const supabase = await createClient()

  // Lojas que o ator pode gerir (Admin global: todas ativas; AdminLoja: as dele).
  const { data: lojasTodas } = await supabase
    .from('lojas')
    .select('id, nome, nome_fantasia')
    .eq('ativo', true)
    .order('nome_fantasia')
  const lojas = (lojasTodas ?? []).filter((l) => ator.lojaIds.includes(l.id))
  const lojaIdsEscopo = lojas.map((l) => l.id)

  let usuariosQuery = supabase
    .from('profiles')
    .select(
      'id, name, email, perfil, status, loja_user(loja_id), permissao_user(loja_id, permissao_id), local_estoque_user(loja_id, local_estoque_id)'
    )
    .order('name')

  if (q) usuariosQuery = usuariosQuery.ilike('name', `%${escapeIlike(q)}%`)

  const { data: usuariosTodos } = await usuariosQuery.returns<UsuarioRow[]>()

  // AdminLoja: enxerga SO os usuarios vinculados a alguma loja dele, e nunca Admin
  // global nem outro AdminLoja. Admin global ve todos.
  const escopados = ator.isAdminGlobal
    ? (usuariosTodos ?? [])
    : (usuariosTodos ?? []).filter((u) => {
        if (u.perfil === 'Admin' || u.perfil === 'AdminLoja') return false
        const vinc = Array.isArray(u.loja_user) ? u.loja_user : []
        return vinc.some((r) => lojaIdsEscopo.includes(r.loja_id))
      })

  // Pendentes (fila "pediu acesso"). Pendentes nao tem loja vinculada (cadastro sem
  // codigo), entao tanto Admin global quanto AdminLoja os veem e podem aprovar (o
  // AdminLoja so consegue aprovar pra loja dele, validado no servidor).
  const pendentes = (usuariosTodos ?? []).filter((u) => u.status === 'pendente')
  const usuarios = escopados.filter((u) => u.status !== 'pendente')

  const { data: permissoes } = await supabase
    .from('permissoes')
    .select('id, nome')
    .order('id')

  // Locais so das lojas no escopo do ator.
  let locaisQuery = supabase
    .from('local_estoques')
    .select('id, loja_id, descricao')
    .neq('inativo', 'S')
    .order('descricao')
  if (!ator.isAdminGlobal) {
    locaisQuery = locaisQuery.in('loja_id', lojaIdsEscopo.length ? lojaIdsEscopo : [-1])
  }
  const { data: locais } = await locaisQuery

  // Convites ativos (nao usados) das lojas no escopo (frente A).
  const { data: convitesRaw } = await supabase
    .from('convites')
    .select('id, codigo, perfil, permissoes, expira_em, loja_id, lojas(nome, nome_fantasia)')
    .is('usado_em', null)
    .in('loja_id', lojaIdsEscopo.length ? lojaIdsEscopo : [-1])
    .order('criado_em', { ascending: false })
    .returns<
      {
        id: number
        codigo: string
        perfil: string
        permissoes: unknown
        expira_em: string | null
        loja_id: number
        lojas: { nome: string; nome_fantasia: string | null } | null
      }[]
    >()

  const convites: ConviteItem[] = (convitesRaw ?? []).map((c) => ({
    id: c.id,
    codigo: c.codigo,
    perfil: c.perfil,
    permissoesCount: Array.isArray(c.permissoes) ? c.permissoes.length : 0,
    lojaNome: c.lojas?.nome_fantasia || c.lojas?.nome || `Loja ${c.loja_id}`,
    expira_em: c.expira_em,
  }))

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Usuários"
          icon={Users}
          description={
            ator.isAdminGlobal
              ? 'Acessos, permissões e locais por loja'
              : 'Usuários, convites e aprovações das suas lojas'
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <ConvidarUsuario
                lojas={lojas}
                permissoes={permissoes ?? []}
                podeAdminLoja={ator.isAdminGlobal}
              />
              <NovoUsuario
                lojas={lojas}
                permissoes={permissoes ?? []}
                podeEscolherPerfilAlto={ator.isAdminGlobal}
              />
            </div>
          }
        />
      </ListaHeader>

      {pendentes.length > 0 && (
        <div className="rounded-lg border border-brand/40 bg-brand-soft/40">
          <div className="flex items-center gap-2 border-b border-brand/30 px-4 py-2.5">
            <UserPlus className="size-4 text-brand" />
            <h2 className="text-[13px] font-semibold text-text">
              Pediram acesso · aguardando aprovação ({pendentes.length})
            </h2>
          </div>
          <ul className="divide-y divide-border">
            {pendentes.map((u) => (
              <li
                key={u.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-text">{u.name}</div>
                  <div className="truncate text-[12px] text-text-muted">{u.email || '-'}</div>
                </div>
                <AprovarUsuario
                  userId={u.id}
                  nome={u.name}
                  lojas={lojas}
                  permissoes={permissoes ?? []}
                  podeEscolherPerfilAlto={ator.isAdminGlobal}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Convites ativos (frente A) */}
      <div className="rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <Ticket className="size-4 text-text-muted" />
          <h2 className="text-[13px] font-semibold text-text">
            Convites ativos ({convites.length})
          </h2>
        </div>
        <ConvitesLista convites={convites} />
      </div>

      <BuscaSimples basePath="/usuario" placeholder="Buscar por nome" defaultValue={q} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {usuarios?.length ? (
          usuarios.map((u) => {
            const lojaUser = Array.isArray(u.loja_user) ? u.loja_user : []
            const permUser = Array.isArray(u.permissao_user) ? u.permissao_user : []
            const localUser = Array.isArray(u.local_estoque_user) ? u.local_estoque_user : []
            // AdminLoja so enxerga (e edita) os vinculos das lojas dele.
            const lojaUserVisivel = ator.isAdminGlobal
              ? lojaUser
              : lojaUser.filter((r) => lojaIdsEscopo.includes(r.loja_id))
            const permVisivel = ator.isAdminGlobal
              ? permUser
              : permUser.filter((r) => lojaIdsEscopo.includes(r.loja_id))
            const localVisivel = ator.isAdminGlobal
              ? localUser
              : localUser.filter((r) => lojaIdsEscopo.includes(r.loja_id))
            const editavel: UsuarioEditavel = {
              id: u.id,
              name: u.name,
              perfil: u.perfil,
              lojaIds: lojaUserVisivel.map((r) => r.loja_id),
              permissoesAtivas: permVisivel.map((r) => `${r.loja_id}:${r.permissao_id}`),
              locaisAtivos: localVisivel.map((r) => `${r.loja_id}:${r.local_estoque_id}`),
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
                      <span className="num text-text">{lojaUserVisivel.length}</span> loja(s) com
                      acesso
                    </div>
                  </div>
                  <StatusPill status={u.perfil} />
                </div>
                <div className="flex justify-end border-t border-border pt-3">
                  <EditarUsuario
                    usuario={editavel}
                    lojas={lojas}
                    permissoes={permissoes ?? []}
                    locais={locais ?? []}
                    podeExcluir={u.id !== ator.id}
                    podeEscolherPerfilAlto={ator.isAdminGlobal}
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
              hint='Clique em "Novo usuário" ou "Convidar por código" para começar.'
            />
          </div>
        )}
      </div>
    </div>
  )
}
