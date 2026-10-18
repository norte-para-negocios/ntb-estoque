'use client'

// Manifestação do destinatário na SEFAZ (loja de estoque próprio, Fase B/R12). Mostra a ciência e a manifestação
// conclusiva; o envio só sai depois da caixa "Entendi que isto vai para a SEFAZ e não pode ser desfeito".
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Send, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { manifestarNotaSefaz } from '@/lib/actions/nota-fiscal-proprio'
import { MANIFESTACOES, validarJustificativa, type TipoManifestacao } from '@/lib/estoque/sefaz-manifestacao-tipos'

const EFEITO: Record<TipoManifestacao, string> = {
  '210200': 'Confirmar: você recebeu a mercadoria.',
  '210220': 'Desconhecer: esta compra não é sua.',
  '210240': 'Não realizada: a compra existiu mas a mercadoria não veio; diga o motivo.',
}
const fmtDataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export type ManifestacaoResumo = { tpEvento: string; status: string; cstat: string | null; xmotivo: string | null; protocolo: string | null; criadoEm: string; respondidoEm: string | null }

export function ManifestacaoNF({ notaId, ciencia, manifestacoes, temEntrada }: {
  notaId: number; ciencia: { em: string | null; cstat: string | null }; manifestacoes: ManifestacaoResumo[]; temEntrada: boolean
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [tipo, setTipo] = useState<TipoManifestacao>('210200')
  const [justificativa, setJustificativa] = useState('')
  const [entendi, setEntendi] = useState(false)
  const [pending, start] = useTransition()
  const conclusivas = manifestacoes.filter((m) => m.tpEvento !== '210210')
  const registrada = conclusivas.find((m) => m.status === 'registrada')
  const pendente = [...conclusivas].reverse().find((m) => m.status === 'incerta' || m.status === 'enviando')
  const negativa = registrada && registrada.tpEvento !== '210200'
  const erroJust = validarJustificativa(tipo, justificativa)

  function enviar() {
    start(async () => {
      const r = await manifestarNotaSefaz(notaId, tipo, MANIFESTACOES[tipo].exigeJustificativa ? justificativa : null)
      if ('error' in r) { toast.error('Manifestação não enviada', { description: r.error }); router.refresh(); return }
      if (r.status === 'registrada') toast.success('Manifestação registrada na SEFAZ', { description: `${r.cStat ?? ''} ${r.xMotivo ?? ''}`.trim() })
      else toast.error('A SEFAZ recusou a manifestação', { description: `${r.cStat ?? ''} ${r.xMotivo ?? ''}`.trim() })
      setAberto(false); setEntendi(false); router.refresh()
    })
  }

  return (
    <section className="space-y-3 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]" aria-label="Manifestação na SEFAZ">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 text-[14px]">
          <h3 className="text-[17px] font-semibold text-text">Manifestação na SEFAZ</h3>
          <p className="text-text-muted">Ciência da operação: {ciencia.em ? <span className="text-text">registrada em <span className="num">{fmtDataHora(ciencia.em)}</span>{ciencia.cstat ? ` (${ciencia.cstat})` : ''}</span> : 'ainda não'}</p>
          <p className="text-text-muted">Manifestação: {registrada
            ? <span className="text-text">{MANIFESTACOES[registrada.tpEvento as TipoManifestacao]?.rotulo ?? registrada.tpEvento} · <span className="num">{fmtDataHora(registrada.respondidoEm ?? registrada.criadoEm)}</span>{registrada.protocolo ? <> · protocolo <span className="num">{registrada.protocolo}</span></> : null}</span>
            : pendente ? <span className="text-warn">{MANIFESTACOES[pendente.tpEvento as TipoManifestacao]?.rotulo ?? pendente.tpEvento} sem resposta da SEFAZ — repita o envio</span>
            : 'nenhuma'}</p>
        </div>
        {!registrada && !aberto && (
          <button type="button" className={btnClass('outline')} onClick={() => { setAberto(true); if (pendente) setTipo(pendente.tpEvento as TipoManifestacao) }}>
            <ShieldCheck className="size-4" />Manifestar na SEFAZ
          </button>
        )}
      </div>
      {negativa && temEntrada && (
        <p className="rounded-[var(--r-md)] bg-warn/10 px-3 py-2 text-[13px] text-warn">A entrada desta nota continua no estoque. Se a mercadoria não chegou, use &quot;Desfazer entrada no estoque&quot;.</p>
      )}
      {aberto && !registrada && (
        <div className="space-y-3 rounded-[var(--r-md)] bg-surface-2 p-3 text-[14px]" role="dialog" aria-label="Enviar manifestação à SEFAZ">
          <fieldset className="space-y-2">
            {(Object.keys(MANIFESTACOES) as TipoManifestacao[]).map((t) => (
              <label key={t} className="flex items-start gap-2">
                <input type="radio" name="tipo-manifestacao" className="mt-1" checked={tipo === t} disabled={!!pendente && pendente.tpEvento !== t} onChange={() => setTipo(t)} />
                <span><span className="font-medium text-text">{MANIFESTACOES[t].rotulo}</span><br /><span className="text-[13px] text-text-muted">{EFEITO[t]}</span></span>
              </label>
            ))}
          </fieldset>
          {MANIFESTACOES[tipo].exigeJustificativa && (
            <label className="block space-y-1">
              <span className="font-medium text-text">Motivo (15 a 255 caracteres)</span>
              <textarea className="min-h-[64px] w-full rounded-[var(--r-md)] border border-[var(--border)] bg-surface px-3 py-2" maxLength={255} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
              {justificativa && erroJust && <span className="text-[12px] text-warn">{erroJust}</span>}
            </label>
          )}
          <label className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" className="mt-0.5 size-4" checked={entendi} onChange={(e) => setEntendi(e.target.checked)} />
            Entendi que isto vai para a SEFAZ e não pode ser desfeito
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className={btnClass('outline')} onClick={() => { setAberto(false); setEntendi(false) }} disabled={pending}>Cancelar</button>
            <button type="button" className={btnClass('primary')} onClick={enviar} disabled={pending || !entendi || !!erroJust}>{pending ? <Spinner /> : <Send className="size-4" />}Enviar à SEFAZ</button>
          </div>
        </div>
      )}
    </section>
  )
}
