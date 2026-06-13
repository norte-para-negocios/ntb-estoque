'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import {
  editarUsuario,
  togglePermissao,
  toggleLocal,
} from '@/lib/actions/usuario'

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
}: {
  usuario: UsuarioEditavel
  lojas: Loja[]
  permissoes: Permissao[]
  locais: Local[]
}) {
  const [open, setOpen] = useState(false)
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
          <button type="button" className="ntb-btn-outline shrink-0">
            <Pencil className="size-4" /> Editar
          </button>
        }
      />
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-lg" showCloseButton={false}>
        <div className="ntb-card-header text-base">Editar usuário</div>

        <div className="space-y-4 px-4 py-3">
          <div>
            <label className="ntb-label">Nome</label>
            <input className="ntb-input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="ntb-label">Perfil</label>
            <select
              className="ntb-input"
              value={perfil}
              onChange={(e) => setPerfil((e.target.value as 'Admin' | 'Usuario') ?? 'Usuario')}
            >
              <option value="Usuario">Usuário</option>
              <option value="Admin">Administrador</option>
            </select>
          </div>

          {perfil === 'Usuario' && (
            <div>
              <label className="ntb-label">Lojas com acesso</label>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded border border-[#d5d5d5] p-2">
                {lojas.map((l) => (
                  <label key={l.id} className="flex items-center gap-2 text-sm text-[#5d5d5d]">
                    <input
                      type="checkbox"
                      checked={lojaIds.includes(l.id)}
                      onChange={() => toggleLoja(l.id)}
                    />
                    {l.nome_fantasia || l.nome}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-[#8a8a8a]">
                Salve os dados antes de ajustar permissões e locais das lojas recém-adicionadas.
              </p>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={salvarDados}
              disabled={pending}
              className="ntb-btn-teal disabled:opacity-60"
            >
              {pending ? 'Salvando...' : 'Salvar dados'}
            </button>
          </div>

          {perfil === 'Usuario' &&
            lojasSelecionadas.map((loja) => {
              const locaisLoja = locais.filter((lo) => lo.loja_id === loja.id)
              return (
                <div key={loja.id} className="space-y-3 rounded border border-[#e2e2e2] p-3">
                  <p className="text-sm font-medium text-[#5d5d5d]">
                    {loja.nome_fantasia || loja.nome}
                  </p>

                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[#8a8a8a]">Permissões</p>
                    <div className="grid grid-cols-1 gap-1">
                      {permissoes.map((p) => (
                        <label
                          key={p.id}
                          className="flex items-center gap-2 text-sm text-[#5d5d5d]"
                        >
                          <input
                            type="checkbox"
                            checked={permAtivas.has(`${loja.id}:${p.id}`)}
                            onChange={() => alternarPermissao(loja.id, p.id)}
                          />
                          {p.nome}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[#8a8a8a]">Locais de estoque</p>
                    {locaisLoja.length ? (
                      <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto">
                        {locaisLoja.map((lo) => (
                          <label
                            key={lo.id}
                            className="flex items-center gap-2 text-sm text-[#5d5d5d]"
                          >
                            <input
                              type="checkbox"
                              checked={locaisAtivos.has(`${loja.id}:${lo.id}`)}
                              onChange={() => alternarLocal(loja.id, lo.id)}
                            />
                            {lo.descricao || `Local ${lo.id}`}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[#8a8a8a]">
                        Nenhum local de estoque cadastrado.
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
        </div>
      </SheetContent>
    </Sheet>
  )
}
