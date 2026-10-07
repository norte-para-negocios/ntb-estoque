'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { lancarCompraManual, type ProdutoBusca } from '@/lib/actions/compras-proprio'
import { campoCompra, SeletorProduto } from './SeletorProduto'

type Linha = { chave: number; produto: ProdutoBusca | null; quantidade: string; valor: string }
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const n = (s: string) => Number(s.replace(',', '.')) || 0

export function CompraManual({ locais }: { locais: { codigoLocal: number; descricao: string; padrao: boolean }[] }) {
  const router = useRouter()
  const [local, setLocal] = useState<number | ''>(locais.find((l) => l.padrao)?.codigoLocal ?? (locais.length === 1 ? locais[0].codigoLocal : ''))
  const [fornecedor, setFornecedor] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [numero, setNumero] = useState('')
  const [emissao, setEmissao] = useState(new Date().toISOString().slice(0, 10))
  const [frete, setFrete] = useState('')
  const [desconto, setDesconto] = useState('')
  const [obs, setObs] = useState('')
  const [linhas, setLinhas] = useState<Linha[]>([{ chave: 1, produto: null, quantidade: '', valor: '' }])
  const [pending, start] = useTransition()

  const subtotal = linhas.reduce((a, l) => a + n(l.quantidade) * n(l.valor), 0)
  const total = subtotal + n(frete) - n(desconto)
  const set = (chave: number, p: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...p } : l)))

  function lancar() {
    if (local === '') { toast.error('Escolha o local que recebe a mercadoria'); return }
    start(async () => {
      const r = await lancarCompraManual({
        codigoLocal: local, fornecedorNome: fornecedor, fornecedorCnpj: cnpj.replace(/\D/g, ''), numero, emissao, frete, desconto, obs,
        itens: linhas.filter((l) => l.produto).map((l) => ({ codigoProduto: l.produto!.codigoProduto, quantidade: l.quantidade, valorUnitario: l.valor, unidade: l.produto!.unidade, descricao: l.produto!.descricao })),
      })
      if ('error' in r) { toast.error('Não foi possível lançar', { description: r.error }); return }
      toast.success('Compra lançada no estoque')
      router.push(r.notaId ? `/nota-fiscal/${r.notaId}` : '/nota-fiscal')
    })
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-4 rounded-[var(--r-lg)] bg-surface p-4 u-card md:grid-cols-2" aria-label="Fornecedor">
        <div className="space-y-1.5"><Label>Fornecedor</Label><input className={campoCompra} value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="Ex.: Hortifruti do Zé" /></div>
        <div className="space-y-1.5"><Label>CNPJ (opcional)</Label><input inputMode="numeric" className={`${campoCompra} num`} value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" /></div>
        <div className="space-y-1.5"><Label>Número da nota (opcional)</Label><input className={campoCompra} value={numero} onChange={(e) => setNumero(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Data da compra</Label><input type="date" className={campoCompra} value={emissao} onChange={(e) => setEmissao(e.target.value)} /></div>
        <div className="space-y-1.5 md:col-span-2"><Label>Local que recebe a mercadoria</Label>
          <select className={campoCompra} value={local} onChange={(e) => setLocal(Number(e.target.value))}>
            <option value="" disabled>Escolha o local</option>{locais.map((l) => <option key={l.codigoLocal} value={l.codigoLocal}>{l.descricao}</option>)}
          </select></div>
      </section>

      <section aria-label="Itens" className="space-y-3">
        <h3 className="text-[15px] font-semibold text-text">Itens comprados</h3>
        <ul className="space-y-3">
          {linhas.map((l) => (
            <li key={l.chave} className="grid gap-3 rounded-[var(--r-lg)] bg-surface p-4 u-card md:grid-cols-[1fr_130px_150px_auto] md:items-end">
              <div className="space-y-1.5"><Label>Produto</Label><SeletorProduto value={l.produto} onChange={(p) => set(l.chave, { produto: p })} /></div>
              <div className="space-y-1.5"><Label>Quantidade{l.produto ? ` (${l.produto.unidade})` : ''}</Label><input inputMode="decimal" className={`${campoCompra} num`} value={l.quantidade} onChange={(e) => set(l.chave, { quantidade: e.target.value })} placeholder="0" /></div>
              <div className="space-y-1.5"><Label>Valor unitário</Label><input inputMode="decimal" className={`${campoCompra} num`} value={l.valor} onChange={(e) => set(l.chave, { valor: e.target.value })} placeholder="0,00" /></div>
              <button type="button" aria-label="Remover item" className="flex size-9 items-center justify-center self-end rounded-full text-text-muted hover:bg-surface-2 hover:text-err disabled:opacity-40" disabled={linhas.length === 1} onClick={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))}><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
        <button type="button" className={btnClass('outline')} onClick={() => setLinhas((ls) => [...ls, { chave: Math.max(...ls.map((x) => x.chave)) + 1, produto: null, quantidade: '', valor: '' }])}><Plus className="size-4" />Adicionar item</button>
      </section>

      <section className="grid gap-4 rounded-[var(--r-lg)] bg-surface p-4 u-card md:grid-cols-3" aria-label="Totais">
        <div className="space-y-1.5"><Label>Frete e despesas (opcional)</Label><input inputMode="decimal" className={`${campoCompra} num`} value={frete} onChange={(e) => setFrete(e.target.value)} placeholder="0,00" /></div>
        <div className="space-y-1.5"><Label>Desconto (opcional)</Label><input inputMode="decimal" className={`${campoCompra} num`} value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" /></div>
        <div className="text-right"><p className="text-[13px] text-text-muted">Total da compra</p><p className="num text-[24px] font-semibold tracking-[-0.02em]">{fmtBRL(total)}</p></div>
        <div className="space-y-1.5 md:col-span-3"><Label>Observação (opcional)</Label><input className={campoCompra} value={obs} onChange={(e) => setObs(e.target.value)} /></div>
        <div className="flex justify-end md:col-span-3">
          <button type="button" className={btnClass('primary')} onClick={lancar} disabled={pending || !linhas.some((l) => l.produto && n(l.quantidade) > 0)}>{pending && <Spinner />}Lançar compra no estoque</button>
        </div>
      </section>
    </div>
  )
}
