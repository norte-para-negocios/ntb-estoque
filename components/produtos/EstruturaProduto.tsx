'use client'

import { useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Layers, Info, Trash2, Save, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { verEstrutura, salvarEstrutura, type EstruturaView, type ItemEstruturaInput } from '@/lib/actions/estrutura'
import { ProdutoSearch } from '@/components/produtos/ProdutoSearch'
import type { ProdutoBusca } from '@/lib/actions/produtos-search'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { parseNumBR, formatNumBR } from '@/lib/num-br'
import { useEstoqueProprio } from '@/components/estoque-proprio/ModoEstoque'
import { formatCustoUnit } from '@/lib/num-br'

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
  fator: string // fator de correção (so estoque proprio; vazio = 1)
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
  const proprio = useEstoqueProprio()
  const [open, setOpen] = useState(false)
  const [rendimento, setRendimento] = useState('1')
  const [expandir, setExpandir] = useState(false)
  const [view, setView] = useState<EstruturaView | null>(null)
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [editando, setEditando] = useState(false)
  const [pending, startTransition] = useTransition()

  // Só produto acabado (04) ou em processo (03) tem ficha técnica (regra do Omie); no estoque próprio também o intermediário (06).
  const podeTerEstrutura = tipoItem === '04' || tipoItem === '03' || (proprio && tipoItem === '06')
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
          fator: i.fatorCorrecao && i.fatorCorrecao !== 1 ? formatNumBR(i.fatorCorrecao) : '',
        }))
      )
      setRendimento(formatNumBR(res.view.rendimento ?? 1))
      setExpandir(res.view.expandirNaVenda ?? false)
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
      { idMalha: null, idProdMalha: p.codigo_produto, codigo: p.codigo, descricao: p.descricao, unidade: p.unidade ?? '', quantidade: '1', perda: '', fator: '' },
    ])
  }

  function remover(idProdMalha: number) {
    setLinhas((prev) => prev.filter((l) => l.idProdMalha !== idProdMalha))
  }
  function setQt(idProdMalha: number, v: string) {
    setLinhas((prev) => prev.map((l) => (l.idProdMalha === idProdMalha ? { ...l, quantidade: v } : l)))
  }
  function setFator(idProdMalha: number, v: string) {
    setLinhas((prev) => prev.map((l) => (l.idProdMalha === idProdMalha ? { ...l, fator: v } : l)))
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
      const fator = proprio && l.fator ? parseNumBR(l.fator) ?? 1 : 1
      if (proprio && !(fator > 0)) {
        toast.error('Fator de correção inválido', { description: l.descricao })
        return
      }
      itens.push({ idMalha: l.idMalha, idProdMalha: l.idProdMalha, codigo: l.codigo, descricao: l.descricao, quantidade: q, perda, fatorCorrecao: proprio ? fator : undefined })
    }
    const rend = proprio ? parseNumBR(rendimento) ?? 1 : undefined
    if (proprio && !(rend! > 0)) {
      toast.error('Rendimento inválido')
      return
    }
    startTransition(async () => {
      const res = await salvarEstrutura(codigoProduto, itens, proprio ? { rendimento: rend, expandirNaVenda: expandir } : undefined)
      if ('error' in res) {
        toast.error(proprio ? 'Erro ao salvar a ficha técnica' : 'Erro ao salvar no Omie', { description: res.error })
        return
      }
      toast.success(proprio ? 'Ficha técnica salva' : 'Ficha técnica salva no Omie', {
        description: `+${res.incluidos} incluído(s) · ~${res.alterados} alterado(s) · -${res.excluidos} removido(s)`,
      })
      setEditando(false)
      setView(null)
      carregar()
    })
  }

  const th = 'px-3 py-2 text-left text-[13px] font-semibold text-text-muted'

  return (
    <Dialog open={open} onOpenChange={abrir}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-text-muted u-motion u-press hover:bg-surface-2 hover:text-text"
            title="Ficha técnica"
            aria-label="Estrutura"
          >
            <Layers className="size-4" />
          </button>
        }
      />
      <DialogContent className="overflow-hidden bg-surface p-0 sm:max-w-2xl" showCloseButton={false}>
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-2">
          <div className="min-w-0">
            <div className="text-[20px] font-bold tracking-[-0.01em] text-text">
              Ficha técnica
            </div>
            <div className="mt-0.5 truncate text-[13px] text-text-muted">{descricao}</div>
          </div>
          {editavel && view && !editando && (
            <button type="button" onClick={() => setEditando(true)} className={btnClass('outline')}>
              <Pencil className="size-4" /> Editar
            </button>
          )}
        </div>

        <div className="max-h-[65vh] space-y-5 overflow-y-auto px-5 py-3">
          {pending && !view && <div className="py-6 text-center text-sm text-text-muted">{proprio ? 'Carregando ficha técnica...' : 'Carregando estrutura do Omie...'}</div>}

          {view && (
            <>
              {!editando && (
                <div className="flex items-start gap-2 rounded-[var(--r-md)] bg-surface-2 p-3 text-[13px] text-text-muted">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {editavel
                      ? proprio
                        ? `Ficha técnica${view.versao ? ` (versão ${view.versao})` : ''}. Clique em "Editar" para ajustar os componentes, quantidades, fator de correção e rendimento; cada edição gera uma versão nova.`
                        : 'Ficha técnica (malha) cadastrada no Omie. Clique em "Editar" para ajustar os componentes e quantidades.'
                      : podeTerEstrutura
                        ? 'Exibição em leitura. A edição precisa da permissão de editar produtos.'
                        : 'Só produto acabado ou em processo tem ficha técnica.'}
                  </span>
                </div>
              )}

              {proprio && (
                <div className="space-y-3 rounded-[var(--r-md)] bg-surface-2/50 p-3">
                  <div>
                    <label htmlFor="ficha-rendimento" className="text-[13px] font-semibold text-text-muted">Rendimento da receita</label>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-text">
                      {editando ? (
                        <input
                          id="ficha-rendimento"
                          value={rendimento}
                          onChange={(e) => setRendimento(e.target.value.replace(/[^\d.,]/g, ''))}
                          inputMode="decimal"
                          className="num w-28 shrink-0 rounded-[var(--r-md)] border-0 bg-surface-2 px-2 py-1.5 text-right text-sm text-text outline-none focus:ring-2 focus:ring-brand/40"
                        />
                      ) : (
                        <span className="num text-[15px] font-semibold">{rendimento}</span>
                      )}
                      <span className="shrink-0 font-medium text-text">{(view.produto?.unidade ?? '').toLowerCase()} por receita</span>
                    </div>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-text-muted">As quantidades dos componentes abaixo são para esse rendimento.</p>
                    {view.custoUnitario != null && !editando && (
                      <p className="mt-1 text-[12px] text-text-muted">Custo por {(view.produto?.unidade || 'unidade').toLowerCase()}: <span className="num font-medium text-text">{formatCustoUnit(view.custoUnitario)}</span> (pelo custo médio dos insumos)</p>
                    )}
                  </div>
                  <label className="flex items-start gap-2 border-t border-border/60 pt-3 text-[13px] text-text">
                    <input type="checkbox" checked={expandir} disabled={!editando} onChange={(e) => setExpandir(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" />
                    <span>Abrir na venda <span className="text-text-muted">(baixar os insumos direto, sem produzir antes)</span></span>
                  </label>
                </div>
              )}

              {/* COMPONENTES */}
              <div>
                <div className="mb-2 text-[17px] font-semibold text-text">Componentes ({linhas.length})</div>

                {editando && (
                  <div className="mb-3">
                    <ProdutoSearch onSelect={adicionar} codigosAdicionados={linhas.map((l) => l.codigo)} placeholder="Adicionar componente..." />
                  </div>
                )}

                {linhas.length === 0 ? (
                  <div className="rounded-[var(--r-md)] bg-surface-2 p-4 text-[13px] text-text-muted">
                    {editando ? 'Adicione os componentes (insumos) que entram neste produto.' : proprio ? 'Este produto não tem ficha técnica cadastrada.' : 'Este produto não tem ficha técnica cadastrada no Omie.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-[var(--r-md)] bg-surface-2/50">
                    <table className="w-full min-w-[420px] text-sm">
                      <thead>
                        <tr>
                          <th className={th}>Componente</th>
                          <th className={`${th} text-right`}>Qtde</th>
                          <th className={th}>Un.</th>
                          {proprio && <th className={`${th} text-right`} title="Fator de correção: quanto do insumo bruto vira líquido (ex.: peixe com espinha 1,3)">FC</th>}
                          <th className={`${th} text-right`}>Perda %</th>
                          {proprio && <th className={`${th} text-right`} title="Quantidade bruta que sai do estoque">Bruta</th>}
                          {editando && <th className={th} />}
                        </tr>
                      </thead>
                      <tbody>
                        {linhas.map((l) => (
                          <tr key={l.idProdMalha} className="border-t border-border/60">
                            <td className="px-3 py-2">
                              <div className="text-text">{l.descricao}</div>
                              <div className="num text-[12px] text-text-muted">{l.codigo}</div>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {editando ? (
                                <input
                                  value={l.quantidade}
                                  onChange={(e) => setQt(l.idProdMalha, e.target.value.replace(/[^\d.,]/g, ''))}
                                  inputMode="decimal"
                                  className="num w-20 rounded-[var(--r-md)] border-0 bg-surface-2 px-2 py-1 text-right text-sm text-text outline-none focus:ring-2 focus:ring-brand/40"
                                />
                              ) : (
                                <span className="num font-medium text-text">{fmtQt(parseNumBR(l.quantidade) ?? 0)}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-text-muted">{l.unidade}</td>
                            {proprio && (
                              <td className="px-3 py-2 text-right">
                                {editando ? (
                                  <input
                                    value={l.fator}
                                    onChange={(e) => setFator(l.idProdMalha, e.target.value.replace(/[^\d.,]/g, ''))}
                                    inputMode="decimal"
                                    placeholder="1"
                                    className="num w-16 rounded-[var(--r-md)] border-0 bg-surface-2 px-2 py-1 text-right text-sm text-text outline-none focus:ring-2 focus:ring-brand/40"
                                  />
                                ) : (
                                  <span className="num text-text-muted">{l.fator ? fmtQt(parseNumBR(l.fator) ?? 1) : '1'}</span>
                                )}
                              </td>
                            )}
                            <td className="px-3 py-2 text-right">
                              {editando ? (
                                <input
                                  value={l.perda}
                                  onChange={(e) => setPerda(l.idProdMalha, e.target.value.replace(/[^\d.,]/g, ''))}
                                  inputMode="decimal"
                                  placeholder="0"
                                  className="num w-16 rounded-[var(--r-md)] border-0 bg-surface-2 px-2 py-1 text-right text-sm text-text outline-none focus:ring-2 focus:ring-brand/40"
                                />
                              ) : (
                                <span className="num text-text-muted">{l.perda ? fmtQt(parseNumBR(l.perda) ?? 0) : '-'}</span>
                              )}
                            </td>
                            {proprio && (
                              <td className="px-3 py-2 text-right num font-medium text-text">
                                {fmtQt((parseNumBR(l.quantidade) ?? 0) * (l.fator ? parseNumBR(l.fator) ?? 1 : 1) * (1 + (l.perda ? parseNumBR(l.perda) ?? 0 : 0) / 100))}
                              </td>
                            )}
                            {editando && (
                              <td className="px-2 py-2 text-right">
                                <button onClick={() => remover(l.idProdMalha)} className="flex size-8 items-center justify-center rounded-full text-err u-motion u-press hover:bg-surface" aria-label="Remover">
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
                  <div className="mb-2 text-[17px] font-semibold text-text">
                    Consumo na última produção
                    {view.consumoOP.numero && (
                      <span className="ml-2 text-[13px] font-normal text-text-muted">OP {view.consumoOP.numero} · {fmtData(view.consumoOP.data)}</span>
                    )}
                  </div>
                  <div className="overflow-x-auto rounded-[var(--r-md)] bg-surface-2/50">
                    <table className="w-full min-w-[420px] text-sm">
                      <thead>
                        <tr><th className={th}>Elemento consumido</th><th className={`${th} text-right`}>Qtde</th><th className={th}>Do estoque</th></tr>
                      </thead>
                      <tbody>
                        {view.consumoOP.itens.map((c, idx) => (
                          <tr key={idx} className="border-t border-border/60">
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

        <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-3">
          {editando ? (
            <>
              <button type="button" onClick={() => { setEditando(false); carregar() }} disabled={pending} className={btnClass('outline')}>
                Cancelar
              </button>
              <button type="button" onClick={salvar} disabled={pending} className={btnClass('primary')}>
                {pending ? <Spinner /> : <Save className="size-4" />}
                {pending ? (proprio ? 'Salvando...' : 'Salvando no Omie...') : proprio ? 'Salvar ficha' : 'Salvar no Omie'}
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
