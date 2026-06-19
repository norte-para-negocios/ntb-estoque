'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Check, X, ShieldCheck, ShieldHalf, User as UserIcon, Store } from 'lucide-react'
import { toast } from 'sonner'
import { aprovarUsuario, recusarUsuario, type PerfilUsuario } from '@/lib/actions/usuario'
import { btnClass } from '@/components/ui-kit/Button'
import { CATALOGO_PERMISSOES } from '@/lib/permissoes-catalogo'

type Loja = { id: number; nome: string; nome_fantasia: string | null }
type Permissao = { id: number; nome: string }

// Frente B: ao aprovar um pendente, o admin escolhe perfil + lojas + PERMISSOES
// (reusa o catalogo do NovoUsuario). Escopo (frente C): AdminLoja so aprova como
// 'Usuario' nas lojas dele; por isso `podeEscolherPerfilAlto` controla quais
// perfis aparecem (o servidor revalida de qualquer forma).
export function AprovarUsuario({
  userId,
  nome,
  lojas,
  permissoes,
  podeEscolherPerfilAlto,
}: {
  userId: string
  nome: string
  lojas: Loja[]
  permissoes: Permissao[]
  podeEscolherPerfilAlto: boolean
}) {
  const [open, setOpen] = useState(false)
  const [confirmarRecusa, setConfirmarRecusa] = useState(false)
  const [perfil, setPerfil] = useState<PerfilUsuario>('Usuario')
  const [lojaIds, setLojaIds] = useState<number[]>([])
  const [permIds, setPermIds] = useState<Set<number>>(new Set())
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const idPorNome = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of permissoes) m.set(p.nome, p.id)
    return m
  }, [permissoes])
  const todosIds = useMemo(() => permissoes.map((p) => p.id), [permissoes])

  function toggleLoja(id: number) {
    setLojaIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  function togglePerm(id: number) {
    setPermIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  function toggleModulo(ids: number[], todosMarcados: boolean) {
    setPermIds((prev) => {
      const n = new Set(prev)
      for (const id of ids) {
        if (todosMarcados) n.delete(id)
        else n.add(id)
      }
      return n
    })
  }

  function aprovar() {
    if (perfil !== 'Admin' && lojaIds.length === 0) {
      toast.error('Selecione ao menos uma loja')
      return
    }
    if (perfil === 'Usuario' && permIds.size === 0) {
      toast.error('Selecione ao menos uma permissão')
      return
    }
    startTransition(async () => {
      const res = await aprovarUsuario(userId, {
        perfil,
        lojaIds,
        permissaoIds: perfil === 'Usuario' ? Array.from(permIds) : undefined,
      })
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Cadastro aprovado')
      setOpen(false)
      router.refresh()
    })
  }

  function recusar() {
    startTransition(async () => {
      const res = await recusarUsuario(userId)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Cadastro recusado')
      router.refresh()
    })
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {confirmarRecusa ? (
        <>
          <span className="text-[13px] text-text-muted">Confirmar recusa?</span>
          <button
            type="button"
            onClick={recusar}
            disabled={pending}
            className={btnClass('danger')}
          >
            {pending ? 'Recusando...' : 'Confirmar'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmarRecusa(false)}
            disabled={pending}
            className={btnClass('ghost')}
          >
            Cancelar
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmarRecusa(true)}
          disabled={pending}
          className={btnClass('outline')}
        >
          <X className="size-4" /> Recusar
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <button type="button" className={btnClass('primary')}>
              <Check className="size-4" /> Aprovar
            </button>
          }
        />
        <DialogContent
          className="flex max-h-[88vh] flex-col overflow-hidden bg-surface p-0 sm:max-w-lg"
          showCloseButton={false}
        >
          <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <Check className="size-4" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-text">Aprovar acesso</div>
              <div className="truncate text-[12px] text-text-muted">{nome}</div>
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-text">Perfil</label>
              <div className={`grid grid-cols-1 gap-2 ${podeEscolherPerfilAlto ? 'sm:grid-cols-3' : ''}`}>
                <PerfilBtn
                  ativo={perfil === 'Usuario'}
                  onClick={() => setPerfil('Usuario')}
                  icon={<UserIcon className="size-4" />}
                  titulo="Usuário"
                  desc="Conforme permissões"
                />
                {podeEscolherPerfilAlto && (
                  <>
                    <PerfilBtn
                      ativo={perfil === 'AdminLoja'}
                      onClick={() => setPerfil('AdminLoja')}
                      icon={<ShieldHalf className="size-4" />}
                      titulo="Admin da loja"
                      desc="Total nas lojas dele"
                    />
                    <PerfilBtn
                      ativo={perfil === 'Admin'}
                      onClick={() => setPerfil('Admin')}
                      icon={<ShieldCheck className="size-4" />}
                      titulo="Administrador"
                      desc="Total no sistema"
                    />
                  </>
                )}
              </div>
            </div>

            {perfil !== 'Admin' && (
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-text">
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
                          on ? 'border-brand bg-brand-soft text-text' : 'border-border bg-surface text-text-muted hover:text-text'
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
              </div>
            )}

            {perfil === 'AdminLoja' && (
              <div className="rounded-md border border-brand/30 bg-brand-soft/40 px-3 py-2.5 text-[13px] text-text">
                Admin da loja entra com acesso total aos módulos das lojas marcadas.
              </div>
            )}
            {perfil === 'Admin' && (
              <div className="rounded-md border border-brand/30 bg-brand-soft/40 px-3 py-2.5 text-[13px] text-text">
                Administrador tem acesso a todas as lojas e a todos os módulos.
              </div>
            )}

            {perfil === 'Usuario' && (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-[13px] font-medium text-text">Permissões</label>
                  <div className="flex items-center gap-2 text-[12px]">
                    <button
                      type="button"
                      onClick={() => setPermIds(new Set(todosIds))}
                      className="font-medium text-brand hover:underline"
                    >
                      Marcar tudo
                    </button>
                    <span className="text-text-muted/50">·</span>
                    <button
                      type="button"
                      onClick={() => setPermIds(new Set())}
                      className="font-medium text-text-muted hover:text-text hover:underline"
                    >
                      Limpar
                    </button>
                  </div>
                </div>
                <p className="mb-2 text-[12px] text-text-muted">
                  Valem para todas as lojas marcadas acima. Dá para refinar por loja depois.
                </p>
                <div className="space-y-2">
                  {CATALOGO_PERMISSOES.map((mod) => {
                    const itens = mod.permissoes
                      .map((p) => ({ ...p, id: idPorNome.get(p.nome) }))
                      .filter((p): p is { nome: string; label: string; id: number } => p.id != null)
                    if (!itens.length) return null
                    const ids = itens.map((i) => i.id)
                    const marcados = ids.filter((id) => permIds.has(id)).length
                    const todos = marcados === ids.length
                    return (
                      <div key={mod.modulo} className="rounded-md border border-border bg-surface-2/30 p-2.5">
                        <button
                          type="button"
                          onClick={() => toggleModulo(ids, todos)}
                          className="flex w-full items-center justify-between gap-2 text-left"
                        >
                          <span className="text-[13px] font-medium text-text">{mod.modulo}</span>
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                              marcados > 0 ? 'bg-brand-soft text-brand' : 'bg-surface-2 text-text-muted'
                            }`}
                          >
                            {marcados}/{ids.length}
                          </span>
                        </button>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {itens.map((p) => {
                            const on = permIds.has(p.id)
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => togglePerm(p.id)}
                                className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                                  on ? 'border-brand bg-brand text-white' : 'border-border bg-surface text-text-muted hover:text-text'
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
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className={btnClass('outline')}>
              Cancelar
            </button>
            <button type="button" onClick={aprovar} disabled={pending} className={btnClass('primary')}>
              {pending ? 'Aprovando...' : 'Aprovar acesso'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PerfilBtn({
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
