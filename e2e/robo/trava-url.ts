// Trava do robô: só roda contra a cópia local do ERP. Função pura, sem rede.
export const PORTA_ERP_LOCAL = 3107
export const PORTA_API_LOCAL = 54421
const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1'])

export type Veredito = { ok: true; origem: string } | { ok: false; motivo: string }

/** Aceita só http://localhost|127.0.0.1:3107. Qualquer outra coisa é recusada (produção incluída). */
export function validarUrlBase(url: string): Veredito {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { ok: false, motivo: `"${url}" não é uma URL válida; o robô só roda em endereço local` }
  }
  if (u.protocol !== 'http:') return { ok: false, motivo: `protocolo ${u.protocol} recusado: a cópia local é http://` }
  if (u.username || u.password) return { ok: false, motivo: 'URL com usuário/senha recusada' }
  if (!HOSTS_LOCAIS.has(u.hostname)) return { ok: false, motivo: `host "${u.hostname}" não é local (só localhost ou 127.0.0.1)` }
  if (u.port !== String(PORTA_ERP_LOCAL)) return { ok: false, motivo: `porta "${u.port || '(padrão)'}" não é a do ERP local (${PORTA_ERP_LOCAL})` }
  return { ok: true, origem: u.origin }
}

function valor(env: string, chave: string): string | null {
  const m = env.match(new RegExp(`^${chave}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null
}

/** Confere o .env.local do ERP: Supabase na porta local e Omie bloqueado. */
export function validarAmbienteLocal(envLocal: string): Veredito {
  const sb = valor(envLocal, 'NEXT_PUBLIC_SUPABASE_URL')
  if (sb !== `http://127.0.0.1:${PORTA_API_LOCAL}`) return { ok: false, motivo: `NEXT_PUBLIC_SUPABASE_URL (${sb ?? 'ausente'}) não é o stack local http://127.0.0.1:${PORTA_API_LOCAL}` }
  if (valor(envLocal, 'NTB_OMIE_BLOQUEADO') !== '1') return { ok: false, motivo: 'NTB_OMIE_BLOQUEADO=1 ausente no .env.local: o robô não roda sem a trava do Omie' }
  return { ok: true, origem: sb }
}
