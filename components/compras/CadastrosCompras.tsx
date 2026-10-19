'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { salvarComprador, salvarLeadTimeFornecedor } from '@/lib/actions/compras-cadastros'

const campo = 'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-2.5 py-1.5 text-sm text-text outline-none focus:ring-2 focus:ring-brand/40'
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export type CompradorLinha = { id: number; nome: string; userId: string | null; ativo: boolean }
export type FornecedorPrazo = { id: number; nome: string; cnpj: string | null; dias: number | null }

export function Compradores({ compradores, usuarios, podeEditar }: { compradores: CompradorLinha[]; usuarios: { id: string; nome: string }[]; podeEditar: boolean }) {
  const router = useRouter()
  const [pend, start] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const [novo, setNovo] = useState({ nome: '', userId: '' })
  const nomeUsuario = new Map(usuarios.map((u) => [u.id, u.nome]))

  function salvar(d: { id?: number; nome: string; userId: string | null; ativo: boolean }, depois?: () => void) {
    setErro(null)
    start(async () => {
      const r = await salvarComprador(d)
      if ('error' in r) setErro(r.error)
      else { depois?.(); router.refresh() }
    })
  }

  return (
    <section className="space-y-3 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div>
        <h2 className="text-[15px] font-semibold text-text">Compradores</h2>
        <p className="text-[12.5px] text-text-muted">Quem cuida das compras. O comprador vai na requisição e no pedido; ligado a um usuário, ele vê &quot;só as minhas&quot; nas tarefas de compras.</p>
      </div>
      {compradores.length === 0 && <p className="text-[13px] text-text-muted">Nenhum comprador cadastrado.</p>}
      <ul className="divide-y divide-[var(--border)]">
        {compradores.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 py-2 text-[13px]">
            <span className={`min-w-[160px] flex-1 font-medium ${c.ativo ? 'text-text' : 'text-text-muted line-through'}`}>{c.nome}</span>
            {podeEditar ? (
              <select aria-label={`Usuário de ${c.nome}`} value={c.userId ?? ''} disabled={pend} className={`${campo} max-w-[240px]`}
                onChange={(e) => salvar({ id: c.id, nome: c.nome, userId: e.target.value || null, ativo: c.ativo })}>
                <option value="">Sem usuário</option>
                {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            ) : <span className="text-text-muted">{c.userId ? nomeUsuario.get(c.userId) ?? 'usuário' : 'sem usuário'}</span>}
            {podeEditar && (
              <button type="button" disabled={pend} className={btnClass('outline')} onClick={() => salvar({ id: c.id, nome: c.nome, userId: c.userId, ativo: !c.ativo })}>
                {c.ativo ? 'Desativar' : 'Reativar'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {podeEditar && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-3">
          <input aria-label="Nome do novo comprador" placeholder="Nome do comprador" maxLength={70} value={novo.nome} onChange={(e) => setNovo((n) => ({ ...n, nome: e.target.value }))} className={`${campo} max-w-[260px]`} />
          <select aria-label="Usuário do novo comprador" value={novo.userId} onChange={(e) => setNovo((n) => ({ ...n, userId: e.target.value }))} className={`${campo} max-w-[240px]`}>
            <option value="">Sem usuário</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
          <button type="button" disabled={pend || !novo.nome.trim()} className={btnClass('primary')}
            onClick={() => salvar({ nome: novo.nome.trim(), userId: novo.userId || null, ativo: true }, () => setNovo({ nome: '', userId: '' }))}>
            <Plus className="size-4" /> Incluir
          </button>
        </div>
      )}
      {erro && <p className="text-[13px] text-err">{erro}</p>}
    </section>
  )
}

export function PrazosFornecedores({ fornecedores, podeEditar }: { fornecedores: FornecedorPrazo[]; podeEditar: boolean }) {
  const router = useRouter()
  const [pend, start] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const vis = useMemo(() => {
    const q = semAcento(busca.trim())
    return fornecedores
      .filter((f) => !q || semAcento(f.nome).includes(q) || (f.cnpj ?? '').includes(q.replace(/\D/g, '') || '§'))
      .sort((a, b) => Number(b.dias != null) - Number(a.dias != null) || a.nome.localeCompare(b.nome, 'pt-BR'))
      .slice(0, 100)
  }, [fornecedores, busca])

  function salvar(f: FornecedorPrazo, valor: string) {
    const t = valor.trim()
    const dias = t === '' ? null : Number(t)
    if (dias === f.dias) return
    if (dias != null && (!Number.isInteger(dias) || dias < 1 || dias > 365)) { setErro('Prazo de entrega entre 1 e 365 dias (vazio tira o prazo).'); return }
    setErro(null)
    start(async () => {
      const r = await salvarLeadTimeFornecedor(f.id, dias)
      if ('error' in r) setErro(r.error)
      else router.refresh()
    })
  }

  return (
    <section className="space-y-3 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div>
        <h2 className="text-[15px] font-semibold text-text">Prazo de entrega dos fornecedores</h2>
        <p className="text-[12.5px] text-text-muted">Dias entre pedir e receber (lead time). A sugestão de compra usa o prazo do produto; sem ele, o do fornecedor da última nota; sem nenhum, 1 dia.</p>
      </div>
      <input aria-label="Buscar fornecedor" placeholder="Buscar fornecedor por nome ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} className={`${campo} max-w-[360px]`} />
      <ul className="divide-y divide-[var(--border)]">
        {vis.map((f) => (
          <li key={f.id} className="flex items-center gap-3 py-2 text-[13px]">
            <span className="min-w-0 flex-1 truncate text-text">{f.nome}{f.cnpj ? <span className="num text-text-muted"> · {f.cnpj}</span> : null}</span>
            {podeEditar ? (
              <label className="flex items-center gap-1.5 text-text-muted">
                <input type="number" min={1} max={365} defaultValue={f.dias ?? ''} disabled={pend} aria-label={`Prazo de ${f.nome} em dias`}
                  className="w-16 rounded-[var(--r-sm)] bg-surface-2 px-1 py-0.5 text-right text-[13px]" onBlur={(e) => salvar(f, e.target.value)} /> dias
              </label>
            ) : <span className="num text-text-muted">{f.dias != null ? `${f.dias} dias` : '—'}</span>}
          </li>
        ))}
      </ul>
      {fornecedores.length > vis.length && <p className="text-[12px] text-text-muted">Mostrando {vis.length} de {fornecedores.length}: use a busca.</p>}
      {erro && <p className="text-[13px] text-err">{erro}</p>}
    </section>
  )
}
