// Financeiro A0: quais lojas entram no espelho do financeiro do Omie. Regra própria (não exige espelho_completo):
// loja real (is_test = false), ativa, modo_estoque 'omie', com chave do Omie e NUNCA a loja 4 (Sertão).
// Puro: node --test lib/financeiro-omie/lojas.test.ts.
import type { LojaCandidata } from '../estoque/espelho-lojas.ts'

export const LOJA_PROIBIDA = 4
/** Fora da carga pela API por padrão: a 7 (distribuidora) não usa o financeiro e a chave dela não responde. */
export const LOJAS_FORA_DA_API_PADRAO = [7]

export function lojaPodeEspelharFinanceiro(l: LojaCandidata): boolean {
  return l.id !== LOJA_PROIBIDA && l.ativo !== false && l.is_test === false
    && (l.modo_estoque ?? 'omie') === 'omie' && !!l.omie_app_key
}

/** "2,3, 5" → {2,3,5}; vazio/indefinido → null (sem filtro). */
export function listaDeLojas(env: string | undefined | null): Set<number> | null {
  if (env == null || !env.trim()) return null
  return new Set(env.split(/[,\s]+/).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))
}

/**
 * Lojas de cada parte, a partir das que passam na regra:
 *  - avisos (webhooks): todas as permitidas, ou só as de OMIE_FIN_LOJAS se definida;
 *  - API: as mesmas menos OMIE_FIN_API_FORA (padrão: 7).
 * A loja 4 nunca entra, mesmo listada.
 */
export function lojasDoFinanceiro<T extends LojaCandidata>(
  lojas: T[], env: { OMIE_FIN_LOJAS?: string; OMIE_FIN_API_FORA?: string } = {},
): { avisos: T[]; api: T[] } {
  const so = listaDeLojas(env.OMIE_FIN_LOJAS)
  const fora = listaDeLojas(env.OMIE_FIN_API_FORA) ?? new Set(LOJAS_FORA_DA_API_PADRAO)
  const avisos = lojas.filter((l) => lojaPodeEspelharFinanceiro(l) && (!so || so.has(l.id)))
  return { avisos, api: avisos.filter((l) => !fora.has(l.id)) }
}
