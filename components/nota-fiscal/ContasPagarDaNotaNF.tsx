import Link from 'next/link'
import { CircleAlert } from 'lucide-react'
import type { TituloNota } from '@/lib/financeiro/consultas'
import { planoParcelasDaNota, resumoTitulosDaNota, rotuloCategoria } from '@/lib/financeiro/titulos-da-nota-puro'
import { situacaoTitulo } from '@/lib/financeiro/titulo-puro'
import { SituacaoSelo } from '@/components/financeiro/comum'
import { GerarContasNotaBotao } from './GerarContasNotaBotao'

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dmy = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

/** Fase 4 (migration 340), SÓ DESENVOLVEDOR: as contas a pagar geradas por esta nota (uma por duplicata do XML). Antes da
 *  entrada, mostra a prévia do que será gerado. Nota desfeita com parcela paga: aviso, nada é apagado. */
export function ContasPagarDaNotaNF({ notaId, titulos, falha, statusCompra, fullObject, valorTotal, emissao, hoje, podeGerar, semMigration }: {
  notaId: number; titulos: TituloNota[]; falha: string | null; statusCompra: string | null; fullObject: unknown
  valorTotal: number | null; emissao: string | null; hoje: string; podeGerar: boolean; semMigration: boolean
}) {
  if (semMigration) {
    return <p className="text-[13px] text-text-muted">A conta a pagar gerada pela nota ainda não foi ativada nesta instalação (migration 340).</p>
  }
  const r = resumoTitulosDaNota(titulos, statusCompra, falha)
  const entrou = statusCompra === 'lancada' || statusCompra === 'parcial'
  const plano = planoParcelasDaNota(fullObject, valorTotal, emissao, hoje)
  return (
    <section aria-label="Contas a pagar da nota" className="space-y-3 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="flex-1 text-[17px] font-semibold text-text">Contas a pagar desta nota</h3>
        {podeGerar && entrou && !r.ativos.length && <GerarContasNotaBotao notaId={notaId} />}
      </div>
      {r.aviso && <p className="flex items-start gap-2 rounded-[var(--r-md)] bg-surface-2 p-3 text-[13px] text-text"><CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" />{r.aviso}</p>}
      {r.ativos.length > 0 ? (
        <ul className="divide-y divide-border text-[14px]">
          {r.ativos.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <Link href={`/financeiro/contas-pagar/${t.id}`} className="font-medium text-text hover:underline">Nº {t.numero}</Link>
              <span className="text-text-muted">Parcela {t.parcela}/{t.total_parcelas}</span>
              <span className="num text-text-muted">vence {dmy(t.data_vencimento)}</span>
              <span className="text-text-muted">{rotuloCategoria(t.categoria_nome)}</span>
              <span className="num ml-auto font-semibold text-text">{brl(t.valor)}</span>
              <SituacaoSelo situacao={situacaoTitulo(t.status, t.data_vencimento, hoje)} />
            </li>
          ))}
        </ul>
      ) : !entrou && plano.parcelas.length > 0 ? (
        <p className="text-[13px] text-text-muted">
          Ao confirmar a entrada, {plano.parcelas.length === 1 ? 'será gerada 1 conta a pagar' : `serão geradas ${plano.parcelas.length} contas a pagar`}:{' '}
          {plano.parcelas.map((p) => `${brl(p.valorCent / 100)} em ${dmy(p.vencimento)}`).join(' · ')}
          {plano.regra === 'sem_duplicata' && ' (a nota não traz duplicatas: à vista, vence na emissão)'}.
        </p>
      ) : !r.aviso ? (
        <p className="text-[13px] text-text-muted">Sem conta a pagar para esta nota.</p>
      ) : null}
      {r.cancelados.length > 0 && (
        <p className="text-[13px] text-text-muted">{r.cancelados.length === 1 ? '1 conta cancelada' : `${r.cancelados.length} contas canceladas`} desta nota (entrada desfeita ou nota cancelada) continuam no histórico do contas a pagar.</p>
      )}
    </section>
  )
}
