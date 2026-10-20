'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { buscarProdutos, type ProdutoBusca } from '@/lib/actions/produtos-search'
import { cancelarTransferenciaLoja, registrarTransferenciaLoja } from '@/lib/actions/transferencia-loja'

// Nova transferência/remessa entre lojas (estoque próprio): loja de destino, local de saída e itens. Ao registrar, as
// unidades saem do estoque desta loja ao custo médio; a NF-e sai pelo painel da transferência.

const input = 'w-full rounded-[var(--r-md)] bg-surface-2 px-3 py-2'
type Destino = { id: number; nome: string; natureza: 'transferencia' | 'remessa' }
type Local = { codigo: number; descricao: string }
type Item = { produto: ProdutoBusca; quantidade: string }
const lerNum = (t: string) => { const s = t.trim(); return s ? Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) : 0 }

export function NovaTransferenciaLoja({ destinos, locais }: { destinos: Destino[]; locais: Local[] }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [destino, setDestino] = useState<number | ''>('')
  const [local, setLocal] = useState<number | ''>(locais[0]?.codigo ?? '')
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<ProdutoBusca[]>([])
  const [itens, setItens] = useState<Item[]>([])
  const [obs, setObs] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [pend, start] = useTransition()
  const [chave, setChave] = useState(() => `trl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  const nat = destinos.find((d) => d.id === destino)?.natureza

  function procurar() {
    if (busca.trim().length < 2) return
    start(async () => setAchados(await buscarProdutos(busca)))
  }
  function registrar() {
    setErro(null)
    start(async () => {
      const r = await registrarTransferenciaLoja({
        destino: Number(destino), obs, chave,
        itens: itens.map((i) => ({ codigoProduto: i.produto.codigo_produto, codigoLocal: Number(local), quantidade: lerNum(i.quantidade) })),
      })
      if ('error' in r) { setErro(r.error); return }
      toast.success(`Transferência nº ${r.numero} registrada`, { description: 'Os itens saíram do estoque. Agora emita a NF-e.' })
      setAberto(false); setItens([]); setObs(''); setDestino(''); setChave(`trl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
      router.refresh()
    })
  }
  const valido = !!destino && !!local && itens.length > 0 && itens.every((i) => lerNum(i.quantidade) > 0)

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!pend) { setAberto(o); setErro(null) } }}>
      <DialogTrigger render={<button type="button" className={btnClass('primary')}>Nova transferência</button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transferência entre lojas</DialogTitle>
          <p className="text-[13px] text-text-muted">Os itens saem do estoque desta loja agora, pelo custo médio. A entrada na loja de destino acontece quando a NF-e chegar lá (SEFAZ ou Omie).</p>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-auto text-[13px]">
          <label className="block space-y-1"><span>Loja de destino</span>
            <select className={input} value={destino} onChange={(e) => setDestino(e.target.value ? Number(e.target.value) : '')}>
              <option value="">— escolha —</option>
              {destinos.map((d) => <option key={d.id} value={d.id}>{d.nome}{d.natureza === 'remessa' ? ' (outra empresa: remessa)' : ''}</option>)}
            </select>
          </label>
          {nat === 'remessa' && <p className="text-warn">CNPJ de outra empresa: a nota sai como REMESSA (CFOP 5.949/6.949). Confirme o tratamento com o contador.</p>}
          <label className="block space-y-1"><span>Sai do local</span>
            <select className={input} value={local} onChange={(e) => setLocal(Number(e.target.value))}>
              {locais.map((l) => <option key={l.codigo} value={l.codigo}>{l.descricao}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <input className={input} value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); procurar() } }} placeholder="Buscar produto por nome ou código" />
            <button type="button" className={btnClass('outline')} onClick={procurar} disabled={pend}>Buscar</button>
          </div>
          {achados.length > 0 && (
            <ul className="max-h-40 overflow-auto rounded-[var(--r-md)] bg-surface-2">
              {achados.map((p) => (
                <li key={p.codigo_produto}>
                  <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-[var(--border)]" onClick={() => {
                    if (!itens.some((i) => i.produto.codigo_produto === p.codigo_produto)) setItens((x) => [...x, { produto: p, quantidade: '' }])
                    setAchados([]); setBusca('')
                  }}>{p.codigo} · {p.descricao} ({p.unidade})</button>
                </li>
              ))}
            </ul>
          )}
          {itens.length > 0 && (
            <table className="w-full">
              <tbody>
                {itens.map((i, k) => (
                  <tr key={i.produto.codigo_produto} className="border-t border-[var(--border)]">
                    <td className="px-1 py-1.5">{i.produto.codigo} · {i.produto.descricao}</td>
                    <td className="px-1 py-1.5 text-right">
                      <input inputMode="decimal" aria-label={`Quantidade de ${i.produto.descricao}`} className="w-24 rounded-[var(--r-md)] bg-surface-2 px-2 py-1 text-right" value={i.quantidade}
                        onChange={(e) => setItens((x) => x.map((y, j) => (j === k ? { ...y, quantidade: e.target.value } : y)))} placeholder="0" /> {i.produto.unidade}
                    </td>
                    <td className="px-1"><button type="button" className="text-[12px] text-err" onClick={() => setItens((x) => x.filter((_, j) => j !== k))}>tirar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <label className="block space-y-1"><span>Observação (vai na nota)</span>
            <input className={input} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={300} />
          </label>
          {erro && <p className="rounded-[var(--r-md)] bg-surface-2 p-2 font-medium text-err">{erro}</p>}
        </div>
        <DialogFooter>
          <button type="button" className={btnClass('primary')} disabled={pend || !valido} onClick={registrar}>{pend && <Spinner />}Registrar transferência</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CancelarTransferenciaLoja({ id }: { id: number }) {
  const router = useRouter()
  const [abrir, setAbrir] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [pend, start] = useTransition()
  if (!abrir) return <button type="button" className="text-[12px] font-medium text-brand hover:underline" onClick={() => setAbrir(true)}>Cancelar transferência</button>
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className="min-w-[220px] flex-1 rounded-[var(--r-md)] bg-surface-2 px-3 py-1.5 text-[13px]" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo do cancelamento" />
      <button type="button" className={btnClass('outline')} disabled={pend || motivo.trim().length < 3} onClick={() => start(async () => {
        const r = await cancelarTransferenciaLoja(id, motivo)
        if ('error' in r) toast.error('Não foi possível cancelar', { description: r.error })
        else { toast.success('Transferência cancelada: os itens voltaram ao estoque'); router.refresh() }
      })}>{pend && <Spinner />}Confirmar cancelamento</button>
    </div>
  )
}
