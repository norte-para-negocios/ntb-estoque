// Ponto único de entrada da trava: TODO robô chama verificarTravaLocal antes de qualquer ação.
// Confere, nesta ordem: URL base local, .env.local (Supabase local + Omie bloqueado), variáveis exportadas no shell
// e o SERVIDOR que atende a porta 3107 (sonda por sessão, sem rota nova no ERP).
import { validarUrlBase, validarAmbienteLocal, validarAmbienteShell, nomeCookieSessao, montarCookieSessao, interpretarSonda, type Veredito, type SessaoGoTrue } from './trava-url.ts'
import { URL_ERP_PADRAO, lerEnvLocal, lerLoginsTeste, valorEnv } from './base.ts'

export type Sonda = { origemErp: string; urlSupabase: string; sessao: () => Promise<SessaoGoTrue> }

/** Manda ao ERP em execução uma sessão emitida pelo GoTrue local e vê se ele a aceita (redireciona o /login). */
export async function verificarServidor(s: Sonda): Promise<Veredito> {
  let cookie: string
  try {
    cookie = montarCookieSessao(nomeCookieSessao(s.urlSupabase), await s.sessao())
  } catch (e) {
    return { ok: false, motivo: `não consegui obter uma sessão do Supabase local para sondar o ERP: ${(e as Error).message}` }
  }
  try {
    const r = await fetch(`${s.origemErp}/login`, { redirect: 'manual', headers: { cookie }, signal: AbortSignal.timeout(60_000) })
    const v = interpretarSonda(r.status, r.headers.get('location'))
    return v.ok ? { ok: true, origem: s.origemErp } : v
  } catch (e) {
    return { ok: false, motivo: `o ERP em ${s.origemErp} não respondeu à sonda: ${(e as Error).message}` }
  }
}

export type OpcoesTrava = { urlBase?: string; env?: Record<string, string | undefined> }
export type ResultadoTrava = { ok: true; origem: string; envTexto: string } | { ok: false; motivo: string }

export async function verificarTravaLocal(raiz: string, op: OpcoesTrava = {}): Promise<ResultadoTrava> {
  const v = validarUrlBase(op.urlBase ?? process.env.ROBO_URL_BASE ?? URL_ERP_PADRAO)
  if (!v.ok) return v
  const envTexto = lerEnvLocal(raiz)
  if (envTexto === null) return { ok: false, motivo: '.env.local da cópia local não existe (rode scripts/local/local.sh subir)' }
  const va = validarAmbienteLocal(envTexto)
  if (!va.ok) return va
  const vs = validarAmbienteShell(op.env ?? process.env, envTexto)
  if (!vs.ok) return vs
  const anon = valorEnv(envTexto, 'NEXT_PUBLIC_SUPABASE_ANON_KEY')
  const login = (() => { try { return lerLoginsTeste(raiz)[0] } catch { return undefined } })()
  if (!anon || !login) return { ok: false, motivo: 'sem NEXT_PUBLIC_SUPABASE_ANON_KEY ou sem .local-data/logins.txt para sondar o servidor' }
  const sv = await verificarServidor({
    origemErp: v.origem,
    urlSupabase: va.origem,
    sessao: async () => {
      const r = await fetch(`${va.origem}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email: login.email, password: login.senha }), signal: AbortSignal.timeout(30_000) })
      if (!r.ok) throw new Error(`GoTrue local respondeu ${r.status}`)
      const j = (await r.json()) as SessaoGoTrue
      return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, expires_in: j.expires_in, token_type: j.token_type }
    },
  })
  if (!sv.ok) return sv
  return { ok: true, origem: v.origem, envTexto }
}
