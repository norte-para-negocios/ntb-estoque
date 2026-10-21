'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { criarCategoriasPadrao, salvarCategoriaFinanceira } from '@/lib/actions/financeiro'
import type { Categoria } from '@/lib/financeiro/dados'
import { campo, GRUPOS_DRE, rotulo, rotuloGrupoDre } from './comum'

type Contabil = { id: number; nome: string }

export function FormCategoria({ categoria, contabeis, children }: { categoria?: Categoria; contabeis: Contabil[]; children: React.ReactNode }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [nome, setNome] = useState(categoria?.nome ?? '')
  const [codigo, setCodigo] = useState(categoria?.codigo ?? '')
  const [tipo, setTipo] = useState<'despesa' | 'receita'>(categoria?.tipo ?? 'despesa')
  const [grupo, setGrupo] = useState(categoria?.grupo_dre ?? 'despesa_operacional')
  const [contabil, setContabil] = useState(categoria?.categoria_contabil_id ? String(categoria.categoria_contabil_id) : '')
  const [ativa, setAtiva] = useState(categoria?.ativa ?? true)
  const [erro, setErro] = useState<string | null>(null)
  const [pend, start] = useTransition()

  function reiniciar() {
    setNome(categoria?.nome ?? ''); setCodigo(categoria?.codigo ?? ''); setTipo(categoria?.tipo ?? 'despesa'); setGrupo(categoria?.grupo_dre ?? 'despesa_operacional')
    setContabil(categoria?.categoria_contabil_id ? String(categoria.categoria_contabil_id) : ''); setAtiva(categoria?.ativa ?? true); setErro(null)
  }

  function salvar() {
    setErro(null)
    start(async () => {
      const r = await salvarCategoriaFinanceira({ id: categoria?.id ?? null, nome, codigo, tipo, grupoDre: grupo, categoriaContabilId: contabil ? Number(contabil) : null, ativa })
      if ('error' in r) { setErro(r.error); return }
      toast.success(categoria ? 'Categoria atualizada' : 'Categoria criada')
      setAberto(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!pend) { if (o) reiniciar(); setAberto(o); setErro(null) } }}>
      <DialogTrigger render={<button type="button" className={categoria ? 'text-[13px] font-medium text-brand hover:underline' : btnClass('primary')}>{children}</button>} />
      <DialogContent>
        <DialogHeader><DialogTitle>{categoria ? 'Editar categoria' : 'Nova categoria financeira'}</DialogTitle></DialogHeader>
        <div className="max-h-[65vh] space-y-3 overflow-auto text-[13px]">
          <label className={rotulo}><span>Nome</span><input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className={rotulo}><span>Código (opcional)</span><input className={campo} value={codigo} onChange={(e) => setCodigo(e.target.value)} maxLength={20} /></label>
            <label className={rotulo}><span>Tipo</span>
              <select className={campo} value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
                <option value="despesa">Despesa</option>
                <option value="receita">Receita</option>
              </select>
            </label>
          </div>
          <label className={rotulo}><span>Linha da DRE</span>
            <select className={campo} value={grupo} onChange={(e) => setGrupo(e.target.value)}>
              {GRUPOS_DRE.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </label>
          <label className={rotulo}><span>Categoria contábil das notas (opcional)</span>
            <select className={campo} value={contabil} onChange={(e) => setContabil(e.target.value)}>
              <option value="">— nenhuma —</option>
              {contabeis.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          {categoria && <label className="flex items-center gap-2"><input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} /> Categoria ativa</label>}
          {erro && <p className="rounded-[var(--r-md)] bg-surface-2 p-2 font-medium text-err">{erro}</p>}
        </div>
        <DialogFooter>
          <button type="button" className={btnClass('primary')} disabled={pend || nome.trim().length < 2} onClick={salvar}>{pend && <Spinner />}Salvar</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function BotaoCategoriasPadrao() {
  const router = useRouter()
  const [pend, start] = useTransition()
  return (
    <button type="button" className={btnClass('outline')} disabled={pend} onClick={() => start(async () => {
      const r = await criarCategoriasPadrao()
      if ('error' in r) toast.error('Não foi possível criar', { description: r.error })
      else { toast.success(r.criadas ? `${r.criadas} categorias criadas` : 'Todas as categorias padrão já existem'); router.refresh() }
    })}>{pend && <Spinner />}Criar categorias padrão</button>
  )
}

export function TabelaCategorias({ categorias, contabeis }: { categorias: Categoria[]; contabeis: Contabil[] }) {
  const nomeContabil = (id: number | null) => contabeis.find((c) => c.id === id)?.nome ?? null
  return (
    <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface u-card">
      <table className="w-full min-w-[560px] text-[13px]">
        <thead>
          <tr className="text-left text-text-muted">
            <th className="px-4 py-2.5 font-medium">Categoria</th>
            <th className="px-2 py-2.5 font-medium">Tipo</th>
            <th className="px-2 py-2.5 font-medium">Linha da DRE</th>
            <th className="px-2 py-2.5 font-medium">Categoria contábil</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {categorias.map((c) => (
            <tr key={c.id} className={`border-t border-[var(--border)] ${c.ativa ? '' : 'opacity-60'}`}>
              <td className="px-4 py-2">{c.codigo ? <span className="text-text-muted">{c.codigo} · </span> : null}{c.nome}{c.ativa ? '' : ' (inativa)'}</td>
              <td className="px-2 py-2">{c.tipo === 'despesa' ? 'Despesa' : 'Receita'}</td>
              <td className="px-2 py-2">{rotuloGrupoDre(c.grupo_dre)}</td>
              <td className="px-2 py-2 text-text-muted">{nomeContabil(c.categoria_contabil_id) ?? '—'}</td>
              <td className="px-4 py-2 text-right"><FormCategoria categoria={c} contabeis={contabeis}>Editar</FormCategoria></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
