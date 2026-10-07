import { CircleAlert, ShieldCheck } from 'lucide-react'
import type { ConferenciaCarregada } from '@/app/(app)/nota-fiscal/[id]/dados-proprio'

const ORIGEM: Record<string, string> = { sefaz: 'Recebida da SEFAZ automaticamente', xml: 'XML importado manualmente', manual: 'Lançada manualmente (sem XML)' }
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : null)

/** Substitui a linha do tempo de eventos do Omie: de onde a nota veio e o que a SEFAZ já confirmou. */
export function OrigemSefazNF({ info }: { info: ConferenciaCarregada }) {
  const { sefaz, documento } = info
  return (
    <section aria-label="Origem da nota" className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <h3 className="mb-3 text-[17px] font-semibold text-text">Origem da nota</h3>
      <dl className="grid gap-x-6 gap-y-2.5 text-[14px] sm:grid-cols-2">
        <div><dt className="text-[13px] text-text-muted">Como chegou</dt><dd className="text-text">{ORIGEM[sefaz.origem ?? 'sefaz'] ?? 'SEFAZ'}</dd></div>
        {sefaz.recebidoEm && <div><dt className="text-[13px] text-text-muted">Recebida em</dt><dd className="num text-text">{quando(sefaz.recebidoEm)}</dd></div>}
        {sefaz.nsu && !sefaz.nsu.startsWith('upload') && <div><dt className="text-[13px] text-text-muted">NSU da SEFAZ</dt><dd className="num text-text">{sefaz.nsu.replace(/^0+/, '') || '0'}</dd></div>}
        <div><dt className="text-[13px] text-text-muted">XML completo</dt><dd className="text-text">{sefaz.completo ? 'Sim' : 'Ainda não — só o resumo chegou'}</dd></div>
        {documento?.cienciaEm && <div><dt className="text-[13px] text-text-muted">Ciência da operação</dt><dd className="inline-flex items-center gap-1.5 text-text"><ShieldCheck className="size-4 text-ok" /><span className="num">{quando(documento.cienciaEm)}</span></dd></div>}
      </dl>
      {!sefaz.completo && <p className="mt-3 flex items-start gap-2 text-[13px] text-text-muted"><CircleAlert className="mt-0.5 size-4 shrink-0" />Os itens aparecem assim que a SEFAZ liberar o XML completo (depois da ciência da operação, na próxima consulta).</p>}
    </section>
  )
}
