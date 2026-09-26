'use client'

import { ItensNotaFiscal } from '@/components/nota-fiscal/ItensNotaFiscal'
import { FUNDO_CLASSE } from '@/lib/status-cor'
import type { DetalheNotaFiscal as DetalheNotaFiscalData } from '@/lib/actions/detalhe-movimento'

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, dia] = d.slice(0, 10).split('-')
  return `${dia}/${m}/${y}`
}

function fmtMoeda(n: number | null): string {
  // Number(n) e essencial: NF vinda do fallback frio (Contabo) tem n_valor_nfe
  // como numeric(20,6) -- o driver pg do servidor Contabo so normaliza bigint/date
  // (ver AGENTS.md), entao numeric chega como STRING em runtime apesar do tipo TS
  // dizer number. Sem o cast, toLocaleString cai no Object.prototype (ignora os
  // argumentos) e mostra o valor cru ("1234.56") em vez de "R$ 1.234,56".
  return n != null ? Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'
}

// Linha de lista agrupada (estilo Ajustes): rótulo à esquerda, valor à direita.
function Linha({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 px-4 py-2.5">
      <span className="shrink-0 text-[15px] text-text-muted">{label}</span>
      <span className="min-w-0 text-right text-[15px] text-text">{children}</span>
    </div>
  )
}

export function DetalheNotaFiscal({ dados }: { dados: DetalheNotaFiscalData }) {
  return (
    <div className="space-y-4">
      <div className="rounded-[var(--r-lg)] bg-surface-2 divide-y divide-border/60">
        <Linha label="NFe"><span className="num">{dados.numero ?? '-'}</span></Linha>
        <Linha label="Fornecedor">{dados.razaoSocial ?? '-'}</Linha>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text">
          <span className={`size-2 shrink-0 rounded-full ${FUNDO_CLASSE[dados.statusTom]}`} />
          {dados.statusLabel}
        </span>
        <span className="num text-[13px] text-text-muted">{fmtData(dados.dataEmissao)}</span>
        <span className="num text-[13px] font-semibold text-text">{fmtMoeda(dados.valor)}</span>
      </div>
      {dados.chaveNfe && (
        <div>
          <p className="mb-1.5 px-1 text-[13px] font-semibold text-text-muted">Chave de acesso</p>
          <p className="break-all rounded-[var(--r-lg)] bg-surface-2 px-4 py-3 font-mono text-[12px] text-text-muted">{dados.chaveNfe}</p>
        </div>
      )}
      <ItensNotaFiscal notaId={dados.id} itens={dados.itens} categorias={dados.categorias} />
    </div>
  )
}
