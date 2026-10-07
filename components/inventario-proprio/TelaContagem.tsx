'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { Check, EyeOff, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { buscarProdutosParaContagem, contarItem, type ProdutoBusca } from '@/lib/actions/inventario-proprio'
import { lerQuantidade, progressoContagem } from '@/lib/estoque/inventario-regras'

export type ItemTela = { codigoProduto: number; codigo: string; descricao: string; unidade: string; contado: number | null }

type Estado = 'salvo' | 'salvando' | 'erro' | 'pendente'
type Filtro = 'todos' | 'faltam' | 'contados'

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Tela de contagem CEGA, pensada para o celular na mão de quem está na prateleira:
 * entrada grande, Enter pula para o próximo item, cada valor é salvo ao sair do campo.
 * Nunca mostra (nem recebe) o saldo do sistema.
 */
export function TelaContagem({
  inventarioId, local, descricao, itens: inicial, podeRevisar,
}: { inventarioId: number; local: string; descricao: string | null; itens: ItemTela[]; podeRevisar: boolean }) {
  const [itens, setItens] = useState<ItemTela[]>(inicial)
  const [valores, setValores] = useState<Record<number, string>>(() => Object.fromEntries(inicial.map((i) => [i.codigoProduto, i.contado == null ? '' : String(i.contado).replace('.', ',')])))
  const [estado, setEstado] = useState<Record<number, Estado>>(() => Object.fromEntries(inicial.map((i) => [i.codigoProduto, i.contado == null ? 'pendente' : 'salvo'])))
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const refs = useRef<Record<number, HTMLInputElement | null>>({})

  const contadosAgora = itens.map((i) => ({ contado: estado[i.codigoProduto] === 'salvo' ? lerQuantidade(valores[i.codigoProduto]) : null }))
  const prog = progressoContagem(contadosAgora)

  const visiveis = useMemo(() => {
    const q = semAcento(busca.trim())
    return itens.filter((i) => {
      const feito = estado[i.codigoProduto] === 'salvo'
      if (filtro === 'faltam' && feito) return false
      if (filtro === 'contados' && !feito) return false
      return !q || semAcento(i.descricao).includes(q) || semAcento(i.codigo).includes(q)
    })
  }, [itens, busca, filtro, estado])

  async function salvar(item: ItemTela) {
    const texto = valores[item.codigoProduto] ?? ''
    if (texto.trim() === '') return
    if (lerQuantidade(texto) == null) { setEstado((s) => ({ ...s, [item.codigoProduto]: 'erro' })); toast.error('Quantidade inválida', { description: item.descricao }); return }
    setEstado((s) => ({ ...s, [item.codigoProduto]: 'salvando' }))
    const r = await contarItem({ inventarioId, codigoProduto: item.codigoProduto, contado: texto })
    if ('error' in r) { setEstado((s) => ({ ...s, [item.codigoProduto]: 'erro' })); toast.error('Não salvou', { description: r.error }); return }
    setEstado((s) => ({ ...s, [item.codigoProduto]: 'salvo' }))
  }

  function proximo(item: ItemTela) {
    const i = visiveis.findIndex((x) => x.codigoProduto === item.codigoProduto)
    const prox = visiveis[i + 1]
    if (prox) refs.current[prox.codigoProduto]?.focus()
    else (document.activeElement as HTMLElement | null)?.blur()
  }

  function adicionar(p: ProdutoBusca) {
    if (itens.some((i) => i.codigoProduto === p.codigoProduto)) { toast.message('Esse item já está na lista'); refs.current[p.codigoProduto]?.focus(); return }
    setItens((l) => [{ codigoProduto: p.codigoProduto, codigo: p.codigo, descricao: p.descricao, unidade: p.unidade, contado: null }, ...l])
    setEstado((s) => ({ ...s, [p.codigoProduto]: 'pendente' }))
    setTimeout(() => refs.current[p.codigoProduto]?.focus(), 80)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3 pb-24">
      {/* Cabeçalho fixo com progresso */}
      <div className="sticky top-0 z-10 -mx-1 space-y-2 bg-bg/90 px-1 pb-2 pt-1 backdrop-blur">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-text-muted">{local}{descricao ? ` · ${descricao}` : ''}</div>
            <div className="text-[22px] font-bold leading-tight tracking-[-0.02em] text-text"><span className="num">{prog.contados}</span> <span className="text-text-muted">de</span> <span className="num">{prog.total}</span> contados</div>
          </div>
          <div className="num text-[26px] font-semibold text-brand">{prog.pct}%</div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={prog.pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-brand u-motion" style={{ width: `${prog.pct}%` }} />
        </div>
        <div className="flex items-center gap-2 text-[12px] text-text-muted"><EyeOff className="size-3.5" /> Contagem cega: o saldo do sistema fica escondido até o fechamento.</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar na lista" aria-label="Buscar na lista"
            className="w-full rounded-full border-0 bg-surface-2 py-2 pl-9 pr-3 text-base text-text outline-none focus:ring-2 focus:ring-brand/40" />
        </div>
        <div className="inline-flex rounded-full bg-surface-2 p-0.5 text-[13px] font-medium" role="group" aria-label="Filtro">
          {([['todos', 'Todos'], ['faltam', 'Faltam'], ['contados', 'Contados']] as const).map(([v, r]) => (
            <button key={v} type="button" onClick={() => setFiltro(v)} className={`rounded-full px-3 py-1.5 u-motion ${filtro === v ? 'bg-surface text-text shadow-sm' : 'text-text-muted'}`}>{r}</button>
          ))}
        </div>
      </div>

      <ul className="space-y-2">
        {visiveis.map((i) => {
          const st = estado[i.codigoProduto] ?? 'pendente'
          return (
            <li key={i.codigoProduto} className={`flex items-center gap-3 rounded-[var(--r-lg)] bg-surface p-3 u-card ${st === 'salvo' ? 'ring-1 ring-ok/30' : st === 'erro' ? 'ring-1 ring-err/50' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium text-text">{i.descricao}</div>
                <div className="num text-[12px] text-text-muted">{i.codigo} · {i.unidade}</div>
              </div>
              <div className="relative w-[7.5rem] shrink-0">
                <input
                  ref={(el) => { refs.current[i.codigoProduto] = el }}
                  inputMode="decimal" enterKeyHint="next" autoComplete="off" aria-label={`Quantidade contada de ${i.descricao}`}
                  value={valores[i.codigoProduto] ?? ''} placeholder="—"
                  onChange={(e) => { setValores((v) => ({ ...v, [i.codigoProduto]: e.target.value })); setEstado((s) => ({ ...s, [i.codigoProduto]: 'pendente' })) }}
                  onBlur={() => salvar(i)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void salvar(i); proximo(i) } }}
                  className="num h-12 w-full rounded-[var(--r-md)] border-0 bg-surface-2 pl-3 pr-9 text-right text-[20px] font-semibold text-text outline-none focus:ring-2 focus:ring-brand/50"
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
                  {st === 'salvando' ? <Spinner /> : st === 'salvo' ? <Check className="size-4 text-ok" strokeWidth={3} /> : null}
                </span>
              </div>
            </li>
          )
        })}
        {visiveis.length === 0 && <li className="px-4 py-10 text-center text-[14px] text-text-muted">{itens.length ? 'Nada neste filtro.' : 'Nenhum item para contar. Use “Achei um item” para incluir.'}</li>}
      </ul>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--border)] bg-surface/95 p-3 backdrop-blur max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))] md:left-[var(--sidebar-w,0px)]">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <AdicionarItem onEscolher={adicionar} />
          {podeRevisar
            ? <Link href={`/inventario-proprio/${inventarioId}/revisar`} className={`${btnClass('primary')} ml-auto`}>Revisar e fechar</Link>
            : <Link href="/inventario-proprio" className={`${btnClass('outline')} ml-auto`}>Concluir contagem</Link>}
        </div>
      </div>
    </div>
  )
}

function AdicionarItem({ onEscolher }: { onEscolher: (p: ProdutoBusca) => void }) {
  const [open, setOpen] = useState(false)
  const [termo, setTermo] = useState('')
  const [lista, setLista] = useState<ProdutoBusca[]>([])
  const [pending, start] = useTransition()
  function buscar(t: string) {
    setTermo(t)
    if (t.trim().length < 2) { setLista([]); return }
    start(async () => { const r = await buscarProdutosParaContagem(t); if (Array.isArray(r)) setLista(r) })
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<button type="button" className={btnClass('outline')}><Plus className="size-4" />Achei um item</button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Item que não estava na lista</DialogTitle>
          <p className="text-[13px] text-text-muted">Busque pelo nome ou código. O saldo do sistema não aparece.</p>
        </DialogHeader>
        <input autoFocus value={termo} onChange={(e) => buscar(e.target.value)} placeholder="Nome ou código do produto"
          className="w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-base text-text outline-none focus:ring-2 focus:ring-brand/40" />
        <ul className="max-h-72 space-y-1 overflow-auto">
          {pending && <li className="flex justify-center py-3"><Spinner /></li>}
          {lista.map((p) => (
            <li key={p.codigoProduto}>
              <button type="button" onClick={() => { onEscolher(p); setOpen(false); setTermo(''); setLista([]) }}
                className="flex w-full items-center justify-between gap-3 rounded-[var(--r-md)] px-3 py-2 text-left hover:bg-surface-2">
                <span className="min-w-0 truncate text-[14px] text-text">{p.descricao}</span>
                <span className="num shrink-0 text-[12px] text-text-muted">{p.codigo} · {p.unidade}</span>
              </button>
            </li>
          ))}
          {!pending && termo.trim().length >= 2 && lista.length === 0 && <li className="px-3 py-4 text-center text-[13px] text-text-muted">Nenhum produto encontrado.</li>}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

export { fmt as formatarQuantidade }
