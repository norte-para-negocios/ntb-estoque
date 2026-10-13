'use client'

// Seleção de OPs abertas e ações em lote no Omie ("nosso Omie" Fase 4): concluir, excluir ou mudar a data.
// Uma OP por vez (acaoOPLote), com progresso; para no primeiro bloqueio do Omie e mostra o que já foi feito.

import { createContext, useContext, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, CheckCheck, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { acaoOPLote, type AcaoLoteOP } from '@/lib/actions/ops-lote'

const MAX = 100
type Ctx = { sel: Set<number>; alternar: (id: number) => void; ativo: boolean }
const LoteCtx = createContext<Ctx>({ sel: new Set(), alternar: () => {}, ativo: false })

type Pode = { concluir: boolean; excluir: boolean; data: boolean }
type Resultado = { id: number; numero: string; ok: boolean; msg: string }

const ROTULO: Record<AcaoLoteOP, { titulo: string; verbo: string; aviso: string }> = {
  concluir: { titulo: 'Concluir OPs no Omie', verbo: 'Concluir', aviso: 'Cada OP é concluída no Omie com a quantidade planejada e a data prevista (hoje, se a previsão for futura). Os insumos saem do estoque e o prato entra.' },
  excluir: { titulo: 'Excluir OPs no Omie', verbo: 'Excluir', aviso: 'Cada OP é excluída no Omie. Não tem volta: para refazer, é preciso abrir a OP de novo.' },
  data: { titulo: 'Mudar a data das OPs no Omie', verbo: 'Mudar data', aviso: 'A previsão (e as datas de início e conclusão) de cada OP passa a ser o dia escolhido.' },
}

export function LoteOPsProvider({ ativo, idsPagina, numeros, pode, children }: {
  ativo: boolean; idsPagina: number[]; numeros: Record<number, string>; pode: Pode; children: React.ReactNode
}) {
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [acao, setAcao] = useState<AcaoLoteOP | null>(null)
  const [data, setData] = useState('')
  const [rodando, setRodando] = useState(false)
  const [feitos, setFeitos] = useState<Resultado[]>([])
  const [parouPor, setParouPor] = useState<string | null>(null)
  const router = useRouter()

  const ctx = useMemo<Ctx>(() => ({
    ativo, sel,
    alternar: (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else if (n.size < MAX) n.add(id); return n }),
  }), [ativo, sel])

  const todosPagina = idsPagina.length > 0 && idsPagina.every((id) => sel.has(id))
  function alternarPagina() {
    setSel((s) => {
      const n = new Set(s)
      if (todosPagina) idsPagina.forEach((id) => n.delete(id))
      else for (const id of idsPagina) { if (n.size >= MAX) break; n.add(id) }
      return n
    })
  }

  function abrir(a: AcaoLoteOP) { setAcao(a); setFeitos([]); setParouPor(null) }

  async function executar() {
    if (!acao) return
    if (acao === 'data' && !data) return
    setRodando(true); setFeitos([]); setParouPor(null)
    const ids = [...sel]
    const lista: Resultado[] = []
    for (const id of ids) {
      let r: Awaited<ReturnType<typeof acaoOPLote>>
      try { r = await acaoOPLote({ acao, opId: id, dataISO: acao === 'data' ? data : null }) }
      catch (e) { r = { error: e instanceof Error ? e.message : 'Falha de comunicação', parar: true } }
      if ('error' in r) {
        lista.push({ id, numero: numeros[id] ?? `#${id}`, ok: false, msg: r.error })
        setFeitos([...lista])
        if (r.parar) { setParouPor(`Parei na OP ${numeros[id] ?? id}: ${r.error}. As seguintes não foram tocadas.`); break }
        continue
      }
      lista.push({ id, numero: numeros[id] ?? `#${id}`, ok: true, msg: r.simulado ? 'simulado (loja de teste)' : 'feito' })
      setFeitos([...lista])
    }
    setSel((s) => { const n = new Set(s); lista.filter((x) => x.ok).forEach((x) => n.delete(x.id)); return n })
    setRodando(false)
    router.refresh()
  }

  const r = acao ? ROTULO[acao] : null
  const nOk = feitos.filter((f) => f.ok).length
  return (
    <LoteCtx.Provider value={ctx}>
      {ativo && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-[var(--r-lg)] bg-surface px-4 py-2.5 text-[13px] u-card">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={todosPagina} onChange={alternarPagina} aria-label="Selecionar as OPs desta página" />
            <span className="text-text-muted">{sel.size ? `${sel.size} selecionada${sel.size === 1 ? '' : 's'}` : 'Selecionar desta página'}{sel.size >= MAX ? ` (máximo ${MAX})` : ''}</span>
          </label>
          {sel.size > 0 && (
            <div className="ml-auto flex flex-wrap gap-2">
              {pode.concluir && <button type="button" className={btnClass('primary')} onClick={() => abrir('concluir')}><CheckCheck className="size-4" />Concluir</button>}
              {pode.data && <button type="button" className={btnClass('outline')} onClick={() => abrir('data')}><CalendarDays className="size-4" />Mudar data</button>}
              {pode.excluir && <button type="button" className={btnClass('outline')} onClick={() => abrir('excluir')}><Trash2 className="size-4" />Excluir</button>}
              <button type="button" className={btnClass('ghost')} onClick={() => setSel(new Set())}>Limpar</button>
            </div>
          )}
        </div>
      )}
      {children}
      <Dialog open={acao != null} onOpenChange={(o) => { if (!o && !rodando) setAcao(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{r?.titulo}</DialogTitle>
            <p className="text-[13px] text-text-muted">{sel.size || feitos.length} OP{(sel.size || feitos.length) === 1 ? '' : 's'}: {r?.aviso}</p>
          </DialogHeader>
          {acao === 'data' && !feitos.length && (
            <label className="block space-y-1 text-[13px]">
              <span>Data nova</span>
              <input type="date" className="w-full rounded-[var(--r-md)] bg-surface-2 px-3 py-2" value={data} onChange={(e) => setData(e.target.value)} />
            </label>
          )}
          {feitos.length > 0 && (
            <div className="max-h-64 space-y-1 overflow-y-auto text-[13px]">
              <p className="font-medium text-text">{nOk} de {feitos.length} feitas{rodando ? '…' : ''}</p>
              {feitos.map((f) => (
                <p key={f.id} className={f.ok ? 'text-text-muted' : 'text-err'}>OP {f.numero}: {f.msg}</p>
              ))}
              {parouPor && <p className="font-medium text-warn">{parouPor}</p>}
            </div>
          )}
          <DialogFooter>
            {!feitos.length || rodando ? (
              <button type="button" className={btnClass(acao === 'excluir' ? 'danger' : 'primary')} disabled={rodando || (acao === 'data' && !data)} onClick={executar}>
                {rodando && <Spinner />}{r?.verbo} {sel.size} OP{sel.size === 1 ? '' : 's'} no Omie
              </button>
            ) : (
              <button type="button" className={btnClass('primary')} onClick={() => setAcao(null)}>Fechar</button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </LoteCtx.Provider>
  )
}

/** Caixa de seleção de uma OP (fica fora do <summary> para não abrir/fechar o detalhe). */
export function CheckOP({ id, numero }: { id: number; numero: string }) {
  const { ativo, sel, alternar } = useContext(LoteCtx)
  if (!ativo) return null
  return (
    <input type="checkbox" className="mt-5 ml-4 size-4 shrink-0" checked={sel.has(id)} onChange={() => alternar(id)} aria-label={`Selecionar a OP ${numero}`} />
  )
}
