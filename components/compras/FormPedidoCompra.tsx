'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { SeletorProduto } from '@/components/compras-proprio/SeletorProduto'
import type { ProdutoBusca } from '@/lib/actions/compras-proprio'
import { buscarProdutos } from '@/lib/actions/produtos-search'
import { salvarPedidoCompra, type PedidoForm } from '@/lib/actions/pedido-compra'
import { parcelasDoPedido, parcelasDoTexto, textoDasParcelas, totaisPedido } from '@/lib/compras/pedido-puro'

const campo = 'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-2.5 py-1.5 text-sm text-text outline-none focus:ring-2 focus:ring-brand/40'
const rotulo = 'mb-1 block text-[11px] font-medium text-text-muted'
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const numBR = (s: string) => {
  const t = String(s).trim()
  // "1.234,56" e "4,5" (vírgula decimal) ou "4.5" (ponto decimal, sem vírgula)
  const v = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(v) ? v : NaN
}
const txt = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))

type Linha = { chave: string; produto: ProdutoBusca | null; unidade: string; fator: string; quantidade: string; preco: string; local: string; obs: string }

async function buscar(termo: string): Promise<ProdutoBusca[]> {
  const r = await buscarProdutos(termo)
  return r.map((p) => ({ codigoProduto: p.codigo_produto, codigo: p.codigo, descricao: p.descricao, unidade: p.unidade }))
}

export function FormPedidoCompra({ inicial, fornecedores, locais, compradores = [] }: {
  inicial?: (PedidoForm & { id: number; itensProduto: (ProdutoBusca | null)[] }) | null
  fornecedores: { id: number; nome: string; cnpj: string | null }[]
  locais: { codigo: number; descricao: string }[]
  /** compradores ativos (240); vazio = o campo não aparece */
  compradores?: { id: number; nome: string }[]
}) {
  const router = useRouter()
  const [pend, start] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const [fornId, setFornId] = useState<string>(inicial?.fornecedorId ? String(inicial.fornecedorId) : '')
  const [fornNome, setFornNome] = useState(inicial?.fornecedorId ? '' : inicial?.fornecedorNome ?? '')
  const [previsao, setPrevisao] = useState(inicial?.previsaoEntrega ?? '')
  const [numFor, setNumFor] = useState(inicial?.numeroFornecedor ?? '')
  const [contato, setContato] = useState(inicial?.contato ?? '')
  const [frete, setFrete] = useState(txt(inicial?.frete))
  const [outras, setOutras] = useState(txt(inicial?.outrasDespesas))
  const [cond, setCond] = useState(textoDasParcelas(inicial?.parcelas ?? []))
  const [obs, setObs] = useState(inicial?.obs ?? '')
  const [obsInt, setObsInt] = useState(inicial?.obsInterna ?? '')
  const [comprador, setComprador] = useState(inicial?.compradorId ? String(inicial.compradorId) : '')
  const [chave] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now())))
  const nova = (): Linha => ({ chave: Math.random().toString(36).slice(2), produto: null, unidade: '', fator: '1', quantidade: '', preco: '', local: '', obs: '' })
  const [linhas, setLinhas] = useState<Linha[]>(() => inicial?.itens.length ? inicial.itens.map((i, k) => ({
    chave: `i${k}`, produto: inicial.itensProduto[k] ?? null, unidade: i.unidade ?? '', fator: txt(i.fator ?? 1), quantidade: txt(i.quantidade),
    preco: txt(i.precoUnitario), local: i.codigoLocal ? String(i.codigoLocal) : '', obs: i.obs ?? '',
  })) : [nova()])
  const alterar = (k: string, d: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l.chave === k ? { ...l, ...d } : l)))

  const parcelas = parcelasDoTexto(cond)
  const tot = useMemo(() => totaisPedido(linhas.map((l) => ({ quantidade: numBR(l.quantidade) || 0, precoUnitario: numBR(l.preco) || 0 })), numBR(frete) || 0, numBR(outras) || 0), [linhas, frete, outras])

  function salvar() {
    setErro(null)
    if (parcelas == null) { setErro('Condição de pagamento: dias separados por barra, ex.: 30/60/90.'); return }
    const forn = fornecedores.find((f) => String(f.id) === fornId)
    const usadas = linhas.filter((l) => l.produto)
    const form: PedidoForm = {
      id: inicial?.id ?? null, chaveIdempotencia: inicial?.id ? null : chave,
      fornecedorId: forn?.id ?? null, fornecedorNome: forn?.nome ?? fornNome, fornecedorCnpj: forn?.cnpj ?? null,
      previsaoEntrega: previsao || null, frete: numBR(frete) || 0, outrasDespesas: numBR(outras) || 0, parcelas,
      numeroFornecedor: numFor || null, contato: contato || null, obs: obs || null, obsInterna: obsInt || null,
      compradorId: comprador ? Number(comprador) : null,
      itens: usadas.map((l) => ({
        codigoProduto: l.produto!.codigoProduto, descricao: l.produto!.descricao, unidade: l.unidade || l.produto!.unidade,
        fator: numBR(l.fator) || 1, quantidade: numBR(l.quantidade), precoUnitario: numBR(l.preco) || 0,
        codigoLocal: l.local ? Number(l.local) : null, obs: l.obs || null,
      })),
    }
    start(async () => {
      const r = await salvarPedidoCompra(form)
      if ('error' in r) setErro(r.error)
      else router.push(`/pedido-compra/${r.id}`)
    })
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-1">
          <label className={rotulo} htmlFor="pc-f">Fornecedor</label>
          <select id="pc-f" value={fornId} onChange={(e) => setFornId(e.target.value)} className={campo}>
            <option value="">Outro (digitar o nome)</option>
            {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
          {!fornId && <input aria-label="Nome do fornecedor" placeholder="Nome do fornecedor" value={fornNome} onChange={(e) => setFornNome(e.target.value)} className={`${campo} mt-2`} />}
        </div>
        <div><label className={rotulo} htmlFor="pc-p">Previsão de entrega</label><input id="pc-p" type="date" value={previsao} onChange={(e) => setPrevisao(e.target.value)} className={campo} /></div>
        <div><label className={rotulo} htmlFor="pc-n">Nº do pedido no fornecedor</label><input id="pc-n" value={numFor} onChange={(e) => setNumFor(e.target.value)} className={campo} /></div>
        {(compradores.length > 0 || comprador) && (
          <div><label className={rotulo} htmlFor="pc-comp">Comprador</label>
            <select id="pc-comp" value={comprador} onChange={(e) => setComprador(e.target.value)} className={campo}>
              <option value="">Sem comprador</option>
              {compradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              {comprador && !compradores.some((c) => String(c.id) === comprador) && <option value={comprador}>Comprador inativo (mantido)</option>}
            </select></div>
        )}
        <div><label className={rotulo} htmlFor="pc-c">Contato no fornecedor</label><input id="pc-c" value={contato} onChange={(e) => setContato(e.target.value)} className={campo} /></div>
        <div><label className={rotulo} htmlFor="pc-fr">Frete (R$)</label><input id="pc-fr" inputMode="decimal" value={frete} onChange={(e) => setFrete(e.target.value)} className={campo} /></div>
        <div><label className={rotulo} htmlFor="pc-o">Outras despesas (R$)</label><input id="pc-o" inputMode="decimal" value={outras} onChange={(e) => setOutras(e.target.value)} className={campo} /></div>
        <div className="sm:col-span-2">
          <label className={rotulo} htmlFor="pc-cond">Parcelas (dias depois da entrega, ex.: 30/60/90; vazio = à vista)</label>
          <input id="pc-cond" value={cond} onChange={(e) => setCond(e.target.value)} className={campo} />
          {parcelas == null ? <p className="mt-1 text-[12px] text-err">Use números de dias separados por barra.</p> : parcelas.length > 0 && (
            <p className="mt-1 text-[12px] text-text-muted">
              {parcelasDoPedido(parcelas, tot.total, previsao || null).map((p) => `${p.numero}ª ${brl(p.valor)}${p.vencimento ? ` em ${p.vencimento.split('-').reverse().join('/')}` : ` (+${p.dias} dias)`}`).join(' · ')}
            </p>
          )}
        </div>
      </section>

      <section className="space-y-2 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
        <h2 className="text-[15px] font-semibold text-text">Itens</h2>
        {linhas.map((l, i) => (
          <div key={l.chave} className="grid gap-2 border-t border-border/60 pt-2 sm:grid-cols-2 lg:grid-cols-[2.2fr_0.7fr_0.7fr_0.9fr_0.9fr_1.1fr_auto]">
            <div>
              <span className={rotulo}>Produto {i + 1}</span>
              <SeletorProduto value={l.produto} buscar={buscar} onChange={(p) => alterar(l.chave, { produto: p, unidade: l.unidade || p?.unidade || '' })} />
            </div>
            <div><label className={rotulo} htmlFor={`u-${l.chave}`}>Unidade</label><input id={`u-${l.chave}`} value={l.unidade} onChange={(e) => alterar(l.chave, { unidade: e.target.value.toUpperCase().slice(0, 6) })} className={campo} /></div>
            <div><label className={rotulo} htmlFor={`f-${l.chave}`} title="Quantas unidades de estoque vêm em 1 unidade do pedido (ex.: caixa com 12)">Fator</label>
              <input id={`f-${l.chave}`} inputMode="decimal" value={l.fator} onChange={(e) => alterar(l.chave, { fator: e.target.value })} className={campo} /></div>
            <div><label className={rotulo} htmlFor={`q-${l.chave}`}>Quantidade</label><input id={`q-${l.chave}`} inputMode="decimal" value={l.quantidade} onChange={(e) => alterar(l.chave, { quantidade: e.target.value })} className={campo} /></div>
            <div><label className={rotulo} htmlFor={`p-${l.chave}`}>Preço combinado</label><input id={`p-${l.chave}`} inputMode="decimal" value={l.preco} onChange={(e) => alterar(l.chave, { preco: e.target.value })} className={campo} /></div>
            <div><label className={rotulo} htmlFor={`l-${l.chave}`}>Local</label>
              <select id={`l-${l.chave}`} value={l.local} onChange={(e) => alterar(l.chave, { local: e.target.value })} className={campo}>
                <option value="">Padrão da nota</option>
                {locais.map((x) => <option key={x.codigo} value={x.codigo}>{x.descricao}</option>)}
              </select></div>
            <div className="flex items-end">
              <button type="button" aria-label="Tirar item" className={btnClass('outline')} onClick={() => setLinhas((ls) => (ls.length > 1 ? ls.filter((x) => x.chave !== l.chave) : [nova()]))}><Trash2 className="size-4" /></button>
            </div>
          </div>
        ))}
        <button type="button" className={btnClass('outline')} onClick={() => setLinhas((ls) => [...ls, nova()])}><Plus className="size-4" /> Item</button>
        <p className="text-right text-[13px] text-text-muted">Mercadorias <span className="num text-text">{brl(tot.mercadorias)}</span> · Total com frete e despesas <span className="num text-[15px] font-semibold text-text">{brl(tot.total)}</span></p>
      </section>

      <section className="grid gap-3 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:grid-cols-2">
        <div><label className={rotulo} htmlFor="pc-obs">Observações (saem no pedido enviado ao fornecedor)</label><textarea id="pc-obs" rows={3} value={obs} onChange={(e) => setObs(e.target.value)} className={campo} /></div>
        <div><label className={rotulo} htmlFor="pc-oi">Observações internas (só aqui)</label><textarea id="pc-oi" rows={3} value={obsInt} onChange={(e) => setObsInt(e.target.value)} className={campo} /></div>
      </section>

      {erro && <p className="text-[13px] text-err">{erro}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnClass('primary')} disabled={pend} onClick={salvar}>{pend ? 'Salvando…' : inicial?.id ? 'Salvar rascunho' : 'Criar rascunho'}</button>
        <button type="button" className={btnClass('outline')} onClick={() => router.back()}>Voltar</button>
      </div>
    </div>
  )
}
