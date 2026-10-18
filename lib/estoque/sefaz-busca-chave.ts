// Nota pela chave digitada (Fase B, A4/R14): tudo o que impede a consulta na SEFAZ, decidido ANTES de gravar a tentativa
// ou consultar. Respeita a espera da SEFAZ da loja (sefaz_nsu.bloqueado_ate, gravada por 137/656 — Global Constraints:
// "Respeitar 137/656 = esperar 1 h"), recusa loja de teste (nunca fala com a SEFAZ, como a manifestação) e loja inativa.
// Puro: `node --test lib/estoque/sefaz-busca-chave.test.ts`.
// @ts-ignore: o import com extensão .ts é exigido pelo node --test (type stripping); o tsc do Next não o aceita
import { dvChave, validarChave } from './nfe-xml.ts'

export const ESPERA_BUSCA_CHAVE_MS = 60 * 60 * 1000

export type LojaBuscaChave = { modo_estoque: string | null; ativo: boolean | null; is_test: boolean | null; cnpj: string | null; certificado_path: string | null }

const horaBahia = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' })

export function prechecarBuscaPorChave(e: {
  chave: string; loja: LojaBuscaChave | null; nsu: { bloqueado_ate: string | null } | null; tentativa: { ultima_em: string | null } | null; agora: number
}): { ok: true; chave: string; cnpj: string } | { error: string } {
  const ch = (e.chave ?? '').replace(/\D/g, '')
  if (!validarChave(ch) || dvChave(ch.slice(0, 43)) !== Number(ch[43])) return { error: 'Chave de acesso inválida (confira os 44 dígitos).' }
  if (ch.slice(20, 22) !== '55') return { error: 'Só NF-e (modelo 55) pode ser buscada pela chave.' }
  const l = e.loja
  if (!l || l.modo_estoque !== 'proprio') return { error: 'A loja não usa estoque próprio.' }
  if (l.is_test) return { error: 'Loja de teste não consulta a SEFAZ.' }
  if (!l.ativo) return { error: 'Loja inativa.' }
  const cnpj = String(l.cnpj ?? '').replace(/\D/g, '')
  if (cnpj.length !== 14) return { error: 'A loja precisa de um CNPJ válido para consultar a SEFAZ.' }
  if (ch.slice(6, 20) === cnpj) return { error: 'Esta nota foi emitida pela própria loja.' }
  if (!l.certificado_path) return { error: 'A loja não tem certificado digital cadastrado.' }
  const bloq = e.nsu?.bloqueado_ate ? new Date(e.nsu.bloqueado_ate).getTime() : 0
  if (bloq > e.agora) return { error: `A SEFAZ pediu para esperar antes de consultar de novo: tente depois das ${horaBahia(bloq)}.` }
  const ult = e.tentativa?.ultima_em ? new Date(e.tentativa.ultima_em).getTime() : 0
  if (ult && e.agora - ult < ESPERA_BUSCA_CHAVE_MS) return { error: 'Esta chave já foi consultada há menos de 1 hora.' }
  return { ok: true, chave: ch, cnpj }
}
