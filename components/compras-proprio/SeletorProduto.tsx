'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, PackagePlus, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { buscarProdutosCompra, criarProdutoRapido, type ProdutoBusca } from '@/lib/actions/compras-proprio'

export const campoCompra =
  'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-sm text-text outline-none max-sm:text-base focus:ring-2 focus:ring-brand/40'

// Tipo do item (SPED) -> faixa do código. Bar x cozinha NÃO está no código: fica em família e local.
const TIPOS = [
  { value: '00', label: 'Revenda (90xxx): bebida ou item vendido como comprado' },
  { value: '01', label: 'Matéria-prima (80xxx): insumo de cozinha ou bar' },
  { value: '03', label: 'Intermediário (70xxx): molho, calda, preparo' },
  { value: '07', label: 'Uso e consumo (60xxx): limpeza, descartáveis' },
  { value: '02', label: 'Embalagem (50xxx)' },
]
const UNIDADES = ['UN', 'KG', 'G', 'L', 'ML', 'CX', 'PCT', 'FD']

export function SeletorProduto({
  value, onChange, sugestaoDescricao, sugestaoUnidade, id, placeholder = 'Buscar produto por nome ou código',
}: {
  value: ProdutoBusca | null
  onChange: (p: ProdutoBusca | null) => void
  sugestaoDescricao?: string
  sugestaoUnidade?: string
  id?: string
  placeholder?: string
}) {
  const [q, setQ] = useState('')
  const [achados, setAchados] = useState<ProdutoBusca[]>([])
  const [carregando, setCarregando] = useState(false)
  const [aberto, setAberto] = useState(false)
  const [criar, setCriar] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (q.trim().length < 2) { setAchados([]); return }
    setCarregando(true)
    const t = setTimeout(async () => {
      setAchados(await buscarProdutosCompra(q))
      setCarregando(false)
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    function fora(e: MouseEvent) { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false) }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-[var(--r-md)] bg-surface-2 px-3 py-2 text-sm">
        <span className="min-w-0 truncate"><span className="num text-text-muted">{value.codigo}</span> · {value.descricao} <span className="text-text-muted">({value.unidade})</span></span>
        <button type="button" onClick={() => onChange(null)} aria-label="Trocar produto" className="shrink-0 rounded-full p-1 text-text-muted hover:bg-[var(--border)] hover:text-text"><X className="size-4" /></button>
      </div>
    )
  }

  return (
    <div ref={caixa} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <input id={id} className={`${campoCompra} pl-9`} placeholder={placeholder} value={q} onChange={(e) => { setQ(e.target.value); setAberto(true) }} onFocus={() => setAberto(true)} autoComplete="off" />
        {carregando && <span className="absolute right-3 top-1/2 -translate-y-1/2"><Spinner /></span>}
      </div>
      {aberto && (q.trim().length >= 2 || sugestaoDescricao) && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-[var(--r-md)] bg-surface p-1 shadow-lg ring-1 ring-[var(--border)]">
          {achados.map((p) => (
            <button key={p.codigoProduto} type="button" className="flex w-full items-center justify-between gap-2 rounded-[var(--r-sm)] px-3 py-2 text-left text-sm hover:bg-surface-2"
              onClick={() => { onChange(p); setAberto(false); setQ('') }}>
              <span className="min-w-0 truncate">{p.descricao}</span>
              <span className="num shrink-0 text-[12px] text-text-muted">{p.codigo} · {p.unidade}</span>
            </button>
          ))}
          {!carregando && q.trim().length >= 2 && !achados.length && <p className="px-3 py-2 text-[13px] text-text-muted">Nenhum produto com esse nome.</p>}
          <button type="button" className="flex w-full items-center gap-2 rounded-[var(--r-sm)] px-3 py-2 text-left text-sm font-medium text-brand hover:bg-surface-2" onClick={() => { setCriar(true); setAberto(false) }}>
            <PackagePlus className="size-4" /> Criar produto novo
          </button>
        </div>
      )}
      <CriarProdutoRapido aberto={criar} onFechar={() => setCriar(false)} descricaoInicial={sugestaoDescricao ?? q} unidadeInicial={sugestaoUnidade}
        onCriado={(p) => { onChange(p); setCriar(false); setQ('') }} />
    </div>
  )
}

function CriarProdutoRapido({ aberto, onFechar, descricaoInicial, unidadeInicial, onCriado }: {
  aberto: boolean; onFechar: () => void; descricaoInicial: string; unidadeInicial?: string; onCriado: (p: ProdutoBusca) => void
}) {
  const [descricao, setDescricao] = useState(descricaoInicial)
  const [unidade, setUnidade] = useState(UNIDADES.includes((unidadeInicial ?? '').toUpperCase()) ? (unidadeInicial ?? '').toUpperCase() : 'UN')
  const [tipo, setTipo] = useState('01')
  const [salvando, setSalvando] = useState(false)
  useEffect(() => { if (aberto) setDescricao(descricaoInicial) }, [aberto, descricaoInicial])

  async function salvar() {
    setSalvando(true)
    const r = await criarProdutoRapido({ descricao, unidade, tipoItem: tipo })
    setSalvando(false)
    if ('error' in r) { toast.error('Não foi possível criar o produto', { description: r.error }); return }
    toast.success(`Produto ${r.produto.codigo} criado`)
    onCriado(r.produto)
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar() }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Criar produto</DialogTitle><p className="text-[13px] text-text-muted">O código sai sozinho, pela faixa do tipo, e nunca muda.</p></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label>Nome</Label><input className={campoCompra} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Limão tahiti" /></div>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div className="space-y-2"><Label>Tipo</Label>
              <select className={campoCompra} value={tipo} onChange={(e) => setTipo(e.target.value)}>{TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
            <div className="space-y-2"><Label>Unidade de estoque</Label>
              <select className={campoCompra} value={unidade} onChange={(e) => setUnidade(e.target.value)}>{UNIDADES.map((u) => <option key={u}>{u}</option>)}</select></div>
          </div>
          <p className="text-[12px] text-text-muted">A unidade de estoque é a menor medida usada nas receitas e nas vendas (g, ml, un). Ela não muda depois do primeiro movimento.</p>
        </div>
        <DialogFooter>
          <button type="button" className={btnClass('primary')} onClick={salvar} disabled={salvando || descricao.trim().length < 2}>{salvando ? <Spinner /> : <Check className="size-4" />}Criar e usar</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
