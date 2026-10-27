'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, X, RotateCcw, Download, FileSearch } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import type { Agg, Layout, Medida, No } from '@/lib/relatorios/pivot'
import { chaveMedida } from '@/lib/relatorios/pivot'
import type { CampoCubo } from '@/lib/relatorios/cubos/tipos'

type Resposta = {
  periodo: { ini: string; fim: string; cortado: boolean }
  totalLinhas: number
  truncado: boolean
  falhou: boolean
  raiz: No
  colunas: string[]
  total: Record<string, number>
  opcoes: Record<string, string[]>
  erro?: string
}

const ROTULO_AGG: Record<Agg, string> = { soma: 'Soma', contagem: 'Contagem', contagem_distinta: 'Contagem distinta', media: 'Média', min: 'Mínimo', max: 'Máximo' }
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const inteiro = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
const campoSel = 'h-9 rounded-[var(--r-md)] border border-border bg-surface px-2 text-[13px] text-text outline-none focus:ring-2 focus:ring-brand/40'
const chip = 'inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pl-3 pr-1 text-[13px] text-text'
const iconBtn = 'flex size-6 items-center justify-center rounded-full text-text-muted hover:bg-[var(--border)] hover:text-text disabled:opacity-30'

function mover<T>(lista: T[], i: number, d: -1 | 1): T[] {
  const j = i + d
  if (j < 0 || j >= lista.length) return lista
  const c = [...lista]
  ;[c[i], c[j]] = [c[j], c[i]]
  return c
}

export function TabelaDinamica({ cubo, slug, campos, layoutInicial, ini, fim }: { cubo: string; slug: string; campos: CampoCubo[]; layoutInicial: Layout; ini: string; fim: string }) {
  const chaveSalva = `ntb:relatorio-dinamico:${slug}`
  const [layout, setLayout] = useState<Layout>(layoutInicial)
  const [resp, setResp] = useState<Resposta | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const lido = useRef(false)

  const porId = useMemo(() => new Map(campos.map((c) => [c.id, c])), [campos])
  const grupos = useMemo(() => {
    const m = new Map<string, CampoCubo[]>()
    for (const c of campos) m.set(c.grupo, [...(m.get(c.grupo) ?? []), c])
    return [...m.entries()]
  }, [campos])

  // Volta ao último layout usado neste relatório (por pessoa, neste navegador). Falha de storage nunca quebra a tela.
  useEffect(() => {
    try {
      const salvo = window.localStorage.getItem(chaveSalva)
      if (salvo) {
        const l = JSON.parse(salvo) as Layout
        const ok = [...l.linhas, ...l.colunas, ...l.medidas.map((m) => m.campo), ...Object.keys(l.filtros ?? {})].every((id) => porId.has(id))
        if (ok && Array.isArray(l.linhas) && Array.isArray(l.medidas)) setLayout({ ...l, filtros: l.filtros ?? {} })
      }
    } catch { /* sem storage: segue com o layout do relatório */ }
    lido.current = true
  }, [chaveSalva, porId])

  const filtroKeys = Object.keys(layout.filtros).sort().join('|')
  useEffect(() => {
    if (!lido.current) return
    try { window.localStorage.setItem(chaveSalva, JSON.stringify(layout)) } catch { /* idem */ }
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      setCarregando(true)
      setErro(null)
      try {
        const r = await fetch(`/relatorios/dinamico/${cubo}/pivot`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
          body: JSON.stringify({ ini, fim, layout, opcoesDe: Object.keys(layout.filtros) }),
        })
        const j = (await r.json()) as Resposta
        if (!r.ok) throw new Error(j.erro ?? 'Não foi possível montar o relatório.')
        setResp(j)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setErro((e as Error).message)
      } finally {
        if (!ctl.signal.aborted) setCarregando(false)
      }
    }, 200)
    return () => { clearTimeout(t); ctl.abort() }
  }, [layout, ini, fim, cubo, chaveSalva, filtroKeys])

  const set = (p: Partial<Layout>) => setLayout((l) => ({ ...l, ...p }))
  const restaurar = () => { setLayout(layoutInicial); try { window.localStorage.removeItem(chaveSalva) } catch { /* idem */ } }

  function fmtMedida(m: Medida, v: number | undefined): string {
    if (v == null) return ''
    if (m.agg === 'contagem' || m.agg === 'contagem_distinta') return inteiro(v)
    return porId.get(m.campo)?.tipo === 'moeda' ? brl(v) : num(v)
  }

  // Árvore achatada para a tabela, respeitando o que está aberto.
  const linhasVisiveis = useMemo(() => {
    const out: { no: No; nivel: number; temFilhos: boolean }[] = []
    const visitar = (n: No, nivel: number) => {
      out.push({ no: n, nivel, temFilhos: n.filhos.length > 0 })
      if (abertos.has(n.chave)) n.filhos.forEach((f) => visitar(f, nivel + 1))
    }
    resp?.raiz.filhos.forEach((f) => visitar(f, 0))
    return out
  }, [resp, abertos])

  const todosNos = useMemo(() => {
    const ids: string[] = []
    const v = (n: No) => { if (n.filhos.length) { ids.push(n.chave); n.filhos.forEach(v) } }
    resp?.raiz.filhos.forEach(v)
    return ids
  }, [resp])

  const colunasValor = resp && layout.colunas.length ? resp.colunas : ['']
  const cabecalhos = layout.medidas.map((m) => ({ m, k: chaveMedida(m), rot: `${m.campo}${m.agg === 'soma' ? '' : ` (${ROTULO_AGG[m.agg].toLowerCase()})`}` }))
  const celula = (valores: Record<string, number>, col: string, k: string) => (col ? valores[`${col}|${k}`] : valores[k])

  const camposLivres = (usados: string[]) => campos.filter((c) => !usados.includes(c.id))
  const seletor = (rotulo: string, usados: string[], onPick: (id: string) => void, so?: (c: CampoCubo) => boolean) => (
    <select aria-label={rotulo} className={campoSel} value="" onChange={(e) => { if (e.target.value) onPick(e.target.value) }}>
      <option value="">+ {rotulo}</option>
      {grupos.map(([g, cs]) => {
        const livres = cs.filter((c) => camposLivres(usados).includes(c) && (!so || so(c)))
        return livres.length ? <optgroup key={g} label={g}>{livres.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}</optgroup> : null
      })}
    </select>
  )

  const listaCampos = (titulo: string, ajuda: string, ids: string[], onChange: (ids: string[]) => void, outrosUsados: string[]) => (
    <div className="min-w-[240px] flex-1 space-y-2">
      <div><p className="text-[13px] font-semibold text-text">{titulo}</p><p className="text-[12px] text-text-muted">{ajuda}</p></div>
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id, i) => (
          <span key={id} className={chip}>
            {i + 1}. {id}
            <button type="button" className={iconBtn} aria-label="Subir" disabled={i === 0} onClick={() => onChange(mover(ids, i, -1))}><ArrowUp className="size-3.5" /></button>
            <button type="button" className={iconBtn} aria-label="Descer" disabled={i === ids.length - 1} onClick={() => onChange(mover(ids, i, 1))}><ArrowDown className="size-3.5" /></button>
            <button type="button" className={iconBtn} aria-label={`Tirar ${id}`} onClick={() => onChange(ids.filter((x) => x !== id))}><X className="size-3.5" /></button>
          </span>
        ))}
        {!ids.length && <span className="text-[12px] text-text-muted">nenhum</span>}
      </div>
      {seletor(`Adicionar ${titulo.toLowerCase()}`, [...ids, ...outrosUsados], (id) => onChange([...ids, id]))}
    </div>
  )

  const baixar = async () => {
    const r = await fetch(`/relatorios/dinamico/${cubo}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ini, fim, layout }) })
    if (!r.ok) { setErro('Não foi possível gerar o Excel.'); return }
    const url = URL.createObjectURL(await r.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug}_${ini}_${fim}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-[var(--r-lg)] bg-surface p-4 u-card" aria-label="Montar o relatório">
        <div className="flex flex-wrap gap-x-6 gap-y-4">
          {listaCampos('Linhas', 'O que aparece na vertical, de fora para dentro.', layout.linhas, (linhas) => set({ linhas }), layout.colunas)}
          {listaCampos('Colunas', 'O que abre para o lado (ex.: Mês).', layout.colunas, (colunas) => set({ colunas }), layout.linhas)}
        </div>
        <div className="space-y-2">
          <div><p className="text-[13px] font-semibold text-text">Valores</p><p className="text-[12px] text-text-muted">O que é somado ou contado em cada célula.</p></div>
          <div className="flex flex-wrap gap-1.5">
            {layout.medidas.map((m, i) => (
              <span key={chaveMedida(m)} className={chip}>
                {m.campo}
                <select aria-label={`Como calcular ${m.campo}`} className="h-6 rounded-full bg-transparent px-1 text-[12px] text-text-muted outline-none" value={m.agg}
                  onChange={(e) => set({ medidas: layout.medidas.map((x, j) => (j === i ? { ...x, agg: e.target.value as Agg } : x)) })}>
                  {(Object.keys(ROTULO_AGG) as Agg[]).map((a) => <option key={a} value={a}>{ROTULO_AGG[a]}</option>)}
                </select>
                <button type="button" className={iconBtn} aria-label={`Tirar ${m.campo}`} onClick={() => set({ medidas: layout.medidas.filter((_, j) => j !== i) })}><X className="size-3.5" /></button>
              </span>
            ))}
          </div>
          {seletor('Adicionar valor', layout.medidas.filter((m) => m.agg === 'soma').map((m) => m.campo), (id) => set({ medidas: [...layout.medidas, { campo: id, agg: porId.get(id)?.medida ? 'soma' : 'contagem_distinta' }] }))}
        </div>
        <div className="space-y-2">
          <div><p className="text-[13px] font-semibold text-text">Filtros</p><p className="text-[12px] text-text-muted">Marque o que deve entrar; sem marcar, entra tudo.</p></div>
          <div className="flex flex-wrap items-start gap-2">
            {Object.entries(layout.exceto ?? {}).filter(([, v]) => v.length).map(([campo, v]) => (
              <span key={`ex-${campo}`} className={chip}>Sem {campo}: {v.join(', ')}
                <button type="button" className={iconBtn} aria-label="Incluir de volta" onClick={() => set({ exceto: {} })}><X className="size-3.5" /></button></span>
            ))}
            {Object.keys(layout.filtros).map((campo) => {
              const marcados = layout.filtros[campo] ?? []
              const opcoes = resp?.opcoes[campo] ?? marcados
              return (
                <details key={campo} className="relative">
                  <summary className={`${chip} cursor-pointer list-none pr-3`}>{campo}: {marcados.length ? `${marcados.length} marcado${marcados.length > 1 ? 's' : ''}` : 'todos'}</summary>
                  <div className="absolute left-0 z-20 mt-1 max-h-64 w-72 overflow-auto rounded-[var(--r-md)] bg-surface p-2 shadow-[var(--shadow-sm)] ring-1 ring-border">
                    <div className="mb-1 flex justify-between text-[12px]">
                      <button type="button" className="text-brand" onClick={() => set({ filtros: { ...layout.filtros, [campo]: [] } })}>Limpar</button>
                      <button type="button" className="text-text-muted" onClick={() => { const { [campo]: _, ...resto } = layout.filtros; void _; set({ filtros: resto }) }}>Remover filtro</button>
                    </div>
                    {opcoes.map((o) => (
                      <label key={o} className="flex items-center gap-2 px-1 py-1 text-[13px]">
                        <input type="checkbox" className="size-4" checked={marcados.includes(o)} onChange={(e) => set({ filtros: { ...layout.filtros, [campo]: e.target.checked ? [...marcados, o] : marcados.filter((x) => x !== o) } })} />{o}
                      </label>
                    ))}
                  </div>
                </details>
              )
            })}
            {seletor('Adicionar filtro', Object.keys(layout.filtros), (id) => set({ filtros: { ...layout.filtros, [id]: [] } }))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <button type="button" className={btnClass('outline')} onClick={restaurar}><RotateCcw className="size-4" />Voltar ao layout do relatório</button>
          <button type="button" className={btnClass('outline')} onClick={() => setAbertos(abertos.size ? new Set() : new Set(todosNos))}>{abertos.size ? 'Fechar tudo' : 'Abrir tudo'}</button>
          <button type="button" className={btnClass('primary')} onClick={baixar} disabled={!resp || carregando}><Download className="size-4" />Exportar Excel</button>
          {carregando && <span className="inline-flex items-center gap-1.5 text-[13px] text-text-muted"><Spinner />Montando…</span>}
          {resp && !carregando && <span className="text-[12px] text-text-muted">{inteiro(resp.totalLinhas)} {resp.totalLinhas === 1 ? 'linha' : 'linhas'} no período</span>}
        </div>
      </section>

      {erro && <p role="alert" className="rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[13px] text-err shadow-[var(--shadow-sm)]">{erro}</p>}
      {resp?.falhou && <p role="alert" className="rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[13px] text-warn shadow-[var(--shadow-sm)]">Parte dos dados não carregou. Os totais abaixo podem estar incompletos; tente de novo.</p>}
      {resp?.truncado && <p role="alert" className="rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[13px] text-warn shadow-[var(--shadow-sm)]">O período tem mais de 50.000 linhas: só as primeiras entraram. Reduza o período.</p>}
      {resp?.periodo.cortado && <p className="text-[12px] text-text-muted">Período limitado a 10 anos.</p>}

      {resp && resp.totalLinhas === 0 && !carregando && <EmptyState icon={FileSearch} title="Nenhuma nota no período" hint="Escolha outro período ou tire algum filtro." />}

      {resp && resp.totalLinhas > 0 && (
        <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
          <table className="w-full min-w-max text-[13px]">
            <thead>
              {layout.colunas.length > 0 && (
                <tr className="border-b border-border">
                  <th className="sticky left-0 bg-surface px-3 py-2" />
                  {colunasValor.map((c) => <th key={c} colSpan={cabecalhos.length} className="px-3 py-2 text-center font-semibold text-text">{c}</th>)}
                  <th colSpan={cabecalhos.length} className="px-3 py-2 text-center font-semibold text-text">Total</th>
                </tr>
              )}
              <tr className="border-b border-border text-text-muted">
                <th className="sticky left-0 min-w-[280px] bg-surface px-3 py-2 text-left font-semibold">{layout.linhas.join(' › ') || 'Total'}</th>
                {colunasValor.map((c) => cabecalhos.map((h) => <th key={`${c}${h.k}`} className="px-3 py-2 text-right font-semibold whitespace-nowrap">{h.rot}</th>))}
                {layout.colunas.length > 0 && cabecalhos.map((h) => <th key={`t${h.k}`} className="px-3 py-2 text-right font-semibold whitespace-nowrap">{h.rot}</th>)}
              </tr>
            </thead>
            <tbody>
              {linhasVisiveis.map(({ no, nivel, temFilhos }) => (
                <tr key={no.chave} className="border-b border-border/60 hover:bg-surface-2/60">
                  <td className="sticky left-0 bg-surface px-3 py-1.5" style={{ paddingLeft: 12 + nivel * 20 }}>
                    {temFilhos
                      ? <button type="button" className="inline-flex items-center gap-1 text-left font-medium text-text" onClick={() => setAbertos((s) => { const n = new Set(s); if (n.has(no.chave)) n.delete(no.chave); else n.add(no.chave); return n })}>
                          {abertos.has(no.chave) ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}{no.rotulo}</button>
                      : <span className="pl-5">{no.rotulo}</span>}
                  </td>
                  {colunasValor.map((c) => cabecalhos.map((h) => <td key={`${c}${h.k}`} className="num px-3 py-1.5 text-right whitespace-nowrap">{fmtMedida(h.m, celula(no.valores, c, h.k))}</td>))}
                  {layout.colunas.length > 0 && cabecalhos.map((h) => <td key={`t${h.k}`} className="num px-3 py-1.5 text-right font-medium whitespace-nowrap">{fmtMedida(h.m, no.valores[h.k])}</td>)}
                </tr>
              ))}
              <tr className="font-semibold text-text">
                <td className="sticky left-0 bg-surface px-3 py-2">Total</td>
                {colunasValor.map((c) => cabecalhos.map((h) => <td key={`${c}${h.k}`} className="num px-3 py-2 text-right whitespace-nowrap">{fmtMedida(h.m, celula(resp.raiz.valores, c, h.k))}</td>))}
                {layout.colunas.length > 0 && cabecalhos.map((h) => <td key={`t${h.k}`} className="num px-3 py-2 text-right whitespace-nowrap">{fmtMedida(h.m, resp.total[h.k])}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
