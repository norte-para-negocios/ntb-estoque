'use client'

import { useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Layers, Info } from 'lucide-react'
import { toast } from 'sonner'
import { verEstrutura, type EstruturaView } from '@/lib/actions/estrutura'
import { btnClass, btnLinhaClass, RotuloAcao } from '@/components/ui-kit/Button'

function fmtData(d: string | null): string {
  if (!d) return '-'
  // d vem como YYYY-MM-DD do banco
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d
}

function fmtQt(n: number): string {
  // Quantidade EXATA da malha/estrutura do Omie (sem arredondar a 3 casas).
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 12 })
}

export function EstruturaProduto({
  codigoProduto,
  descricao,
}: {
  codigoProduto: number
  descricao: string
}) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<EstruturaView | null>(null)
  const [pending, startTransition] = useTransition()

  function abrir(aberto: boolean) {
    setOpen(aberto)
    if (aberto && !view) {
      startTransition(async () => {
        const res = await verEstrutura(codigoProduto)
        if ('error' in res) {
          toast.error('Erro', { description: res.error })
          return
        }
        setView(res.view)
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={abrir}>
      <DialogTrigger
        render={
          <button type="button" className={btnLinhaClass('ghost')} title="Ver ficha técnica" aria-label="Estrutura">
            <Layers className="size-4" /> <RotuloAcao>Estrutura</RotuloAcao>
          </button>
        }
      />
      <DialogContent className="overflow-hidden bg-surface p-0 sm:max-w-2xl" showCloseButton={false}>
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-base font-semibold text-text">
            <Layers className="size-4 text-brand" /> Ficha técnica
          </div>
          <div className="mt-0.5 truncate text-[13px] text-text-muted">{descricao}</div>
        </div>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-4 py-4">
          {pending && !view && <div className="py-6 text-center text-sm text-text-muted">Carregando estrutura do Omie...</div>}

          {view && (
            <>
              {/* Aviso de leitura (regra: malha so se edita com o Ramon). */}
              <div className="flex items-start gap-2 rounded-md border border-border bg-surface-2/40 p-3 text-[12px] text-text-muted">
                <Info className="mt-0.5 size-4 shrink-0" />
                <span>
                  Exibição em leitura da malha cadastrada no Omie. A edição da ficha técnica será
                  liberada após validação com o responsável.
                </span>
              </div>

              {/* Componentes da estrutura (BOM) */}
              <div>
                <div className="mb-2 text-[13px] font-semibold text-text">
                  Componentes ({view.itens.length})
                </div>
                {view.semEstrutura ? (
                  <div className="rounded-md border border-border bg-surface p-4 text-[13px] text-text-muted">
                    Este produto não tem estrutura (ficha técnica) cadastrada no Omie.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-md border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-text-muted">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Cód.</th>
                          <th className="px-3 py-2 text-left font-semibold">Componente</th>
                          <th className="px-3 py-2 text-right font-semibold">Qtde</th>
                          <th className="px-3 py-2 text-left font-semibold">Un.</th>
                          <th className="px-3 py-2 text-right font-semibold">Perda %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {view.itens.map((i, idx) => (
                          <tr key={idx} className="border-t border-border/60 even:bg-surface-2/30">
                            <td className="px-3 py-2 num text-text-muted">{i.codigo}</td>
                            <td className="px-3 py-2">
                              <div className="text-text">{i.descricao}</div>
                              {i.familia && <div className="text-[11px] text-text-muted">{i.familia}</div>}
                            </td>
                            <td className="px-3 py-2 text-right num font-medium text-text">{fmtQt(i.quantidade)}</td>
                            <td className="px-3 py-2 text-text-muted">{i.unidade}</td>
                            <td className="px-3 py-2 text-right num text-text-muted">
                              {i.perda ? fmtQt(i.perda) : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Consumo real na ultima OP concluida */}
              <div>
                <div className="mb-2 text-[13px] font-semibold text-text">
                  Consumo na última produção
                  {view.consumoOP?.numero && (
                    <span className="ml-2 font-normal text-text-muted">
                      OP {view.consumoOP.numero} · {fmtData(view.consumoOP.data)}
                    </span>
                  )}
                </div>
                {view.consumoOP?.itens?.length ? (
                  <div className="overflow-hidden rounded-md border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-text-muted">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Cód.</th>
                          <th className="px-3 py-2 text-left font-semibold">Elemento consumido</th>
                          <th className="px-3 py-2 text-right font-semibold">Qtde</th>
                          <th className="px-3 py-2 text-left font-semibold">Do estoque</th>
                        </tr>
                      </thead>
                      <tbody>
                        {view.consumoOP.itens.map((c, idx) => (
                          <tr key={idx} className="border-t border-border/60 even:bg-surface-2/30">
                            <td className="px-3 py-2 num text-text-muted">{c.codigo}</td>
                            <td className="px-3 py-2 text-text">{c.descricao}</td>
                            <td className="px-3 py-2 text-right num font-medium text-text">{fmtQt(c.quantidade)}</td>
                            <td className="px-3 py-2 text-text-muted">{c.doEstoque ? 'Sim' : 'Não'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-md border border-border bg-surface p-4 text-[13px] text-text-muted">
                    Sem produção concluída registrada para este produto no período do banco.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end border-t border-border px-4 py-3">
          <button type="button" onClick={() => setOpen(false)} className={btnClass('outline')}>
            Fechar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
