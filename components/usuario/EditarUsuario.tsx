'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Pencil, Trash2, ShieldCheck, ShieldHalf, User as UserIcon, Store, Warehouse } from 'lucide-react'
import { toast } from 'sonner'
import {
  editarUsuario,
  excluirUsuario,
  togglePermissao,
  toggleLocal,
  type PerfilUsuario,
} from '@/lib/actions/usuario'
import { btnClass, btnLinhaClass, RotuloAcao } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { CATALOGO_PERMISSOES } from '@/lib/permissoes-catalogo'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand'
const labelClass = 'mb-1.5 block text-[13px] font-medium text-text'

type Loja = { id: number; nome: string; nome_fantasia: string | null }
type Permissao = { id: number; nome: string }
type Local = { id: number; loja_id: number; descricao: string | null }

export type UsuarioEditavel = {
  id: string
  name: string
  perfil: string | null
  lojaIds: number[]
  // chaves "lojaId:permissaoId" e "lojaId:localId" ativas
  permissoesAtivas: string[]
  locaisAtivos: string[]
}

export function EditarUsuario({
  usuario,
  lojas,
  permissoes,
  locais,
  podeExcluir = true,
  // Escopo (frente C): AdminLoja nao promove ninguem a AdminLoja/Admin global.
  podeEscolherPerfilAlto = true,
}: {
  usuario: UsuarioEditavel
  lojas: Loja[]
  permissoes: Permissao[]
  locais: Local[]
  podeExcluir?: boolean
  podeEscolherPerfilAlto?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [confirmarExclusao, setConfirmarExclusao] = useState(false)
  const [name, setName] = useState(usuario.name)
  const [perfil, setPerfil] = useState<PerfilUsuario>(
    usuario.perfil === 'Admin'
      ? 'Admin'
      : usuario.perfil === 'AdminLoja'
        ? 'AdminLoja'
        : 'Usuario'
  )
  const [lojaIds, setLojaIds] = useState<number[]>(usuario.lojaIds)
  const [permAtivas, setPermAtivas] = useState<Set<string>>(
    new Set(usuario.permissoesAtivas)
  )
  const [locaisAtivos, setLocaisAtivos] = useState<Set<string>>(
    new Set(usuario.locaisAtivos)
  )
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const idPorNome = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of permissoes) m.set(p.nome, p.id)
    return m
  }, [permissoes])

  function toggleLoja(id: number) {
    setLojaIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function salvarDados() {
    if (!name) {
      toast.error('Preencha o nome')
      return
    }
    if (perfil !== 'Admin' && lojaIds.length === 0) {
      toast.error('Selecione ao menos uma loja')
      return
    }
    startTransition(async () => {
      const res = await editarUsuario(usuario.id, {
        name,
        perfil,
        lojaIds: perfil === 'Admin' ? lojas.map((l) => l.id) : lojaIds,
      })
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Usuário atualizado')
      setOpen(false)
      router.refresh()
    })
  }

  function alternarPermissao(lojaId: number, permissaoId: number) {
    const chave = `${lojaId}:${permissaoId}`
    const ativar = !permAtivas.has(chave)
    setPermAtivas((prev) => {
      const n = new Set(prev)
      if (ativar) n.add(chave)
      else n.delete(chave)
      return n
    })
    startTransition(async () => {
      const res = await togglePermissao(usuario.id, lojaId, permissaoId, ativar)
      if (res?.error) toast.error('Erro', { description: res.error })
    })
  }

  // Liga/desliga todas as permissoes de um modulo numa loja de uma vez.
  function alternarModulo(lojaId: number, ids: number[], todosMarcados: boolean) {
    for (const permissaoId of ids) {
      const chave = `${lojaId}:${permissaoId}`
      const jaAtiva = permAtivas.has(chave)
      // Se a acao e marcar, so liga as que estao desligadas; se e desmarcar, so desliga as ligadas.
      if (todosMarcados && jaAtiva) alternarPermissao(lojaId, permissaoId)
      else if (!todosMarcados && !jaAtiva) alternarPermissao(lojaId, permissaoId)
    }
  }

  function excluir() {
    startTransition(async () => {
      const res = await excluirUsuario(usuario.id)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Usuário excluído')
      setOpen(false)
      router.refresh()
    })
  }

  function alternarLocal(lojaId: number, localId: number) {
    const chave = `${lojaId}:${localId}`
    const ativar = !locaisAtivos.has(chave)
    setLocaisAtivos((prev) => {
      const n = new Set(prev)
      if (ativar) n.add(chave)
      else n.delete(chave)
      return n
    })
    startTransition(async () => {
      const res = await toggleLocal(usuario.id, lojaId, localId, ativar)
      if (res?.error) toast.error('Erro', { description: res.error })
    })
  }

  const lojasSelecionadas = lojas.filter((l) => lojaIds.includes(l.id))

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button type="button" className={`${btnLinhaClass('outline')} shrink-0`} aria-label="Editar" title="Editar">
            <Pencil className="size-4" /> <RotuloAcao>Editar</RotuloAcao>
          </button>
        }
      />
      <SheetContent className="w-full overflow-y-auto bg-surface p-0 sm:max-w-lg" showCloseButton={false}>
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <UserIcon className="size-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-text">Editar usuário</div>
            <div className="truncate text-[12px] text-text-muted">{usuario.name}</div>
          </div>
        </div>

        <div className="space-y-5 px-5 py-4">
          <div>
            <label className={labelClass}>Nome</label>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <label className={labelClass}>Perfil</label>
            <div className={`grid grid-cols-1 gap-2 ${podeEscolherPerfilAlto ? 'sm:grid-cols-3' : ''}`}>
              <PerfilOpcao
                ativo={perfil === 'Usuario'}
                onClick={() => setPerfil('Usuario')}
                icon={<UserIcon className="size-4" />}
                titulo="Usuário"
                desc="Acesso conforme permissões"
              />
              {podeEscolherPerfilAlto && (
                <>
                  <PerfilOpcao
                    ativo={perfil === 'AdminLoja'}
                    onClick={() => setPerfil('AdminLoja')}
                    icon={<ShieldHalf className="size-4" />}
                    titulo="Admin da loja"
                    desc="Acesso total às lojas dele"
                  />
                  <PerfilOpcao
                    ativo={perfil === 'Admin'}
                    onClick={() => setPerfil('Admin')}
                    icon={<ShieldCheck className="size-4" />}
                    titulo="Administrador"
                    desc="Acesso total ao sistema"
                  />
                </>
              )}
            </div>
          </div>

          {perfil !== 'Admin' && (
            <div>
              <label className={labelClass}>
                <span className="inline-flex items-center gap-1.5">
                  <Store className="size-3.5 text-text-muted" /> Lojas com acesso
                </span>
              </label>
              <div className="grid grid-cols-1 gap-1.5 rounded-md border border-border bg-surface-2/30 p-2 sm:grid-cols-2">
                {lojas.map((l) => {
                  const on = lojaIds.includes(l.id)
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => toggleLoja(l.id)}
                      className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                        on
                          ? 'border-brand bg-brand-soft text-text'
                          : 'border-border bg-surface text-text-muted hover:text-text'
                      }`}
                    >
                      <span
                        className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                          on ? 'border-brand bg-brand text-white' : 'border-border'
                        }`}
                      >
                        {on && <span className="text-[10px] leading-none">✓</span>}
                      </span>
                      <span className="truncate">{l.nome_fantasia || l.nome}</span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-[12px] text-text-muted">
                Salve os dados antes de ajustar permissões e locais das lojas recém-adicionadas.
              </p>
            </div>
          )}

          {perfil === 'Admin' && (
            <div className="rounded-md border border-brand/30 bg-brand-soft/40 px-3 py-2.5 text-[13px] text-text">
              Administrador tem acesso a todas as lojas e a todos os módulos.
            </div>
          )}

          {perfil === 'AdminLoja' && (
            <div className="rounded-md border border-brand/30 bg-brand-soft/40 px-3 py-2.5 text-[13px] text-text">
              Admin da loja tem acesso total aos módulos das lojas acima. Ao salvar, as
              permissões dessas lojas são concedidas automaticamente. Não vê outras lojas nem
              a administração global.
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={salvarDados}
              disabled={pending}
              className={btnClass('primary')}
            >
              {pending && <Spinner />}
              {pending ? 'Salvando...' : 'Salvar dados'}
            </button>
          </div>

          {perfil === 'Usuario' &&
            lojasSelecionadas.map((loja) => {
              const locaisLoja = locais.filter((lo) => lo.loja_id === loja.id)
              return (
                <div key={loja.id} className="space-y-3 rounded-md border border-border bg-surface-2/40 p-3">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
                    <Store className="size-3.5 text-text-muted" />
                    {loja.nome_fantasia || loja.nome}
                  </p>

                  <div className="space-y-2">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
                      Permissões
                    </p>
                    {CATALOGO_PERMISSOES.map((mod) => {
                      const itens = mod.permissoes
                        .map((p) => ({ ...p, id: idPorNome.get(p.nome) }))
                        .filter((p): p is { nome: string; label: string; id: number } => p.id != null)
                      if (!itens.length) return null
                      const ids = itens.map((i) => i.id)
                      const marcados = ids.filter((id) => permAtivas.has(`${loja.id}:${id}`)).length
                      const todos = marcados === ids.length
                      return (
                        <div
                          key={mod.modulo}
                          className="rounded-md border border-border bg-surface p-2.5"
                        >
                          <button
                            type="button"
                            onClick={() => alternarModulo(loja.id, ids, todos)}
                            className="flex w-full items-center justify-between gap-2 text-left"
                          >
                            <span className="text-[13px] font-medium text-text">{mod.modulo}</span>
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                marcados > 0
                                  ? 'bg-brand-soft text-brand'
                                  : 'bg-surface-2 text-text-muted'
                              }`}
                            >
                              {marcados}/{ids.length}
                            </span>
                          </button>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {itens.map((p) => {
                              const on = permAtivas.has(`${loja.id}:${p.id}`)
                              return (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => alternarPermissao(loja.id, p.id)}
                                  className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                                    on
                                      ? 'border-brand bg-brand text-white'
                                      : 'border-border bg-surface text-text-muted hover:text-text'
                                  }`}
                                >
                                  {p.label}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="space-y-2">
                    <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-muted">
                      <Warehouse className="size-3" /> Locais de estoque
                    </p>
                    {locaisLoja.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {locaisLoja.map((lo) => {
                          const on = locaisAtivos.has(`${loja.id}:${lo.id}`)
                          return (
                            <button
                              key={lo.id}
                              type="button"
                              onClick={() => alternarLocal(loja.id, lo.id)}
                              className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                                on
                                  ? 'border-brand bg-brand text-white'
                                  : 'border-border bg-surface text-text-muted hover:text-text'
                              }`}
                            >
                              {lo.descricao || `Local ${lo.id}`}
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-text-muted">Nenhum local de estoque cadastrado.</p>
                    )}
                  </div>
                </div>
              )
            })}

          {podeExcluir && (
            <div className="mt-2 rounded-md border border-err/30 bg-err/5 p-3">
              <p className="mb-2 text-[13px] font-medium text-text">Zona de risco</p>
              {confirmarExclusao ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-text-muted">Excluir este usuário em definitivo?</span>
                  <button
                    type="button"
                    onClick={excluir}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-md bg-err px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {pending ? <Spinner /> : <Trash2 className="size-4" />} {pending ? 'Excluindo...' : 'Confirmar exclusão'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmarExclusao(false)}
                    disabled={pending}
                    className={btnClass('ghost')}
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmarExclusao(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-err/40 px-3 py-1.5 text-sm font-medium text-err transition-colors hover:bg-err/10"
                >
                  <Trash2 className="size-4" /> Excluir usuário
                </button>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function PerfilOpcao({
  ativo,
  onClick,
  icon,
  titulo,
  desc,
}: {
  ativo: boolean
  onClick: () => void
  icon: React.ReactNode
  titulo: string
  desc: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col gap-1 rounded-md border p-2.5 text-left transition-colors ${
        ativo ? 'border-brand bg-brand-soft' : 'border-border bg-surface hover:bg-surface-2'
      }`}
    >
      <span className={`flex items-center gap-1.5 text-[13px] font-medium ${ativo ? 'text-brand' : 'text-text'}`}>
        {icon}
        {titulo}
      </span>
      <span className="text-[11px] text-text-muted">{desc}</span>
    </button>
  )
}
