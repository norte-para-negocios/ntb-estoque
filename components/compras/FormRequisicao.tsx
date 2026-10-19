'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { SeletorProduto } from '@/components/compras-proprio/SeletorProduto'
import type { ProdutoBusca } from '@/lib/actions/compras-proprio'
import { buscarProdutos } from '@/lib/actions/produtos-search'
import { salvarRequisicao, type RequisicaoForm } from '@/lib/actions/requisicao-compra'

const campo = 'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-2.5 py-1.5 text-sm text-text outline-none focus:ring-2 focus:ring-brand/40'
const rotulo = 'mb-1 block text-[11px] font-medium text-text-muted'
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const numBR = (s: string) => {
  const t = String(s).trim()
  const v = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(v) ? v : NaN
}
const txt = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))

type Linha = { chave: string; produto: ProdutoBusca | null; unidade: string; fator: string; quantidade: string; preco: string; fornecedor: string; fornecedorNome: string }

async function buscar(termo: string): Promise<ProdutoBusca[]> {
  const r = await buscarProdutos(termo)
  return r.map((p) => ({ codigoProduto: p.codigo_produto, codigo: p.codigo, descricao: p.descricao, unidade: p.unidade }))
}

export type InicialRequisicao = RequisicaoForm & { id: number; itensProduto: (ProdutoBusca | null)[] }

export function FormRequisicao({ inicial, fornecedores, compradores }: {
  inicial?: InicialRequisicao | null
  fornecedores: { id: number; nome: string; cnpj: string | null }[]
  compradores: { id: number; nome: string }[]
}) {
  const router = useRouter()
  const [pend, start] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const [entrega, setEntrega] = useState(inicial?.sugestaoEntrega ?? '')
  const [comprador, setComprador] = useState(inicial?.compradorId ? String(inicial.compradorId) : '')
  const [obs, setObs] = useState(inicial?.obs ?? '')
  const [obsInt, setObsInt] = useState(inicial?.obsInterna ?? '')
  const [chave] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`))
  const nova = (): Linha => ({ chave: Math.random().toString(36).slice(2), produto: null, unidade: '', fator: '1', quantidade: '', preco: '', fornecedor: '', fornecedorNome: '' })
  const [linhas, setLinhas] = useState<Linha[]>(() => inicial?.itens.length ? inicial.itens.map((i, k) => ({
    chave: `i${k}`, produto: inicial.itensProduto[k] ?? null, unidade: i.unidade ?? '', fator: txt(i.fator ?? 1), quantidade: txt(i.quantidade),
    preco: txt(i.precoSugerido), fornecedor: i.fornecedorId ? String(i.fornecedorId) : '', fornecedorNome: i.fornecedorId ? '' : i.fornecedorNome ?? '',
  })) : [nova()])
  const alterar = (k: string, d: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l.chave === k ? { ...l, ...d } : l)))
  const total = useMemo(() => Math.round(linhas.reduce((a, l) => a + (numBR(l.quantidade) || 0) * (numBR(l.preco) || 0), 0) * 100) / 100, [linhas])

  function salvar() {
    setErro(null)
    const form: RequisicaoForm = {
      id: inicial?.id ?? null, chaveIdempotencia: inicial?.id ? null : chave, sugestaoEntrega: entrega || null,
      compradorId: comprador ? Number(comprador) : null, obs: obs || null, obsInterna: obsInt || null,
      itens: linhas.filter((l) => l.produto).map((l) => {
        const f = fornecedores.find((x) => String(x.id) === l.fornecedor)
        return {
          codigoProduto: l.produto!.codigoProduto, descricao: l.produto!.descricao, unidade: l.unidade || l.produto!.unidade, fator: numBR(l.fator) || 1,
          quantidade: numBR(l.quantidade), precoSugerido: numBR(l.preco) || 0,
          fornecedorId: f?.id ?? null, fornecedorNome: f?.nome ?? (l.fornecedorNome.trim() || null), fornecedorCnpj: f?.cnpj ?? null,
        }
      }),
    }
    start(async () => {
      const r = await salvarRequisicao(form)
      if ('error' in r) setErro(r.error)
      else router.push(`/requisicao-compra/${r.id}`)
    })
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:grid-cols-2 lg:grid-cols-3">
        <div><label className={rotulo} htmlFor="rq-e">Sugestão de entrega</label><input id="rq-e" type="date" value={entrega} onChange={(e) => setEntrega(e.target.value)} className={campo} /></div>
        {(compradores.length > 0 || comprador) && (
          <div><label className={rotulo} htmlFor="rq-c">Comprador</label>
            <select id="rq-c" value={comprador} onChange={(e) => setComprador(e.target.value)} className={campo}>
              <option value="">Sem comprador</option>
              {compradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              {comprador && !compradores.some((c) => String(c.id) === comprador) && <option value={comprador}>Comprador inativo (mantido)</option>}
            </select></div>
        )}
      </section>

      <section className="space-y-2 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
        <h2 className="text-[15px] font-semibold text-text">Itens</h2>
        {linhas.map((l, i) => (
          <div key={l.chave} className="grid gap-2 border-t border-border/60 pt-2 sm:grid-cols-2 lg:grid-cols-[2.2fr_0.6fr_0.6fr_0.8fr_0.8fr_1.6fr_auto]">
            <div>
              <span className={rotulo}>Produto {i + 1}</span>
              <SeletorProduto value={l.produto} buscar={buscar} onChange={(p) => alterar(l.chave, { produto: p, unidade: l.unidade || p?.unidade || '' })} />
            </div>
            <div><label className={rotulo} htmlFor={`u-${l.chave}`}>Unidade</label><input id={`u-${l.chave}`} value={l.unidade} onChange={(e) => alterar(l.chave, { unidade: e.target.value.toUpperCase().slice(0, 6) })} className={campo} /></div>
            <div><label className={rotulo} htmlFor={`f-${l.chave}`} title="Quantas unidades de estoque vêm em 1 unidade pedida (ex.: caixa com 12)">Fator</label>
              <input id={`f-${l.chave}`} inputMode="decimal" value={l.fator} onChange={(e) => alterar(l.chave, { fator: e.target.value })} className={campo} /></div>
            <div><label className={rotulo} htmlFor={`q-${l.chave}`}>Quantidade</label><input id={`q-${l.chave}`} inputMode="decimal" value={l.quantidade} onChange={(e) => alterar(l.chave, { quantidade: e.target.value })} className={campo} /></div>
            <div><label className={rotulo} htmlFor={`p-${l.chave}`}>Preço sugerido</label><input id={`p-${l.chave}`} inputMode="decimal" value={l.preco} onChange={(e) => alterar(l.chave, { preco: e.target.value })} className={campo} /></div>
            <div><label className={rotulo} htmlFor={`fo-${l.chave}`}>Fornecedor sugerido</label>
              <select id={`fo-${l.chave}`} value={l.fornecedor} onChange={(e) => alterar(l.chave, { fornecedor: e.target.value })} className={campo}>
                <option value="">A definir / digitar</option>
                {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
              {!l.fornecedor && <input aria-label="Nome do fornecedor" placeholder="Nome (opcional)" value={l.fornecedorNome} onChange={(e) => alterar(l.chave, { fornecedorNome: e.target.value })} className={`${campo} mt-1`} />}
            </div>
            <div className="flex items-end">
              <button type="button" aria-label="Tirar item" className={btnClass('outline')} onClick={() => setLinhas((ls) => (ls.length > 1 ? ls.filter((x) => x.chave !== l.chave) : [nova()]))}><Trash2 className="size-4" /></button>
            </div>
          </div>
        ))}
        <button type="button" className={btnClass('outline')} onClick={() => setLinhas((ls) => [...ls, nova()])}><Plus className="size-4" /> Item</button>
        <p className="text-right text-[13px] text-text-muted">Total pelo preço sugerido <span className="num text-[15px] font-semibold text-text">{brl(total)}</span></p>
      </section>

      <section className="grid gap-3 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:grid-cols-2">
        <div><label className={rotulo} htmlFor="rq-obs">Observações (vão para a cotação e o pedido)</label><textarea id="rq-obs" rows={3} value={obs} onChange={(e) => setObs(e.target.value)} className={campo} /></div>
        <div><label className={rotulo} htmlFor="rq-oi">Observações internas</label><textarea id="rq-oi" rows={3} value={obsInt} onChange={(e) => setObsInt(e.target.value)} className={campo} /></div>
      </section>

      {erro && <p className="text-[13px] text-err">{erro}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnClass('primary')} disabled={pend} onClick={salvar}>{pend ? 'Salvando…' : inicial?.id ? 'Salvar requisição' : 'Criar requisição'}</button>
        <button type="button" className={btnClass('outline')} onClick={() => router.back()}>Voltar</button>
      </div>
    </div>
  )
}
