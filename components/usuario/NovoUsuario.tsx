'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { criarUsuario } from '@/lib/actions/usuario'

type Loja = { id: number; nome: string; nome_fantasia: string | null }

export function NovoUsuario({ lojas }: { lojas: Loja[] }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [perfil, setPerfil] = useState<'Admin' | 'Usuario'>('Usuario')
  const [lojaIds, setLojaIds] = useState<number[]>([])
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function toggleLoja(id: number) {
    setLojaIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function criar() {
    if (!name || !email) {
      toast.error('Preencha nome e e-mail')
      return
    }
    if (perfil === 'Usuario' && lojaIds.length === 0) {
      toast.error('Selecione ao menos uma loja')
      return
    }
    startTransition(async () => {
      const res = await criarUsuario({
        name,
        email,
        perfil,
        lojaIds: perfil === 'Admin' ? lojas.map((l) => l.id) : lojaIds,
      })
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Usuário criado', {
        description: `Senha provisória: ${res.senha}`,
        duration: 15000,
      })
      setOpen(false)
      setName('')
      setEmail('')
      setLojaIds([])
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" /> Novo usuário
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo usuário</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>E-mail</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Perfil</Label>
            <Select value={perfil} onValueChange={(v) => setPerfil((v as 'Admin' | 'Usuario') ?? 'Usuario')}>
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
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={criar} disabled={pending}>
            {pending ? 'Criando...' : 'Criar usuário'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
