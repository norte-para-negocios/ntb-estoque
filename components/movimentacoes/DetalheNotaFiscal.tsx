'use client'

import { ItensNotaFiscal } from '@/components/nota-fiscal/ItensNotaFiscal'
import { SELO_CLASSE } from '@/lib/status-cor'
import type { DetalheNotaFiscal as DetalheNotaFiscalData } from '@/lib/actions/detalhe-movimento'

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, dia] = d.slice(0, 10).split('-')
  return `${dia}/${m}/${y}`
}

function fmtMoeda(n: number | null): string {
  return n != null ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'
}

export function DetalheNotaFiscal({ dados }: { dados: DetalheNotaFiscalData }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">NFe</p>
        <p className="text-sm text-text">{dados.numero ?? '-'}</p>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Fornecedor</p>
        <p className="text-sm text-text">{dados.razaoSocial ?? '-'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${SELO_CLASSE[dados.statusTom]}`}>
          {dados.statusLabel}
        </span>
        <span className="text-[13px] text-text-muted">{fmtData(dados.dataEmissao)}</span>
        <span className="num text-[13px] font-semibold text-text">{fmtMoeda(dados.valor)}</span>
      </div>
      {dados.chaveNfe && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Chave de acesso</p>
          <p className="num break-all text-[12px] text-text-muted">{dados.chaveNfe}</p>
        </div>
      )}
      <ItensNotaFiscal notaId={dados.id} itens={dados.itens} categorias={dados.categorias} />
    </div>
  )
}
