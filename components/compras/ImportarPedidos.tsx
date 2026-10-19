'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Download, Upload } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { confirmarImportacaoPedidos, previaImportacaoPedidos, type ArquivoImportacao } from '@/lib/actions/importar-pedidos'
import type { ResultadoImportacao } from '@/lib/compras/importar-pedidos-puro'

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const MAX = 600 * 1024

function base64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

export function ImportarPedidos() {
  const router = useRouter()
  const [pend, start] = useTransition()
  const [arq, setArq] = useState<ArquivoImportacao | null>(null)
  const [res, setRes] = useState<ResultadoImportacao | null>(null)
  const [ja, setJa] = useState<{ id: number; numero: number }[]>([])
  const [erro, setErro] = useState<string | null>(null)

  async function escolher(f: File | undefined) {
    setErro(null); setRes(null); setArq(null); setJa([])
    if (!f) return
    if (!/\.(xlsx|csv)$/i.test(f.name)) { setErro('Envie a planilha em .xlsx ou .csv (use o modelo).'); return }
    if (f.size > MAX) { setErro('Arquivo grande demais (máximo 600 KB). Divida a planilha.'); return }
    const a = { nome: f.name, base64: base64(await f.arrayBuffer()) }
    setArq(a)
    start(async () => {
      const r = await previaImportacaoPedidos(a)
      if ('error' in r) { setErro(r.error); return }
      setRes(r.resultado); setJa(r.jaImportada)
    })
  }

  function confirmar() {
    if (!arq) return
    setErro(null)
    start(async () => {
      const r = await confirmarImportacaoPedidos(arq)
      if ('error' in r) { setErro(r.error); return }
      if (r.pedidos.length === 1) router.push(`/pedido-compra/${r.pedidos[0].id}`)
      else router.push(`/pedido-compra?criados=${r.pedidos.map((p) => p.numero).join(',')}`)
    })
  }

  const comErro = res?.linhas.filter((l) => l.erros.length) ?? []
  const pode = !!res && !res.erroGeral && res.erros === 0 && res.pedidos.length > 0

  return (
    <div className="space-y-4">
      <section className="grid gap-4 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:grid-cols-3">
        <div><p className="text-[13px] font-semibold text-text">1. Baixe o modelo</p>
          <a href="/pedido-compra/importar/modelo" download className={`${btnClass('outline')} mt-2`}><Download className="size-4" /> Modelo (.xlsx)</a></div>
        <div><p className="text-[13px] font-semibold text-text">2. Preencha</p>
          <p className="mt-1 text-[12.5px] text-text-muted">Uma linha por item. Linhas com o mesmo &quot;Pedido&quot; viram um pedido; sem ele, junta por fornecedor e previsão. A aba Instruções explica cada coluna.</p></div>
        <div><p className="text-[13px] font-semibold text-text">3. Envie e confira</p>
          <label className={`${btnClass('primary')} mt-2 cursor-pointer`}><Upload className="size-4" /> {pend && !res ? 'Lendo…' : 'Escolher planilha'}
            <input type="file" accept=".xlsx,.csv" className="sr-only" onChange={(e) => { void escolher(e.target.files?.[0]); e.target.value = '' }} /></label>
          {arq && <p className="mt-1 truncate text-[12px] text-text-muted">{arq.nome}</p>}</div>
      </section>

      {erro && <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">{erro}</p>}
      {res?.erroGeral && <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">{res.erroGeral}</p>}
      {ja.length > 0 && (
        <p className="rounded-[var(--r-lg)] bg-warn/10 px-4 py-3 text-[13px] text-text">
          Este mesmo arquivo já foi importado: pedidos nº {ja.map((p) => p.numero).join(', ')}. Importar de novo só abre esses pedidos, não cria outros.
        </p>
      )}

      {res && !res.erroGeral && (
        <>
          {comErro.length > 0 && (
            <section className="space-y-2 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
              <h2 className="text-[15px] font-semibold text-err">{comErro.length} linha(s) com erro: nada será importado até corrigir</h2>
              <ul className="max-h-[420px] space-y-1 overflow-y-auto text-[13px]">
                {comErro.slice(0, 300).map((l) => (
                  <li key={l.linha}><span className="num font-semibold text-text">Linha {l.linha}</span>{l.produto ? ` · ${l.produto}` : ''}: <span className="text-text-muted">{l.erros.join(' ')}</span></li>
                ))}
              </ul>
              {comErro.length > 300 && <p className="text-[12px] text-text-muted">Mostrando as 300 primeiras.</p>}
            </section>
          )}
          <section className="space-y-2 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
            <h2 className="text-[15px] font-semibold text-text">{res.pedidos.length} pedido(s), {res.linhas.length - comErro.length} de {res.linhas.length} linha(s) válidas</h2>
            <ul className="divide-y divide-[var(--border)] text-[13px]">
              {res.pedidos.map((p) => (
                <li key={p.grupo + p.linhas[0]} className="flex flex-wrap justify-between gap-2 py-2">
                  <span><span className="font-medium text-text">{p.fornecedorNome}</span> · {p.grupo} · {p.itens.length} item(ns){p.previsao ? ` · entrega ${p.previsao.split('-').reverse().join('/')}` : ''}{p.fornecedorId ? '' : ' · fornecedor sem cadastro'}</span>
                  <span className="num font-semibold text-text">{brl(p.total)}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="button" className={btnClass('primary')} disabled={!pode || pend} onClick={confirmar}>
                {pend ? 'Importando…' : ja.length ? 'Abrir os pedidos já importados' : `Importar ${res.pedidos.length} pedido(s) como rascunho`}
              </button>
              <Link href="/pedido-compra" className={btnClass('outline')}>Voltar</Link>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
