// Base comum dos robôs: portas da cópia local (fonte única), leitura do .env.local e dos logins de teste.
import fs from 'node:fs'
import path from 'node:path'

export const PORTA_ERP_LOCAL = 3107
export const PORTA_API_LOCAL = 54421
export const PORTA_PG_LOCAL = 54420
/** Origem do Supabase (PostgREST/GoTrue) da cópia local: a única que o navegador do robô pode alcançar além do ERP. */
export const ORIGEM_API_LOCAL = `http://127.0.0.1:${PORTA_API_LOCAL}`
export const URL_ERP_PADRAO = `http://127.0.0.1:${PORTA_ERP_LOCAL}`

/** Lê um valor de um texto .env (sem aspas). Ausente = null. */
export function valorEnv(env: string, chave: string): string | null {
  const m = env.match(new RegExp(`^${chave}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null
}

export function lerEnvLocal(raiz: string): string | null {
  const f = path.join(raiz, '.env.local')
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null
}

export type LoginTeste = { email: string; senha: string; loja: string; cargo: string }

/** Logins de teste de .local-data/logins.txt (linha: email senha loja=N cargo=X). */
export function lerLoginsTeste(raiz: string): LoginTeste[] {
  const out: LoginTeste[] = []
  for (const l of fs.readFileSync(path.join(raiz, '.local-data', 'logins.txt'), 'utf8').split('\n')) {
    const m = l.match(/^(\S+@ntb-teste\.local)\s+(\S+)\s+loja=(\d+)\s+cargo=(\w+)/)
    if (m) out.push({ email: m[1], senha: m[2], loja: m[3], cargo: m[4] })
  }
  return out
}
