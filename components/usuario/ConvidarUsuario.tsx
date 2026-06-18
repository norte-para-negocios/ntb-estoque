'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Ticket, ShieldHalf, User as UserIcon, Store, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import { gerarConvite, type PerfilConvite } from '@/lib/actions/convite'
import { btnClass } from '@/components/ui-kit/Button'
import { CATALOGO_PERMISSOES } from '@/lib/permissoes-catalogo'

const labelClass = 'mb-1.5 block text-[13px] font-medium text-text'

type Loja = { id: number; nome: string; nome_fantasia: string | null }
type Permissao = { id: number; nome: string }

// Frente A: gerar convite por codigo COM permissoes embutidas. O admin (global ou
// AdminLoja) escolhe loja + perfil + permissoes; o codigo gerado e copiado pra mandar
// pra pessoa, que se cadastra ja com aquilo. AdminLoja so convida 'Usuario' e so as
// lojas dele (a UI ja recebe so as lojas no escopo; o servidor revalida).
export function ConvidarUsuario({
  lojas,
  permissoes,
  podeAdminLoja,
  lojaFixaId,
  triggerLabel = 'Convidar por código',
}: {
  lojas: Loja[]
  permissoes: Permissao[]
  // Admin global pode gerar convite de perfil AdminLoja; AdminLoja so 'Usuario'.
  podeAdminLoja: boolean
  // Quando vem (ex.: aba dentro da tela da Loja), trava a loja e esconde o seletor.
  lojaFixaId?: number
  triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [perfil, setPerfil] = useState<PerfilConvite>('Usuario')
  const [lojaId, setLojaId] = useState<number | null>(lojaFixaId ?? null)
  const [permNomes, setPermNomes] = useState<Set<string>>(new Set())
  const [validadeDias, setValidadeDias] = useState<number>(7)
  const [codigoGerado, setCodigoGerado] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  // So mostra no catalogo as permissoes que existem no banco (idPorNome serve de filtro).
  const nomesExistentes = useMemo(() => new Set(permissoes.map((p) => p.nome)), [permissoes])
  const todosNomes = useMemo(() => permissoes.map((p) => p.nome), [permissoes])

  function togglePerm(nome: string) {
    setPermNomes((prev) => {
      const n = new Set(prev)
      if (n.has(nome)) n.delete(nome)
      else n.add(nome)
      return n
    })
  }

  function toggleModulo(nomes: string[], todosMarcados: boolean) {
    setPermNomes((prev) => {
      const n = new Set(prev)
      for (const nome of nomes) {
        if (todosMarcados) n.delete(nome)
        else n.add(nome)
      }
      return n
    })
  }

  function resetar() {
    setPerfil('Usuario')
    setLojaId(lojaFixaId ?? null)
    setPermNomes(new Set())
    setValidadeDias(7)
    setCodigoGerado(null)
    setCopiado(false)
  }

  function copiar() {
    if (!codigoGerado) return
    navigator.clipboard.writeText(codigoGerado)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  function gerar() {
    if (!lojaId) {
      toast.error('Selecione a loja do convite')
      return
    }
    if (perfil === 'Usuario' && permNomes.size === 0) {
      toast.error('Selecione ao menos uma permissão')
      return
    }
    startTransition(async () => {
      const res = await gerarConvite({
        lojaId,
        perfil,
        permissoes: perfil === 'Usuario' ? Array.from(permNomes) : undefined,
        validadeDias,
      })
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      setCodigoGerado(res.codigo ?? null)
      toast.success('Convite gerado')
      router.refresh()
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) resetar()
      }}
    >
      <DialogTrigger
        render={
          <button type="button" className={btnClass('outline')}>
            <Ticket className="size-4" /> {triggerLabel}
          </button>
        }
      />
      <DialogContent
        className="flex max-h-[88vh] flex-col overflow-hidden bg-surface p-0 sm:max-w-lg"
        showCloseButton={false}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <Ticket className="size-4" strokeWidth={2} />
          </span>
          <div>
            <div className="text-[15px] font-semibold text-text">Convidar por código</div>
            <div className="text-[12px] text-text-muted">
              Gere um código com as permissões já definidas
            </div>
          </div>
        </div>

        {codigoGerado ? (
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-6">
            <div className="rounded-md border border-ok/30 bg-ok/10 px-3 py-2.5 text-[13px] text-text">
              Convite criado. Envie este código para a pessoa. Ela usa no cadastro e entra já
              com o acesso definido. O código vale para um cadastro só.
            </div>
            <div>
              <label className={labelClass}>Código do convite</label>
              <div className="flex flex-wrap gap-2">
                <input
                  value={codigoGerado}
                  readOnly
                  className="num min-w-[10rem] flex-1 rounded-md border border-border bg-surface-2/40 px-3 py-2 text-sm font-medium tracking-wider text-text outline-none"
                />
                <button type="button" onClick={copiar} className={`${btnClass('primary')} shrink-0`}>
                  {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copiado ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => resetar()} className={btnClass('outline')}>
                Gerar outro
              </button>
              <button type="button" onClick={() => setOpen(false)} className={btnClass('primary')}>
                Concluir
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              {/* Loja (escondida quando fixada por contexto) */}
              {!lojaFixaId && (
                <div>
                  <label className={labelClass}>
                    <span className="inline-flex items-center gap-1.5">
                      <Store className="size-3.5 text-text-muted" /> Loja
                    </span>
                  </label>
                  <div className="grid grid-cols-1 gap-1.5 rounded-md border border-border bg-surface-2/30 p-2 sm:grid-cols-2">
                    {lojas.map((l) => {
                      const on = lojaId === l.id
                      return (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => setLojaId(l.id)}
                          className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                            on
                              ? 'border-brand bg-brand-soft text-text'
                              : 'border-border bg-surface text-text-muted hover:text-text'
                          }`}
                        >
                          <span
                            className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
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

              {/* Perfil */}
              <div>
                <label className={labelClass}>Perfil concedido</label>
                <div className={`grid grid-cols-1 gap-2 ${podeAdminLoja ? 'sm:grid-cols-2' : ''}`}>
                  <button
                    type="button"
                    onClick={() => setPerfil('Usuario')}
                    className={`flex flex-col gap-1 rounded-md border p-2.5 text-left transition-colors ${
                      perfil === 'Usuario' ? 'border-brand bg-brand-soft' : 'border-border bg-surface hover:bg-surface-2'
                    }`}
                  >
                    <span className={`flex items-center gap-1.5 text-[13px] font-medium ${perfil === 'Usuario' ? 'text-brand' : 'text-text'}`}>
                      <UserIcon className="size-4" /> Usuário
                    </span>
                    <span className="text-[11px] text-text-muted">Acesso conforme permissões</span>
                  </button>
                  {podeAdminLoja && (
                    <button
                      type="button"
                      onClick={() => setPerfil('AdminLoja')}
                      className={`flex flex-col gap-1 rounded-md border p-2.5 text-left transition-colors ${
                        perfil === 'AdminLoja' ? 'border-brand bg-brand-soft' : 'border-border bg-surface hover:bg-surface-2'
                      }`}
                    >
                      <span className={`flex items-center gap-1.5 text-[13px] font-medium ${perfil === 'AdminLoja' ? 'text-brand' : 'text-text'}`}>
                        <ShieldHalf className="size-4" /> Admin da loja
                      </span>
                      <span className="text-[11px] text-text-muted">Acesso total à loja</span>
                    </button>
                  )}
                </div>
              </div>

              {perfil === 'AdminLoja' ? (
                <div className="rounded-md border border-brand/30 bg-brand-soft/40 px-3 py-2.5 text-[13px] text-text">
                  Admin da loja entra com acesso total aos módulos desta loja. As permissões são
                  concedidas automaticamente.
                </div>
              ) : (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="text-[13px] font-medium text-text">Permissões</label>
                    <div className="flex items-center gap-2 text-[12px]">
                      <button
                        type="button"
                        onClick={() => setPermNomes(new Set(todosNomes))}
                        className="font-medium text-brand hover:underline"
                      >
                        Marcar tudo
                      </button>
                      <span className="text-text-muted/50">·</span>
                      <button
                        type="button"
                        onClick={() => setPermNomes(new Set())}
                        className="font-medium text-text-muted hover:text-text hover:underline"
                      >
                        Limpar
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {CATALOGO_PERMISSOES.map((mod) => {
                      const itens = mod.permissoes.filter((p) => nomesExistentes.has(p.nome))
                      if (!itens.length) return null
                      const nomes = itens.map((i) => i.nome)
                      const marcados = nomes.filter((n) => permNomes.has(n)).length
                      const todos = marcados === nomes.length
                      return (
                        <div
                          key={mod.modulo}
                          className="rounded-md border border-border bg-surface-2/30 p-2.5"
                        >
                          <button
                            type="button"
                            onClick={() => toggleModulo(nomes, todos)}
                            className="flex w-full items-center justify-between gap-2 text-left"
                          >
                            <span className="text-[13px] font-medium text-text">{mod.modulo}</span>
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                marcados > 0 ? 'bg-brand-soft text-brand' : 'bg-surface-2 text-text-muted'
                              }`}
                            >
                              {marcados}/{nomes.length}
                            </span>
                          </button>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {itens.map((p) => {
                              const on = permNomes.has(p.nome)
                              return (
                                <button
                                  key={p.nome}
                                  type="button"
                                  onClick={() => togglePerm(p.nome)}
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
                </div>
              )}

              {/* Validade */}
              <div>
                <label className={labelClass}>Validade</label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { d: 1, l: '1 dia' },
                    { d: 7, l: '7 dias' },
                    { d: 30, l: '30 dias' },
                    { d: 0, l: 'Sem prazo' },
                  ].map((o) => (
                    <button
                      key={o.d}
                      type="button"
                      onClick={() => setValidadeDias(o.d)}
                      className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                        validadeDias === o.d
                          ? 'border-brand bg-brand text-white'
                          : 'border-border bg-surface text-text-muted hover:text-text'
                      }`}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button type="button" onClick={() => setOpen(false)} disabled={pending} className={btnClass('outline')}>
                Cancelar
              </button>
              <button type="button" onClick={gerar} disabled={pending} className={btnClass('primary')}>
                {pending ? 'Gerando...' : 'Gerar convite'}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
