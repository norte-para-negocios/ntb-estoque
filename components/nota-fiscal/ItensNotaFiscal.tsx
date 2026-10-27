'use client'

import { useState } from 'react'
import { Printer, MoreHorizontal, FileText } from 'lucide-react'
import Link from 'next/link'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { btnClass } from '@/components/ui-kit/Button'
import { QuantidadeInput } from '@/components/nota-fiscal/QuantidadeInput'
import { CategoriaContabilSelect } from '@/components/nota-fiscal/CategoriaContabilSelect'
import { DialogImprimirEtiqueta } from '@/components/etiqueta/DialogImprimirEtiqueta'
import { impostosItem } from '@/lib/nf-impostos-item'
import { categoriaDoItemOmie, entraNoEstoque, totalDoItem } from '@/lib/nota-fiscal/tela-nota'

export type ItemNF = {
  id: number
  c_codigo_produto: string | null
  c_descricao_produto: string | null
  n_id_produto?: number | null
  c_cfop: string | null
  n_qtde_nfe: number | null
  c_unidade_nfe: string | null
  n_preco_unit: number | null
  v_total_item: number | null
  quantidade: number | null
  categoria_contabil_id: number | null
  full_object?: unknown
}

/** Fase B (só leitura): o que o Omie manda em full_object.itensAjustes (a loja própria recebe pela projeção, migration 185). */
function ajustesDoItem(fullObject: unknown): { cfopEntrada: string | null; local: number | null; geraConta: boolean | null; movimenta: boolean | null } {
  const a = (fullObject as { itensAjustes?: { cCFOPEntrada?: string; codigo_local_estoque?: number | string; cNaoGerarFinanceiro?: string; cNaoGerarMovEstoque?: string } } | null)?.itensAjustes
  if (!a) return { cfopEntrada: null, local: null, geraConta: null, movimenta: null }
  return {
    cfopEntrada: a.cCFOPEntrada || null,
    local: a.codigo_local_estoque != null && a.codigo_local_estoque !== '' ? Number(a.codigo_local_estoque) : null,
    geraConta: a.cNaoGerarFinanceiro == null ? null : a.cNaoGerarFinanceiro !== 'S',
    movimenta: a.cNaoGerarMovEstoque == null ? null : a.cNaoGerarMovEstoque !== 'S',
  }
}
const simNao = (v: boolean | null) => (v == null ? '-' : v ? 'Sim' : 'Não')
const brl = (n: number | null) => (n == null ? '-' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const qtd = (n: number | string | null) => (n == null ? '-' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 }))

/**
 * Itens da nota (27/10/2026): uma linha por item com o que importa (produto, quantidade, custo, total); o resto
 * (CFOP, local, impostos, classificação, etiqueta) fica no "⋯" de cada linha.
 */
export function ItensNotaFiscal({
  notaId,
  itens,
  categorias,
  ligacoes,
  nomesLocais,
  categoriaNota,
  nomesCategoriaOmie,
}: {
  notaId: string
  itens: ItemNF[]
  categorias: { id: number; nome: string }[]
  /** Loja Omie: cada item liga à página do produto e aos movimentos dele desde a emissão da nota. */
  ligacoes?: { emissao: string | null; hoje: string } | null
  /** Nomes dos locais já carregados pela página (sem consulta nova aqui); sem nome, mostra o código. */
  nomesLocais?: Record<number, string>
  /** Categoria da nota no Omie: o item só mostra a dele quando é diferente. */
  categoriaNota?: string | null
  nomesCategoriaOmie?: Record<string, string>
}) {
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [aberto, setAberto] = useState<number | null>(null)

  if (!itens.length) return <EmptyState icon={FileText} title="Nenhum item nesta nota" />

  const nomeLocal = (c: number | null) => (c == null ? '-' : nomesLocais?.[c] ?? String(c))
  const produtoHref = (item: ItemNF) => (ligacoes && item.n_id_produto ? `/estoque/produto/${item.n_id_produto}` : null)
  const movHref = (item: ItemNF) =>
    ligacoes && item.n_id_produto && ligacoes.emissao
      ? `/movimentacoes?cod=${item.n_id_produto}&data_inicio=${ligacoes.emissao.slice(0, 10)}&data_final=${ligacoes.hoje}`
      : null
  const base = `/nota-fiscal/${notaId}/imprimir`
  const todos = sel.size === itens.length
  const alternar = (id: number) =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const semProduto = itens.filter((i) => ligacoes && i.n_id_produto == null).length

  return (
    <section className="rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]" aria-label="Itens da nota">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-2 pt-3.5">
        <h2 className="text-[16px] font-semibold text-text">Itens da nota <span className="font-normal text-text-muted">{itens.length}</span></h2>
        {semProduto > 0 && <span className="text-[13px] font-medium text-warn">{semProduto} sem produto ligado no Omie</span>}
        <div className="ml-auto flex items-center gap-2">
          {sel.size > 0 && (
            <DialogImprimirEtiqueta
              href={`${base}?itens=${[...sel].join(',')}`}
              trigger={<button type="button" className={btnClass('outline')}><Printer className="size-4" />Etiquetas dos marcados ({sel.size})</button>}
            />
          )}
          <DialogImprimirEtiqueta href={base} trigger={<button type="button" className={btnClass('outline')}><Printer className="size-4" />Etiquetas de todos</button>} />
        </div>
      </header>

      <div className="hidden grid-cols-[28px_minmax(0,1fr)_130px_100px_110px_36px] items-center gap-3 border-b border-border px-4 pb-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-text-muted md:grid">
        <input type="checkbox" checked={todos} onChange={() => setSel(todos ? new Set() : new Set(itens.map((i) => i.id)))} aria-label="Marcar todos" className="size-4 accent-[var(--brand)]" />
        <span>Produto</span>
        <span className="text-right">Quantidade</span>
        <span className="text-right">Custo un.</span>
        <span className="text-right">Total</span>
        <span />
      </div>

      <ul>
        {itens.map((item) => {
          const aj = ajustesDoItem(item.full_object)
          const entra = entraNoEstoque(item)
          const total = totalDoItem(item)
          const catItem = categoriaDoItemOmie(item.full_object)
          const catDiferente = !!catItem && !!categoriaNota && catItem !== categoriaNota
          const ph = produtoHref(item)
          const mh = movHref(item)
          const abrir = aberto === item.id
          const impostos = abrir ? impostosItem(item.full_object) : []
          return (
            <li key={item.id} className={`border-b border-border/60 last:border-0 ${sel.has(item.id) ? 'bg-brand-soft/40' : ''}`}>
              <div className="grid grid-cols-[28px_minmax(0,1fr)_36px] items-start gap-x-3 gap-y-1 px-4 py-3 md:grid-cols-[28px_minmax(0,1fr)_130px_100px_110px_36px] md:items-center">
                <input type="checkbox" checked={sel.has(item.id)} onChange={() => alternar(item.id)} aria-label={`Marcar ${item.c_descricao_produto ?? 'item'}`} className="mt-1 size-4 accent-[var(--brand)] md:mt-0" />
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-text">
                    {ph ? <Link href={ph} className="hover:text-brand hover:underline">{item.c_descricao_produto}</Link> : item.c_descricao_produto}
                  </p>
                  <p className="text-[12px] text-text-muted">
                    <span className="num">cód. {item.c_codigo_produto ?? '-'}</span>
                    {mh && <> · <Link href={mh} className="text-brand hover:underline">movimentos</Link></>}
                    {ligacoes && item.n_id_produto == null && <span className="font-medium text-warn"> · sem produto ligado</span>}
                  </p>
                  {catDiferente && (
                    <p className="text-[12px] text-text-muted">Categoria deste item: <span className="font-medium text-text">{catItem}{nomesCategoriaOmie?.[catItem!] ? ` · ${nomesCategoriaOmie[catItem!]}` : ''}</span></p>
                  )}
                  {(aj.movimenta === false || aj.geraConta === false) && (
                    <p className="text-[12px] text-warn">{[aj.movimenta === false ? 'não movimenta estoque' : '', aj.geraConta === false ? 'não gera conta a pagar' : ''].filter(Boolean).join(' · ')}</p>
                  )}
                  {/* celular: números embaixo do nome */}
                  <p className="num mt-1 text-[13px] text-text md:hidden">
                    {qtd(item.n_qtde_nfe)} {item.c_unidade_nfe}{entra ? ` (entra ${qtd(entra.quantidade)} ${entra.unidade})` : ''} · {brl(item.n_preco_unit != null ? Number(item.n_preco_unit) : null)} · <span className="font-semibold">{brl(total)}</span>
                  </p>
                </div>
                <div className="hidden text-right md:block">
                  <p className="num text-[14px] text-text">{qtd(item.n_qtde_nfe)} <span className="text-text-muted">{item.c_unidade_nfe}</span></p>
                  {entra && <p className="num text-[12px] text-text-muted">entra {qtd(entra.quantidade)} {entra.unidade}</p>}
                </div>
                <p className="num hidden text-right text-[14px] text-text md:block">{brl(item.n_preco_unit != null ? Number(item.n_preco_unit) : null)}</p>
                <p className="num hidden text-right text-[14px] font-semibold text-text md:block">{brl(total)}</p>
                <button
                  type="button"
                  onClick={() => setAberto(abrir ? null : item.id)}
                  aria-expanded={abrir}
                  aria-label="Mais deste item"
                  className="flex size-9 items-center justify-center rounded-full text-text-muted u-motion hover:bg-surface-2 hover:text-text"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </div>
              {abrir && (
                <div className="mx-4 mb-3 space-y-3 rounded-[var(--r-md)] bg-surface-2 p-3 text-[13px]">
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                    <div><dt className="text-text-muted">CFOP da nota</dt><dd className="num font-medium">{item.c_cfop || '-'}</dd></div>
                    <div><dt className="text-text-muted">CFOP de entrada</dt><dd className="num font-medium">{aj.cfopEntrada ?? '-'}</dd></div>
                    <div><dt className="text-text-muted">Entra no local</dt><dd className="font-medium">{nomeLocal(aj.local)}</dd></div>
                    <div><dt className="text-text-muted">Gera conta a pagar · movimenta</dt><dd className="font-medium">{simNao(aj.geraConta)} · {simNao(aj.movimenta)}</dd></div>
                    {impostos.map((imp) => (
                      <div key={imp.label}><dt className="text-text-muted">{imp.label}</dt><dd className="num font-medium">{brl(imp.valor)}</dd></div>
                    ))}
                  </dl>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    {categorias.length > 0 && (
                      <span className="inline-flex items-center gap-2 text-text-muted">Classificação no sistema <CategoriaContabilSelect itemId={item.id} valorInicial={item.categoria_contabil_id} categorias={categorias} /></span>
                    )}
                    <span className="inline-flex items-center gap-2 text-text-muted">Qtd para etiqueta <QuantidadeInput itemId={item.id} valorInicial={item.quantidade} /></span>
                    <DialogImprimirEtiqueta href={`${base}?itens=${item.id}`} trigger={<button type="button" className={btnClass('outline')}><Printer className="size-4" />Imprimir etiqueta</button>} />
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
