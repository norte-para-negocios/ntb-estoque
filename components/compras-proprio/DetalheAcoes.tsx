'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { estornarCompra, mapearPendentes, type ProdutoBusca } from '@/lib/actions/compras-proprio'
import { campoCompra, SeletorProduto } from './SeletorProduto'

export type ItemPendente = { linha: number; descricao: string; unidadeCompra: string | null; quantidade: number }

export function MapearPendentes({ compraId, itens }: { compraId: number; itens: ItemPendente[] }) {
  const router = useRouter()
  const [mapa, setMapa] = useState<Record<number, { produto: ProdutoBusca | null; fator: string }>>({})
  const [pending, start] = useTransition()
  const escolhidos = itens.filter((i) => mapa[i.linha]?.produto)

  function lancar() {
    start(async () => {
      const r = await mapearPendentes({
        compraId,
        mapeamentos: escolhidos.map((i) => ({ linha: i.linha, codigoProduto: mapa[i.linha].produto!.codigoProduto, fator: Number(mapa[i.linha].fator.replace(',', '.')) || 1 })),
      })
      if ('error' in r) { toast.error('Não foi possível lançar', { description: r.error }); return }
      toast.success(`${r.lancados} ${r.lancados === 1 ? 'item lançado' : 'itens lançados'} no estoque`)
      router.refresh()
    })
  }

  return (
    <section className="space-y-3" aria-label="Itens pendentes">
      <div>
        <h3 className="text-[15px] font-semibold text-text">Itens sem produto ({itens.length})</h3>
        <p className="text-[13px] text-text-muted">Ligue cada item a um produto do estoque. O sistema lembra a ligação para as próximas notas deste fornecedor.</p>
      </div>
      <ul className="space-y-3">
        {itens.map((i) => {
          const m = mapa[i.linha] ?? { produto: null, fator: '1' }
          return (
            <li key={i.linha} className="rounded-[var(--r-lg)] bg-surface p-4 u-card">
              <p className="text-[14px] font-medium text-text">{i.descricao} <span className="num text-[12px] font-normal text-text-muted">· {i.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {i.unidadeCompra}</span></p>
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                <div className="space-y-1.5"><Label>Produto no estoque</Label>
                  <SeletorProduto value={m.produto} sugestaoDescricao={i.descricao} sugestaoUnidade={i.unidadeCompra ?? undefined} onChange={(p) => setMapa((x) => ({ ...x, [i.linha]: { ...m, produto: p } }))} /></div>
                {m.produto && (
                  <div className="space-y-1.5 md:w-64"><Label>1 {i.unidadeCompra ?? 'unidade'} = quantos {m.produto.unidade}?</Label>
                    <input inputMode="decimal" className={`${campoCompra} num`} value={m.fator} onChange={(e) => setMapa((x) => ({ ...x, [i.linha]: { ...m, fator: e.target.value } }))} /></div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <div className="flex justify-end">
        <button type="button" className={btnClass('primary')} onClick={lancar} disabled={pending || !escolhidos.length}>{pending && <Spinner />}Lançar {escolhidos.length} {escolhidos.length === 1 ? 'item' : 'itens'}</button>
      </div>
    </section>
  )
}

export function EstornarCompra({ compraId, numero }: { compraId: number; numero: string | null }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [pending, start] = useTransition()
  function confirmar() {
    start(async () => {
      const r = await estornarCompra(compraId)
      if ('error' in r) { toast.error('Não foi possível estornar', { description: r.error }); return }
      toast.success(`Compra estornada (${r.estornados} entradas desfeitas)`)
      setAberto(false)
      router.refresh()
    })
  }
  return (
    <>
      <button type="button" className={btnClass('dangerSoft')} onClick={() => setAberto(true)}><Undo2 className="size-4" />Estornar compra</button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader><DialogTitle>Estornar a compra{numero ? ` ${numero}` : ''}?</DialogTitle></DialogHeader>
          <p className="text-[14px] text-text-muted">Cada entrada desta compra é desfeita no estoque por um movimento de estorno. O histórico continua e a compra fica cancelada. Isso não pode ser desfeito.</p>
          <DialogFooter>
            <button type="button" className={btnClass('outline')} onClick={() => setAberto(false)}>Voltar</button>
            <button type="button" className={btnClass('danger')} onClick={confirmar} disabled={pending}>{pending && <Spinner />}Estornar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
