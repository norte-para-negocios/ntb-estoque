// Trava do robô: só roda contra a cópia local do ERP. Função pura, sem rede.
import { PORTA_ERP_LOCAL, PORTA_API_LOCAL, valorEnv } from './base.ts'
export { PORTA_ERP_LOCAL, PORTA_API_LOCAL, valorEnv }
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

/** Confere o .env.local do ERP: Supabase na porta local e Omie bloqueado. */
export function validarAmbienteLocal(envLocal: string): Veredito {
  const sb = valorEnv(envLocal, 'NEXT_PUBLIC_SUPABASE_URL')
  if (sb !== `http://127.0.0.1:${PORTA_API_LOCAL}`) return { ok: false, motivo: `NEXT_PUBLIC_SUPABASE_URL (${sb ?? 'ausente'}) não é o stack local http://127.0.0.1:${PORTA_API_LOCAL}` }
  if (valorEnv(envLocal, 'NTB_OMIE_BLOQUEADO') !== '1') return { ok: false, motivo: 'NTB_OMIE_BLOQUEADO=1 ausente no .env.local: o robô não roda sem a trava do Omie' }
  return { ok: true, origem: sb }
}

// ---- Ambiente exportado no shell e sonda do servidor em execução ----
const VARS_SOBREPOSTAS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL', 'NTB_FRIO_API_URL']

/**
 * Variável exportada no shell vence o .env.local no Next. Se existir e for diferente do que o .env.local diz
 * (ou, no caso do Omie, diferente de 1), a cópia pode estar apontando para outro lugar: recusa.
 * ANTHROPIC_API_KEY presente também é recusada (o robô nunca deve chamar a IA).
 */
export function validarAmbienteShell(env: Record<string, string | undefined>, envLocal: string): Veredito {
  for (const k of VARS_SOBREPOSTAS) {
    const sh = env[k]
    if (sh === undefined || sh === '') continue
    const arq = valorEnv(envLocal, k)
    if (sh !== arq) return { ok: false, motivo: `${k} exportada no shell difere do .env.local e sobrepõe o arquivo (desfaça com "unset ${k}" e reinicie o ERP da porta ${PORTA_ERP_LOCAL})` }
  }
  if (env.NTB_OMIE_BLOQUEADO !== undefined && env.NTB_OMIE_BLOQUEADO !== '1') return { ok: false, motivo: `NTB_OMIE_BLOQUEADO="${env.NTB_OMIE_BLOQUEADO}" exportada no shell (precisa ser 1): a trava do Omie estaria desligada` }
  if (env.ANTHROPIC_API_KEY) return { ok: false, motivo: 'ANTHROPIC_API_KEY presente no ambiente: o robô não roda com chave de IA exportada (faça "unset ANTHROPIC_API_KEY")' }
  return { ok: true, origem: 'shell' }
}

/** Nome do cookie de sessão que o @supabase/ssr usa: sb-<primeiro rótulo do host>-auth-token. */
export function nomeCookieSessao(urlSupabase: string): string {
  return `sb-${new URL(urlSupabase).hostname.split('.')[0]}-auth-token`
}

export type SessaoGoTrue = { access_token: string; refresh_token: string; expires_at: number; expires_in: number; token_type: string }

/** Cabeçalho Cookie com a sessão no formato do @supabase/ssr (base64- + JSON base64url; pedaços .N acima de 3180). */
export function montarCookieSessao(nome: string, s: SessaoGoTrue): string {
  const enc = 'base64-' + Buffer.from(JSON.stringify(s)).toString('base64url')
  const pedacos = enc.match(/.{1,3180}/g) ?? [enc]
  return pedacos.length === 1 ? `${nome}=${enc}` : pedacos.map((p, i) => `${nome}.${i}=${p}`).join('; ')
}

/**
 * O /login do ERP redireciona quem tem sessão válida. Mandamos um token emitido pelo GoTrue LOCAL: se o servidor
 * redirecionar, ele leu o cookie do host local e o GoTrue dele aceitou o token (mesmo segredo). Qualquer outro Supabase recusaria.
 */
export function interpretarSonda(status: number, location: string | null): Veredito {
  if (status >= 300 && status < 400 && location && !/\/login(\?|$)/.test(new URL(location, 'http://x').pathname + new URL(location, 'http://x').search)) return { ok: true, origem: 'servidor' }
  return { ok: false, motivo: `o ERP da porta ${PORTA_ERP_LOCAL} não aceitou a sessão emitida pelo Supabase local (status ${status}): ele provavelmente usa outro Supabase (NEXT_PUBLIC_SUPABASE_URL diferente do .env.local). Reinicie o ERP com o .env.local da cópia local` }
}
