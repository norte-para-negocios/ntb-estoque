// Autor e origem de um ajuste de estoque do Omie (ListarAjusteEstoque), derivados de obs e cod_int_ajuste.
// "nosso Omie" Fase 1: colunas movimentos.autor / origem_ajuste / cod_int_ajuste (migration 160).
// Puro, sem imports: node --test lib/estoque/ajuste-autor.test.ts.

export type OrigemAjuste = 'app' | 'script' | 'pdv' | 'api' | 'omie'

/** "… NTB Estoque · Nome | extra" → Nome; "Usuário:Nome" → Nome; sem marca → null. */
export function autorDoAjuste(obs: string | null | undefined): string | null {
  const t = (obs ?? '').trim()
  const app = t.match(/NTB Estoque\s*·\s*([^|]+)/)
  if (app) return app[1].trim() || null
  const usu = t.match(/Usu[aá]rio\s*:\s*([^|·\n]+)/i)
  if (usu) return usu[1].trim() || null
  return null
}

/**
 * Quem lançou: app (ITEMnnnn/MOV-n ou carimbo "NTB Estoque"), script (FPI-/SEED-/CORTE-), PDV, outra integração
 * (imp_api = S) ou a própria tela do Omie (resto). Script vem antes do carimbo: os scripts da faxina também carimbam.
 */
export function origemDoAjuste(a: { obs?: string | null; cod_int_ajuste?: string | null; origem?: string | null; imp_api?: string | null }): OrigemAjuste {
  const cod = (a.cod_int_ajuste ?? '').trim()
  if (/^(FPI|SEED|CORTE)-/i.test(cod)) return 'script'
  if (/^(ITEM\d|MOV-)/i.test(cod) || /NTB Estoque/.test(a.obs ?? '')) return 'app'
  if (a.origem === 'PDV') return 'pdv'
  if (a.imp_api === 'S') return 'api'
  return 'omie'
}
