// Histórico de processamento da nota de entrada (loja de estoque próprio, Fase B/F9): SEFAZ, conferência, estoque e
// manifestação numa linha do tempo. Leitura pela sessão (RLS por loja); nomes das pessoas em profiles.
import { createClient } from '@/lib/supabase/server'
import { montarHistoricoNF, type FontesHistorico } from '@/lib/estoque/nf-historico'

const TOM: Record<string, string> = { ok: 'bg-ok', warn: 'bg-warn', err: 'bg-err' }
const fmtDataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export async function HistoricoProcessamentoNF({ lojaId, chave, compraId, nomesLocais }: { lojaId: number; chave: string | null; compraId: number | null; nomesLocais?: Record<number, string> }) {
  const sb = await createClient()
  const [docs, evs, mans, canc] = await Promise.all([
    chave ? sb.from('sefaz_documentos').select('tipo, recebido_em, ciencia_em, ciencia_cstat, busca_chave_em, erro, ignorado').eq('loja_id', lojaId).eq('chave', chave).order('id') : Promise.resolve({ data: [] }),
    compraId ? sb.from('compras_proprio_eventos').select('tipo, linha, detalhe, user_id, criado_em').eq('loja_id', lojaId).eq('compra_id', compraId).order('id') : Promise.resolve({ data: [] }),
    chave ? sb.from('sefaz_manifestacoes').select('tp_evento, status, cstat, protocolo, user_id, criado_em, respondido_em').eq('loja_id', lojaId).eq('chave', chave).order('id') : Promise.resolve({ data: [] }),
    chave ? sb.from('sefaz_chaves_canceladas').select('recebido_em').eq('loja_id', lojaId).eq('chave', chave).maybeSingle() : Promise.resolve({ data: null }),
  ])
  type Ev = { tipo: string; linha: number | null; detalhe: Record<string, unknown> | null; user_id: string | null; criado_em: string }
  type Man = { tp_evento: string; status: string; cstat: string | null; protocolo: string | null; user_id: string | null; criado_em: string; respondido_em: string | null }
  const eventos = (evs.data ?? []) as Ev[]
  const manifestacoes = (mans.data ?? []) as Man[]
  const ids = [...new Set([...eventos, ...manifestacoes].map((x) => x.user_id).filter((x): x is string => !!x))]
  const nomes = new Map<string, string>()
  if (ids.length) {
    const { data } = await sb.from('profiles').select('id, name').in('id', ids)
    for (const p of data ?? []) if (p.name) nomes.set(String(p.id), String(p.name))
  }
  const autor = (u: string | null) => (u ? nomes.get(u) ?? null : null)
  const fontes: FontesHistorico = {
    documentos: (docs.data ?? []) as FontesHistorico['documentos'],
    eventos: eventos.map((e) => ({ tipo: e.tipo, linha: e.linha, detalhe: e.detalhe, autor: autor(e.user_id), criado_em: e.criado_em })),
    manifestacoes: manifestacoes.map((m) => ({ tp_evento: m.tp_evento, status: m.status, cstat: m.cstat, protocolo: m.protocolo, autor: autor(m.user_id), criado_em: m.criado_em, respondido_em: m.respondido_em })),
    canceladaEm: (canc.data as { recebido_em?: string } | null)?.recebido_em ?? null,
    nomesLocais,
  }
  const historico = montarHistoricoNF(fontes)
  if (!historico.length) return null
  return (
    <section className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]" aria-label="Histórico de processamento">
      <h3 className="mb-3 text-[17px] font-semibold text-text">Histórico de processamento</h3>
      <ol className="space-y-2.5">
        {historico.map((h, i) => (
          <li key={i} className="flex gap-3 text-[14px]">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${h.tom ? TOM[h.tom] : 'bg-text-muted/40'}`} aria-hidden />
            <div className="min-w-0">
              <p className="text-text">{h.texto}</p>
              {h.detalhe && <p className="text-[13px] text-text-muted">{h.detalhe}</p>}
              <p className="num text-[12px] text-text-muted">{fmtDataHora(h.ts)}{h.autor ? ` · ${h.autor}` : ''}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
