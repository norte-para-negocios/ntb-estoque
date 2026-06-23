'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { IdCard, Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { criarCargo, editarCargo, excluirCargo, type CargoComPermissoes } from '@/lib/actions/cargo'
import { CATALOGO_PERMISSOES } from '@/lib/permissoes-catalogo'
import { btnClass, btnLinhaClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { EmptyState } from '@/components/ui-kit/EmptyState'

const inputClass = 'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-brand'

type Permissao = { id: number; nome: string }

export function CargosManager({ cargos, permissoes }: { cargos: CargoComPermissoes[]; permissoes: Permissao[] }) {
  // nome -> id (o catálogo é por nome; o banco grava por id).
  const idPorNome = useMemo(() => new Map(permissoes.map((p) => [p.nome, p.id])), [permissoes])

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <EditorCargo idPorNome={idPorNome} trigger={<button className={btnClass('primary')}><Plus className="size-4" /> Novo cargo</button>} />
      </div>

      {cargos.length === 0 ? (
        <EmptyState icon={IdCard} title="Nenhum cargo" hint="Crie um cargo (ex.: Gerente) com o conjunto de permissões dele." />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {cargos.map((c) => (
            <div key={c.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-medium text-text"><IdCard className="size-4 text-brand" /> {c.nome}</div>
                  {c.descricao && <p className="mt-0.5 text-[13px] text-text-muted">{c.descricao}</p>}
                </div>
                <span className="shrink-0 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[12px] text-text-muted">{c.permissaoIds.length} perm.</span>
              </div>
              <div className="mt-3 flex items-center gap-1">
                <EditorCargo idPorNome={idPorNome} cargo={c} trigger={<button className={btnLinhaClass('ghost')}><Pencil className="size-4" /> Editar</button>} />
                <ExcluirCargoBtn id={c.id} nome={c.nome} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ExcluirCargoBtn({ id, nome }: { id: number; nome: string }) {
  const [pending, start] = useTransition()
  const [confirmar, setConfirmar] = useState(false)
  const router = useRouter()
  function excluir() {
    start(async () => {
      const res = await excluirCargo(id)
      if (res?.error) toast.error('Erro', { description: res.error })
      else { toast.success(`Cargo "${nome}" excluído`); router.refresh() }
    })
  }
  if (!confirmar) {
    return <button onClick={() => setConfirmar(true)} className={btnLinhaClass('ghost')}><Trash2 className="size-4" /> Excluir</button>
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button onClick={excluir} disabled={pending} className={`${btnLinhaClass('ghost')} text-err`}>{pending ? <Spinner /> : 'Confirmar'}</button>
      <button onClick={() => setConfirmar(false)} className={btnLinhaClass('ghost')}>Cancelar</button>
    </span>
  )
}

function EditorCargo({
  idPorNome,
  cargo,
  trigger,
}: {
  idPorNome: Map<string, number>
  cargo?: CargoComPermissoes
  trigger: React.ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [nome, setNome] = useState(cargo?.nome ?? '')
  const [descricao, setDescricao] = useState(cargo?.descricao ?? '')
  const [sel, setSel] = useState<Set<number>>(new Set(cargo?.permissaoIds ?? []))
  const [pending, start] = useTransition()
  const router = useRouter()

  function toggle(id: number) {
    setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  // Marca/desmarca o módulo inteiro de uma vez.
  function toggleModulo(ids: number[], todos: boolean) {
    setSel((prev) => { const n = new Set(prev); for (const id of ids) todos ? n.delete(id) : n.add(id); return n })
  }

  function salvar() {
    if (!nome.trim()) { toast.error('Informe o nome do cargo'); return }
    const permissaoIds = [...sel]
    start(async () => {
      const res = cargo ? await editarCargo(cargo.id, { nome, descricao, permissaoIds }) : await criarCargo({ nome, descricao, permissaoIds })
      if (res?.error) { toast.error('Erro', { description: res.error }); return }
      toast.success(cargo ? 'Cargo salvo' : 'Cargo criado')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={trigger} />
      <SheetContent side="right" className="w-[92vw] overflow-y-auto bg-surface p-0 sm:max-w-none sm:w-[460px]" showCloseButton>
        <div className="border-b border-border px-4 py-3 text-base font-semibold text-text">{cargo ? 'Editar cargo' : 'Novo cargo'}</div>
        <div className="space-y-4 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[13px] font-medium text-text-muted">Nome *</label>
              <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputClass} placeholder="Ex.: Gerente" />
            </div>
            <div>
              <label className="mb-1 block text-[13px] font-medium text-text-muted">Descrição</label>
              <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={inputClass} placeholder="Opcional" />
            </div>
          </div>

          <div className="space-y-3">
            {(['Operação', 'Cadastros'] as const).map((grupo) => (
              <div key={grupo}>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{grupo}</div>
                <div className="space-y-2">
                  {CATALOGO_PERMISSOES.filter((m) => m.grupo === grupo).map((m) => {
                    const ids = m.permissoes.map((p) => idPorNome.get(p.nome)).filter((v): v is number => v != null)
                    const todos = ids.length > 0 && ids.every((id) => sel.has(id))
                    return (
                      <div key={m.modulo} className="rounded-md border border-border p-2.5">
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-[13px] font-medium text-text">{m.modulo}</span>
                          <button type="button" onClick={() => toggleModulo(ids, todos)} className="text-[12px] text-brand hover:underline">
                            {todos ? 'Desmarcar' : 'Marcar tudo'}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {m.permissoes.map((p) => {
                            const id = idPorNome.get(p.nome)
                            if (id == null) return null
                            const on = sel.has(id)
                            return (
                              <button
                                key={p.nome}
                                type="button"
                                onClick={() => toggle(id)}
                                className={`rounded-full border px-2.5 py-1 text-[12px] u-motion ${on ? 'border-brand bg-brand/10 text-brand' : 'border-border text-text-muted hover:bg-surface-2'}`}
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
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button onClick={() => setOpen(false)} className={btnClass('outline')}>Cancelar</button>
          <button onClick={salvar} disabled={pending} className={btnClass('primary')}>{pending ? <Spinner /> : null}{cargo ? 'Salvar' : 'Criar cargo'}</button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
