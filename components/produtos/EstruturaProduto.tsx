'use client'

import { useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Layers, Info, Trash2, Save, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { verEstrutura, salvarEstrutura, type EstruturaView, type ItemEstruturaInput } from '@/lib/actions/estrutura'
import { ProdutoSearch } from '@/components/produtos/ProdutoSearch'
import type { ProdutoBusca } from '@/lib/actions/produtos-search'
import { btnClass, btnLinhaClass, RotuloAcao } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { parseNumBR, formatNumBR } from '@/lib/num-br'

function fmtData(d: string | null): string {
  if (!d) return '-'
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d
}
function fmtQt(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 12 })
}

// Linha editável da ficha técnica. idMalha = null para componente novo.
type Linha = {
  idMalha: number | null
  idProdMalha: number
  codigo: string
  descricao: string
  unidade: string
  quantidade: string // texto cru (vírgula BR)
  perda: string
}

export function EstruturaProduto({
  codigoProduto,
  descricao,
  tipoItem,
  podeEditar = false,
}: {
  codigoProduto: number
  descricao: string
  tipoItem?: string | null
  podeEditar?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<EstruturaView | null>(null)
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [editando, setEditando] = useState(false)
  const [pending, startTransition] = useTransition()

  // Só produto acabado (04) ou em processo (03) tem ficha técnica (regra do Omie).
  const podeTerEstrutura = tipoItem === '04' || tipoItem === '03'
  const editavel = podeEditar && podeTerEstrutura

  function carregar() {
    startTransition(async () => {
      const res = await verEstrutura(codigoProduto)
      if ('error' in res) {
        toast.error('Erro', { description: res.error })
        return
      }
      setView(res.view)
      setLinhas(
        res.view.itens.map((i) => ({
          idMalha: i.idMalha,
          idProdMalha: i.idProdMalha,
          codigo: i.codigo,
          descricao: i.descricao,
          unidade: i.unidade,
          quantidade: formatNumBR(i.quantidade),
          perda: i.perda ? formatNumBR(i.perda) : '',
        }))
      )
    })
  }

  function abrir(aberto: boolean) {
    setOpen(aberto)
    setEditando(false)
    if (aberto && !view) carregar()
  }

  function adicionar(p: ProdutoBusca) {
    if (p.codigo_produto === codigoProduto) {
      toast.info('Um produto não entra na própria ficha técnica')
      return
    }
    if (linhas.some((l) => l.idProdMalha === p.codigo_produto)) {
      toast.info('Componente já está na ficha')
      return
    }
    setLinhas((prev) => [
      ...prev,
      { idMalha: null, idProdMalha: p.codigo_produto, codigo: p.codigo, descricao: p.descricao, unidade: p.unidade ?? '', quantidade: '1', perda: '' },
    ])
  }

  function remover(idProdMalha: number) {
    setLinhas((prev) => prev.filter((l) => l.idProdMalha !== idProdMalha))
  }
  function setQt(idProdMalha: number, v: string) {
    setLinhas((prev) => prev.map((l) => (l.idProdMalha === idProdMalha ? { ...l, quantidade: v } : l)))
  }
  function setPerda(idProdMalha: number, v: string) {
    setLinhas((prev) => prev.map((l) => (l.idProdMalha === idProdMalha ? { ...l, perda: v } : l)))
  }

  function salvar() {
    const itens: ItemEstruturaInput[] = []
    for (const l of linhas) {
      const q = parseNumBR(l.quantidade)
      if (q == null || !Number.isFinite(q) || q <= 0) {
        toast.error('Quantidade inválida', { description: l.descricao })
        return
      }
      const perda = l.perda ? parseNumBR(l.perda) ?? 0 : 0
      itens.push({ idMalha: l.idMalha, idProdMalha: l.idProdMalha, codigo: l.codigo, descricao: l.descricao, quantidade: q, perda })
    }
    startTransition(async () => {
      const res = await salvarEstrutura(codigoProduto, itens)
      if ('error' in res) {
        toast.error('Erro ao salvar no Omie', { description: res.error })
        return
      }
      toast.success('Ficha técnica salva no Omie', {
        description: `+${res.incluidos} incluído(s) · ~${res.alterados} alterado(s) · -${res.excluidos} removido(s)`,
      })
      setEditando(false)
      setView(null)
      carregar()
    })
  }

  const th = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted'

  return (
    <Dialog open={open} onOpenChange={abrir}>
      <DialogTrigger
        render={
          <button type="button" className={btnLinhaClass('ghost')} title="Ficha técnica" aria-label="Estrutura">
            <Layers className="size-4" /> <RotuloAcao>Estrutura</RotuloAcao>
          </button>
        }
      />
      <DialogContent className="overflow-hidden bg-surface p-0 sm:max-w-2xl" showCloseButton={false}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-semibold text-text">
              <Layers className="size-4 text-brand" /> Ficha técnica
            </div>
            <div className="mt-0.5 truncate text-[13px] text-text-muted">{descricao}</div>
          </div>
          {editavel && view && !editando && (
            <button type="button" onClick={() => setEditando(true)} className={btnClass('outline')}>
              <Pencil className="size-4" /> Editar
            </button>
          )}
        </div>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-4 py-4">
          {pending && !view && <div className="py-6 text-center text-sm text-text-muted">Carregando estrutura do Omie...</div>}

          {view && (
            <>
              {!editando && (
                <div className="flex items-start gap-2 rounded-md border border-border bg-surface-2/40 p-3 text-[12px] text-text-muted">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {editavel
                      ? 'Ficha técnica (malha) cadastrada no Omie. Clique em "Editar" para ajustar os componentes e quantidades.'
                      : podeTerEstrutura
                        ? 'Exibição em leitura. A edição precisa da permissão de editar produtos.'
                        : 'Só produto acabado ou em processo tem ficha técnica.'}
                  </span>
                </div>
              )}

              {/* COMPONENTES */}
              <div>
                <div className="mb-2 text-[13px] font-semibold text-text">Componentes ({linhas.length})</div>

                {editando && (
                  <div className="mb-3">
                    <ProdutoSearch onSelect={adicionar} codigosAdicionados={linhas.map((l) => l.codigo)} placeholder="Adicionar componente..." />
                  </div>
                )}

                {linhas.length === 0 ? (
                  <div className="rounded-md border border-border bg-surface p-4 text-[13px] text-text-muted">
                    {editando ? 'Adicione os componentes (insumos) que entram neste produto.' : 'Este produto não tem ficha técnica cadastrada no Omie.'}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-md border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-2">
                        <tr>
                          <th className={th}>Componente</th>
                          <th className={`${th} text-right`}>Qtde</th>
                          <th className={th}>Un.</th>
                          <th className={`${th} text-right`}>Perda %</th>
                          {editando && <th className={th} />}
                        </tr>
                      </thead>
                      <tbody>
                        {linhas.map((l) => (
                          <tr key={l.idProdMalha} className="border-t border-border/60 even:bg-surface-2/30">
                            <td className="px-3 py-2">
                              <div className="text-text">{l.descricao}</div>
                              <div className="num text-[11px] text-text-muted">{l.codigo}</div>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {editando ? (
                                <input
                                  value={l.quantidade}
                                  onChange={(e) => setQt(l.idProdMalha, e.target.value.replace(/[^\d.,]/g, ''))}
                                  inputMode="decimal"
                                  className="num w-20 rounded-md border border-border bg-surface px-2 py-1 text-right text-sm text-text outline-none focus:border-brand"
                                />
                              ) : (
                                <span className="num font-medium text-text">{fmtQt(parseNumBR(l.quantidade) ?? 0)}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-text-muted">{l.unidade}</td>
                            <td className="px-3 py-2 text-right">
                              {editando ? (
                                <input
                                  value={l.perda}
                                  onChange={(e) => setPerda(l.idProdMalha, e.target.value.replace(/[^\d.,]/g, ''))}
                                  inputMode="decimal"
                                  placeholder="0"
                                  className="num w-16 rounded-md border border-border bg-surface px-2 py-1 text-right text-sm text-text outline-none focus:border-brand"
                                />
                              ) : (
                                <span className="num text-text-muted">{l.perda ? fmtQt(parseNumBR(l.perda) ?? 0) : '-'}</span>
                              )}
                            </td>
                            {editando && (
                              <td className="px-2 py-2 text-right">
                                <button onClick={() => remover(l.idProdMalha)} className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-err" aria-label="Remover">
                                  <Trash2 className="size-4" />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* CONSUMO REAL (somente leitura, fora do modo edição) */}
              {!editando && view.consumoOP?.itens?.length ? (
                <div>
                  <div className="mb-2 text-[13px] font-semibold text-text">
                    Consumo na última produção
                    {view.consumoOP.numero && (
                      <span className="ml-2 font-normal text-text-muted">OP {view.consumoOP.numero} · {fmtData(view.consumoOP.data)}</span>
                    )}
                  </div>
                  <div className="overflow-hidden rounded-md border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-2">
                        <tr><th className={th}>Elemento consumido</th><th className={`${th} text-right`}>Qtde</th><th className={th}>Do estoque</th></tr>
                      </thead>
                      <tbody>
                        {view.consumoOP.itens.map((c, idx) => (
                          <tr key={idx} className="border-t border-border/60 even:bg-surface-2/30">
                            <td className="px-3 py-2 text-text">{c.descricao}</td>
                            <td className="px-3 py-2 text-right num font-medium text-text">{fmtQt(c.quantidade)}</td>
                            <td className="px-3 py-2 text-text-muted">{c.doEstoque ? 'Sim' : 'Não'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          {editando ? (
            <>
              <button type="button" onClick={() => { setEditando(false); carregar() }} disabled={pending} className={btnClass('outline')}>
                Cancelar
              </button>
              <button type="button" onClick={salvar} disabled={pending} className={btnClass('primary')}>
                {pending ? <Spinner /> : <Save className="size-4" />}
                {pending ? 'Salvando no Omie...' : 'Salvar no Omie'}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setOpen(false)} className={btnClass('outline')}>Fechar</button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
