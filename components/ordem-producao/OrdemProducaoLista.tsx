'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Check, Undo2, Factory } from 'lucide-react'
import { DataTable } from '@/components/ui-kit/DataTable'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { btnClass } from '@/components/ui-kit/Button'
import { OrdemProducaoRow, OrdemProducaoCard, type OPData } from '@/components/ordem-producao/OrdemProducaoRow'
import { finishOPsEmLote, reverterOPsEmLote } from '@/lib/actions/ordem-producao'

// Lista de OPs com selecao multipla + acoes em lote (Concluir/Reverter selecionadas).
// `cabecalhoDesktop`: as <th> de ordenacao ja montadas em page.tsx (Server Component,
// usa Link com href calculado a partir dos searchParams) -- passadas como children pra
// nao duplicar essa logica aqui; esse componente so acrescenta a coluna de checkbox.
export function OrdemProducaoLista({
  linhas,
  podeConcluir,
  podeReverter,
  cabecalhoDesktop,
}: {
  linhas: OPData[]
  podeConcluir: boolean
  podeReverter: boolean
  cabecalhoDesktop: ReactNode
}) {
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [pending, startTransition] = useTransition()

  const selecionaveis = linhas.filter((l) => (podeConcluir && !l.concluida) || (podeReverter && l.concluida))
  const temSelecao = selecionaveis.length > 0
  const todosMarcados = temSelecao && selecionaveis.every((l) => sel.has(l.id))
  const qtdConcluirSel = linhas.filter((l) => sel.has(l.id) && !l.concluida).length
  const qtdReverterSel = linhas.filter((l) => sel.has(l.id) && l.concluida).length

  function toggle(id: number) {
    setSel((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function toggleTodos() {
    setSel((s) =>
      selecionaveis.every((l) => s.has(l.id)) ? new Set() : new Set(selecionaveis.map((l) => l.id))
    )
  }

  function concluirSelecionadas() {
    const ids = linhas.filter((l) => sel.has(l.id) && !l.concluida).map((l) => l.id)
    if (!ids.length) return
    startTransition(async () => {
      const res = await finishOPsEmLote(ids)
      if (res.sucesso) toast.success(`${res.sucesso} OP(s) concluída(s) no Omie`)
      if (res.falhas.length) {
        toast.error(`${res.falhas.length} falharam ao concluir`, {
          description: `Entraram na fila de reenvio automático. ${res.falhas
            .slice(0, 3)
            .map((f) => f.error)
            .join('; ')}`,
          duration: 15000,
        })
      }
      setSel(new Set())
    })
  }

  function reverterSelecionadas() {
    const ids = linhas.filter((l) => sel.has(l.id) && l.concluida).map((l) => l.id)
    if (!ids.length) return
    if (
      !window.confirm(
        `Reverter a conclusão de ${ids.length} OP(s) no Omie? O estoque produzido será estornado em cada uma.`
      )
    )
      return
    startTransition(async () => {
      const res = await reverterOPsEmLote(ids)
      if (res.sucesso) toast.success(`${res.sucesso} OP(s) revertida(s) no Omie`)
      if (res.falhas.length) {
        toast.error(`${res.falhas.length} falharam ao reverter`, {
          description: res.falhas
            .slice(0, 3)
            .map((f) => f.error)
            .join('; '),
          duration: 15000,
        })
      }
      setSel(new Set())
    })
  }

  if (!linhas.length) {
    return <EmptyState icon={Factory} title="Nenhuma ordem de produção" hint="Sincronize com o Omie." />
  }

  return (
    <>
      {temSelecao && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {podeConcluir && (
            <button
              type="button"
              disabled={pending || qtdConcluirSel === 0}
              onClick={concluirSelecionadas}
              className={`${btnClass('outline')} disabled:opacity-50`}
            >
              <Check className="size-4" /> Concluir selecionadas{qtdConcluirSel ? ` (${qtdConcluirSel})` : ''}
            </button>
          )}
          {podeReverter && (
            <button
              type="button"
              disabled={pending || qtdReverterSel === 0}
              onClick={reverterSelecionadas}
              className={`${btnClass('outline')} disabled:opacity-50`}
            >
              <Undo2 className="size-4" /> Reverter selecionadas{qtdReverterSel ? ` (${qtdReverterSel})` : ''}
            </button>
          )}
        </div>
      )}

      {/* Desktop: tabela com steppers na linha */}
      <div className="hidden lg:block">
        <DataTable>
          <thead>
            <tr>
              {temSelecao && (
                <th className="w-8">
                  <input
                    type="checkbox"
                    checked={todosMarcados}
                    onChange={toggleTodos}
                    aria-label="Selecionar todas"
                    className="size-4 accent-[var(--brand)]"
                  />
                </th>
              )}
              {cabecalhoDesktop}
            </tr>
          </thead>
          <tbody>
            {linhas.map((op) => (
              <OrdemProducaoRow
                key={op.id}
                op={op}
                selecionavel={temSelecao && selecionaveis.some((s) => s.id === op.id)}
                selecionado={sel.has(op.id)}
                onToggleSelecionar={() => toggle(op.id)}
              />
            ))}
          </tbody>
        </DataTable>
      </div>
      {/* Mobile: lista compacta (extrato); edição no dialog "Editar" */}
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface lg:hidden">
        {linhas.map((op) => (
          <OrdemProducaoCard
            key={op.id}
            op={op}
            selecionavel={temSelecao && selecionaveis.some((s) => s.id === op.id)}
            selecionado={sel.has(op.id)}
            onToggleSelecionar={() => toggle(op.id)}
          />
        ))}
      </div>
    </>
  )
}
