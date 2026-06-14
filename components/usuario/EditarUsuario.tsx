'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  editarUsuario,
  excluirUsuario,
  togglePermissao,
  toggleLocal,
} from '@/lib/actions/usuario'
import { btnClass } from '@/components/ui-kit/Button'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

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
}: {
  usuario: UsuarioEditavel
  lojas: Loja[]
  permissoes: Permissao[]
  locais: Local[]
  podeExcluir?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [confirmarExclusao, setConfirmarExclusao] = useState(false)
  const [name, setName] = useState(usuario.name)
  const [perfil, setPerfil] = useState<'Admin' | 'Usuario'>(
    usuario.perfil === 'Admin' ? 'Admin' : 'Usuario'
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

  function toggleLoja(id: number) {
    setLojaIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function salvarDados() {
    if (!name) {
      toast.error('Preencha o nome')
      return
    }
    if (perfil === 'Usuario' && lojaIds.length === 0) {
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
          <button type="button" className={`${btnClass('outline')} shrink-0`}>
            <Pencil className="size-4" /> Editar
          </button>
        }
      />
      <SheetContent className="w-full overflow-y-auto bg-surface p-0 sm:max-w-lg" showCloseButton={false}>
        <div className="border-b border-border px-4 py-3 text-base font-semibold text-text">
          Editar usuário
        </div>

        <div className="space-y-4 px-4 py-3">
          <div>
            <label className={labelClass}>Nome</label>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Perfil</label>
            <select
              className={inputClass}
              value={perfil}
              onChange={(e) => setPerfil((e.target.value as 'Admin' | 'Usuario') ?? 'Usuario')}
            >
              <option value="Usuario">Usuário</option>
              <option value="Admin">Administrador</option>
            </select>
          </div>

          {perfil === 'Usuario' && (
            <div>
              <label className={labelClass}>Lojas com acesso</label>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {lojas.map((l) => (
                  <label key={l.id} className="flex items-center gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      checked={lojaIds.includes(l.id)}
                      onChange={() => toggleLoja(l.id)}
                      className="accent-[var(--brand)]"
                    />
                    {l.nome_fantasia || l.nome}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Salve os dados antes de ajustar permissões e locais das lojas recém-adicionadas.
              </p>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={salvarDados}
              disabled={pending}
              className={btnClass('primary')}
            >
              {pending ? 'Salvando...' : 'Salvar dados'}
            </button>
          </div>

          {perfil === 'Usuario' &&
            lojasSelecionadas.map((loja) => {
              const locaisLoja = locais.filter((lo) => lo.loja_id === loja.id)
              return (
                <div key={loja.id} className="space-y-3 rounded-md border border-border bg-surface-2/40 p-3">
                  <p className="text-sm font-medium text-text">
                    {loja.nome_fantasia || loja.nome}
                  </p>

                  <div className="space-y-1">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-text-muted">Permissões</p>
                    <div className="grid grid-cols-1 gap-1">
                      {permissoes.map((p) => (
                        <label
                          key={p.id}
                          className="flex items-center gap-2 text-sm text-text"
                        >
                          <input
                            type="checkbox"
                            checked={permAtivas.has(`${loja.id}:${p.id}`)}
                            onChange={() => alternarPermissao(loja.id, p.id)}
                            className="accent-[var(--brand)]"
                          />
                          {p.nome}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-text-muted">Locais de estoque</p>
                    {locaisLoja.length ? (
                      <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto">
                        {locaisLoja.map((lo) => (
                          <label
                            key={lo.id}
                            className="flex items-center gap-2 text-sm text-text"
                          >
                            <input
                              type="checkbox"
                              checked={locaisAtivos.has(`${loja.id}:${lo.id}`)}
                              onChange={() => alternarLocal(loja.id, lo.id)}
                              className="accent-[var(--brand)]"
                            />
                            {lo.descricao || `Local ${lo.id}`}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-text-muted">
                        Nenhum local de estoque cadastrado.
                      </p>
                    )}
                  </div>
                </div>
              )
            })}

          {podeExcluir && (
            <div className="mt-2 rounded-md border border-[var(--err)]/30 bg-[var(--err)]/5 p-3">
              <p className="mb-2 text-[13px] font-medium text-text">Zona de risco</p>
              {confirmarExclusao ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-text-muted">Excluir este usuário em definitivo?</span>
                  <button
                    type="button"
                    onClick={excluir}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[var(--err)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    <Trash2 className="size-4" /> {pending ? 'Excluindo...' : 'Confirmar exclusão'}
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
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--err)]/40 px-3 py-1.5 text-sm font-medium text-[var(--err)] transition-colors hover:bg-[var(--err)]/10"
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
