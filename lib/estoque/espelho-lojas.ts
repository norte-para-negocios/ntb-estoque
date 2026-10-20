// "Nosso Omie" Fase 1 (espelho completo): regras puras de quais lojas entram nos crons novos,
// relógio de Brasília (America/Bahia, sem horário de verão) e classificação de erro de limite do Omie.
// Sem imports: testado com node --test lib/estoque/espelho-lojas.test.ts.

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
})

/** Data (YYYY-MM-DD) e hora (0-23) na Bahia. O servidor roda em Europe/Berlin: nunca usar o fuso local. */
export function relogioBahia(agora: Date): { hoje: string; hora: number } {
  const p = Object.fromEntries(fmt.formatToParts(agora).map((x) => [x.type, x.value]))
  return { hoje: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) }
}

/** 00:00–06:59 na Bahia: a faxina do Mac usa a mesma chave do Omie da loja 5 de madrugada. */
export function janelaProibida(agora: Date): boolean {
  return relogioBahia(agora).hora < 7
}

export function addDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function isoParaBr(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

export type LojaCandidata = {
  id: number; ativo?: boolean | null; is_test: boolean; espelho_completo?: boolean | null
  modo_estoque?: string | null; omie_app_key?: string | null
}

/** Loja 4 (Sertão, produção protegida) nunca; loja de teste nunca; só modo Omie com a flag ligada. */
export function lojaPodeEspelhar(l: LojaCandidata): boolean {
  return l.id !== 4 && l.ativo !== false && l.is_test === false && l.espelho_completo === true
    && (l.modo_estoque ?? 'omie') === 'omie' && !!l.omie_app_key
}

/** Bloqueio/consumo redundante/requisição em andamento: parar a loja no ciclo, sem repetir. */
export function ehErroDeLimiteOmie(msg: string, faultCode: string | undefined): boolean {
  return faultCode === 'MISUSE_API_PROCESS'
    || /MISUSE|consumo indevido|bloquead|REDUNDANT|consumo redundante|j. existe uma requisi|too many requests|rate limit|HTTP 42[59]\b/i.test(msg)
}
