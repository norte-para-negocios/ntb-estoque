'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronRight, CornerDownRight, Eye, EyeOff, Link2, Plus, Trash2, FolderTree } from 'lucide-react'
import { criarGrupo, editarGrupo, excluirGrupo, type GrupoLinha } from '@/lib/actions/catalogo-proprio'
import { btnClass } from '@/components/ui-kit/Button'
import { EmptyState } from '@/components/ui-kit/EmptyState'

const MAX_NIVEL = 5
const input = 'h-9 w-full min-w-0 rounded-[var(--r-md)] border-0 bg-surface-2 px-3 text-[14px] text-text outline-none placeholder:text-text-muted focus:ring-2 focus:ring-brand/40'

type No = GrupoLinha & { filhos: No[]; nivel: number; total: number }

function montar(grupos: GrupoLinha[]): No[] {
  const porPai = new Map<number | null, GrupoLinha[]>()
  for (const g of grupos) porPai.set(g.pai_id, [...(porPai.get(g.pai_id) ?? []), g])
  const build = (pai: number | null, nivel: number): No[] =>
    (porPai.get(pai) ?? []).map((g) => {
      const filhos = build(g.id, nivel + 1)
      return { ...g, filhos, nivel, total: g.produtos + filhos.reduce((s, f) => s + f.total, 0) }
    })
  return build(null, 1)
}

function Linha({ no, aberto, alternar, onAdd, onRename, onToggle, onDelete, podeCriar, podeEditar, podeExcluir, adicionando, setAdicionando, ocupado }: {
  no: No; aberto: Set<number>; alternar: (id: number) => void
  onAdd: (paiId: number | null, nome: string) => void; onRename: (id: number, nome: string) => void
  onToggle: (no: No) => void; onDelete: (id: number) => void
  podeCriar: boolean; podeEditar: boolean; podeExcluir: boolean
  adicionando: number | null | 'raiz'; setAdicionando: (v: number | null | 'raiz') => void; ocupado: boolean
}) {
  const [editando, setEditando] = useState(false)
  const [nome, setNome] = useState(no.nome)
  const [novo, setNovo] = useState('')
  const temFilhos = no.filhos.length > 0
  const expandido = aberto.has(no.id) || adicionando === no.id

  return (
    <li>
      <div className="group flex items-center gap-2 rounded-[var(--r-md)] px-2 py-1.5 u-motion hover:bg-surface-2" style={{ paddingLeft: 8 + (no.nivel - 1) * 22 }}>
        <button
          type="button" onClick={() => alternar(no.id)} disabled={!temFilhos}
          aria-label={expandido ? 'Recolher' : 'Expandir'}
          className={`flex size-6 shrink-0 items-center justify-center rounded-full text-text-muted u-motion ${temFilhos ? 'hover:bg-[var(--border)]' : 'opacity-0'}`}
        >
          <ChevronRight className={`size-4 u-motion ${expandido ? 'rotate-90' : ''}`} strokeWidth={2.2} />
        </button>

        {editando ? (
          <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); onRename(no.id, nome); setEditando(false) }}>
            <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} className={input} aria-label="Nome do grupo" />
            <button className={btnClass('primary')} disabled={ocupado}>Salvar</button>
            <button type="button" className={btnClass('ghost')} onClick={() => { setNome(no.nome); setEditando(false) }}>Cancelar</button>
          </form>
        ) : (
          <>
            <button
              type="button" onClick={() => podeEditar && setEditando(true)} title={podeEditar ? 'Clique para renomear' : undefined}
              className={`min-w-0 flex-1 truncate text-left text-[15px] ${no.nivel === 1 ? 'font-semibold' : 'font-medium'} ${no.ativo ? 'text-text' : 'text-text-muted line-through'}`}
            >
              {no.nome}
            </button>
            <span className="hidden shrink-0 items-center gap-2 text-[12px] text-text-muted sm:flex">
              {no.vinculado && <span className="inline-flex items-center gap-1 text-brand" title="Já aparece no Norte Vendas"><Link2 className="size-3.5" />Vendas</span>}
              <span className="tabular-nums">{no.total} {no.total === 1 ? 'produto' : 'produtos'}</span>
            </span>
            <span className="flex shrink-0 items-center gap-0.5 opacity-0 u-motion group-hover:opacity-100 focus-within:opacity-100 max-lg:opacity-100">
              {podeCriar && no.nivel < MAX_NIVEL && (
                <button type="button" onClick={() => setAdicionando(no.id)} aria-label="Adicionar subgrupo" title="Adicionar subgrupo"
                  className="flex size-8 items-center justify-center rounded-full text-text-muted u-motion hover:bg-[var(--border)] hover:text-text"><Plus className="size-4" /></button>
              )}
              {podeEditar && (
                <button type="button" onClick={() => onToggle(no)} aria-label={no.ativo ? 'Inativar' : 'Reativar'} title={no.ativo ? 'Inativar' : 'Reativar'}
                  className="flex size-8 items-center justify-center rounded-full text-text-muted u-motion hover:bg-[var(--border)] hover:text-text">
                  {no.ativo ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </button>
              )}
              {podeExcluir && !temFilhos && no.produtos === 0 && (
                <button type="button" onClick={() => onDelete(no.id)} aria-label="Excluir" title="Excluir"
                  className="flex size-8 items-center justify-center rounded-full text-text-muted u-motion hover:bg-[var(--border)] hover:text-err"><Trash2 className="size-4" /></button>
              )}
            </span>
          </>
        )}
      </div>

      {adicionando === no.id && (
        <form
          className="my-1 flex items-center gap-2" style={{ paddingLeft: 8 + no.nivel * 22 + 8 }}
          onSubmit={(e) => { e.preventDefault(); if (novo.trim()) { onAdd(no.id, novo.trim()); setNovo('') } }}
        >
          <CornerDownRight className="size-4 shrink-0 text-text-muted" />
          <input autoFocus value={novo} onChange={(e) => setNovo(e.target.value)} className={input} placeholder={`Novo subgrupo de ${no.nome}`} aria-label="Nome do subgrupo" />
          <button className={btnClass('primary')} disabled={ocupado || !novo.trim()}>Adicionar</button>
          <button type="button" className={btnClass('ghost')} onClick={() => setAdicionando(null)}>Fechar</button>
        </form>
      )}

      {expandido && temFilhos && (
        <ul>
          {no.filhos.map((f) => (
            <Linha key={f.id} no={f} aberto={aberto} alternar={alternar} onAdd={onAdd} onRename={onRename} onToggle={onToggle} onDelete={onDelete}
              podeCriar={podeCriar} podeEditar={podeEditar} podeExcluir={podeExcluir} adicionando={adicionando} setAdicionando={setAdicionando} ocupado={ocupado} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function ArvoreGrupos({ grupos, podeCriar, podeEditar, podeExcluir }: { grupos: GrupoLinha[]; podeCriar: boolean; podeEditar: boolean; podeExcluir: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const arvore = useMemo(() => montar(grupos), [grupos])
  const [aberto, setAberto] = useState<Set<number>>(() => new Set(grupos.filter((g) => g.pai_id == null).map((g) => g.id)))
  const [adicionando, setAdicionando] = useState<number | null | 'raiz'>(null)
  const [novoRaiz, setNovoRaiz] = useState('')

  function alternar(id: number) {
    setAberto((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function rodar(fn: () => Promise<{ error?: string } | { ok: true }>, ok?: string, depois?: () => void) {
    start(async () => {
      const r = await fn()
      if ('error' in r && r.error) { toast.error(r.error); return }
      if (ok) toast.success(ok)
      depois?.()
      router.refresh()
    })
  }
  const adicionar = (paiId: number | null, nome: string) =>
    rodar(() => criarGrupo({ nome, paiId }), 'Grupo criado', () => { if (paiId != null) setAberto((s) => new Set(s).add(paiId)); if (paiId == null) setNovoRaiz('') })

  const totalGrupos = grupos.length
  const sincronizados = grupos.filter((g) => g.vinculado).length

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section className="rounded-[var(--r-lg)] bg-surface p-3 shadow-[var(--shadow-sm)] sm:p-4">
        {arvore.length === 0 ? (
          <EmptyState icon={FolderTree} title="Nenhum grupo ainda" hint="Crie o primeiro grupo (ex.: Bebidas, Pratos, Insumos) e depois os subgrupos dentro dele." />
        ) : (
          <ul className="space-y-0.5">
            {arvore.map((n) => (
              <Linha key={n.id} no={n} aberto={aberto} alternar={alternar} onAdd={adicionar}
                onRename={(id, nome) => rodar(() => editarGrupo(id, { nome }), 'Nome atualizado')}
                onToggle={(no) => rodar(() => editarGrupo(no.id, { ativo: !no.ativo }), no.ativo ? 'Grupo inativado' : 'Grupo reativado')}
                onDelete={(id) => rodar(() => excluirGrupo(id), 'Grupo excluído')}
                podeCriar={podeCriar} podeEditar={podeEditar} podeExcluir={podeExcluir} adicionando={adicionando} setAdicionando={setAdicionando} ocupado={pending} />
            ))}
          </ul>
        )}

        {podeCriar && (
          <form
            className="mt-3 flex items-center gap-2 border-t border-border pt-3"
            onSubmit={(e) => { e.preventDefault(); if (novoRaiz.trim()) adicionar(null, novoRaiz.trim()) }}
          >
            <input value={novoRaiz} onChange={(e) => setNovoRaiz(e.target.value)} className={input} placeholder="Novo grupo (ex.: Bebidas)" aria-label="Nome do novo grupo" />
            <button className={btnClass('primary')} disabled={pending || !novoRaiz.trim()}><Plus className="size-4" />Criar grupo</button>
          </form>
        )}
      </section>

      <aside className="space-y-3 self-start">
        <div className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
          <p className="text-[13px] font-medium text-text-muted">Grupos</p>
          <p className="mt-1 text-[28px] font-bold leading-none tracking-[-0.02em] text-text tabular-nums">{totalGrupos}</p>
          <p className="mt-2 text-[13px] text-text-muted">{sincronizados} já aparecem no Norte Vendas.</p>
        </div>
        <div className="rounded-[var(--r-lg)] bg-surface p-4 text-[13px] leading-relaxed text-text-muted shadow-[var(--shadow-sm)]">
          <p className="mb-1.5 font-semibold text-text">Como funciona</p>
          <p>O primeiro nível vira <b className="text-text">grupo de categorias</b> no Vendas e o segundo vira <b className="text-text">categoria</b>. Níveis mais fundos ficam só aqui, para organizar o estoque.</p>
          <p className="mt-2">Clique no nome para renomear. Grupo com produtos ou subgrupos não pode ser excluído: inative.</p>
        </div>
      </aside>
    </div>
  )
}
