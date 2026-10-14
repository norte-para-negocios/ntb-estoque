import Link from 'next/link'
import { Info } from 'lucide-react'
import { TabelaMovimentos } from '@/components/movimentacoes/TabelaMovimentos'
import { movimentosDaNota } from '@/lib/movimentacoes/dados'

/**
 * Página da nota (loja Omie): as entradas de estoque que a nota gerou. Loja com espelho completo = kardex do Omie
 * (origem nota, mesmo número, produtos da nota); sem ele, a entrada de cada item pela própria nota.
 */
export async function MovimentosDaNota({
  lojaId, numero, emissao, concluida, itens,
}: {
  lojaId: number
  numero: string | null
  emissao: string | null
  concluida: boolean
  itens: { n_id_produto: number; codigo_local_estoque: number | null; quantidade: number }[]
}) {
  const r = await movimentosDaNota(lojaId, { numero, emissao }, itens)
  const ver = numero && emissao ? `/movimentacoes?doc=${encodeURIComponent(numero)}&data_inicio=${emissao.slice(0, 10)}` : null
  return (
    <div className="space-y-3 rounded-[var(--r-lg)] bg-surface p-5 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[17px] font-semibold text-text">Movimentos de estoque desta nota</h2>
        {ver && <Link href={ver} className="text-[13px] text-brand hover:underline">ver em Movimentações</Link>}
      </div>
      <p className="flex items-start gap-2 text-[13px] text-text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0 text-brand" />
        {r.fonte === 'kardex'
          ? 'Kardex do Omie: as entradas que esta nota lançou, com custo e saldo depois de cada uma.'
          : concluida
            ? 'Entrada de cada item pela própria nota (quantidade e unidade da nota, local do item). O kardex do Omie aparece aqui quando o espelho completo for ligado nesta loja.'
            : 'Nota ainda não concluída: o estoque só muda quando o recebimento for concluído. Abaixo, o que ela vai lançar.'}
      </p>
      <TabelaMovimentos linhas={r.linhas} comSaldo={r.fonte === 'kardex'} vazio={{ title: 'Sem itens de estoque', hint: 'Nenhum item desta nota está ligado a um produto do cadastro.' }} />
    </div>
  )
}
