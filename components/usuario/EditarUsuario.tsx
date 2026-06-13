'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
          <Button variant="outline" size="sm">
            <Pencil className="size-4" /> Editar
          </Button>
        }
      />
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Editar usuário</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Perfil</Label>
            <Select
              value={perfil}
              onValueChange={(v) => setPerfil((v as 'Admin' | 'Usuario') ?? 'Usuario')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Usuario">Usuário</SelectItem>
                <SelectItem value="Admin">Administrador</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {perfil === 'Usuario' && (
            <div className="space-y-2">
              <Label>Lojas com acesso</Label>
              <div className="space-y-1 max-h-40 overflow-y-auto border rounded p-2">
                {lojas.map((l) => (
                  <label key={l.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={lojaIds.includes(l.id)}
                      onChange={() => toggleLoja(l.id)}
                    />
                    {l.nome_fantasia || l.nome}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Salve os dados antes de ajustar permissões e locais das lojas recém-adicionadas.
              </p>
            </div>
          )}

          <SheetFooter className="px-0">
            <Button onClick={salvarDados} disabled={pending}>
              {pending ? 'Salvando...' : 'Salvar dados'}
            </Button>
          </SheetFooter>

          {perfil === 'Usuario' &&
            lojasSelecionadas.map((loja) => {
              const locaisLoja = locais.filter((lo) => lo.loja_id === loja.id)
              return (
                <div key={loja.id} className="border rounded p-3 space-y-3">
                  <p className="font-medium text-sm">{loja.nome_fantasia || loja.nome}</p>

                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Permissões</p>
                    <div className="grid grid-cols-1 gap-1">
                      {permissoes.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 text-sm">
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
                    <p className="text-xs font-medium text-muted-foreground">Locais de estoque</p>
                    {locaisLoja.length ? (
                      <div className="grid grid-cols-1 gap-1 max-h-40 overflow-y-auto">
                        {locaisLoja.map((lo) => (
                          <label key={lo.id} className="flex items-center gap-2 text-sm">
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
                      <p className="text-xs text-muted-foreground">
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
