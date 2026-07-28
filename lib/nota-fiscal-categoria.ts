import { valoresMulti } from '@/components/ui-kit/filtros-utils'

// Categorias semanticas de NF baseadas em keyword matching na natureza da operacao.
// 'venda' = tudo que nao e bonificacao/cupom/comodato/remessa/devolucao. Compartilhado
// entre a tela (nota-fiscal/page.tsx), o export (export/route.ts) e o PDF
// (relatorio/route.ts) -- antes vivia so na page e o export/relatorio ignoravam esse
// filtro silenciosamente (usuario filtrava "Venda" na tela e baixava tudo).
export const CATEGORIAS_NF = [
  { value: 'bonificacao', label: 'Bonificação / Brinde', keywords: ['BONIF', 'BRINDE', 'DOACAO', 'DOACÃO'] },
  { value: 'cupom', label: 'Cupom / NFC-e / ECF', keywords: ['CUPOM', 'ECF', 'NFC-E', 'NFC_E', 'NF VIA CUPOM'] },
  { value: 'comodato', label: 'Comodato', keywords: ['COMODATO'] },
  { value: 'remessa', label: 'Remessa', keywords: ['REMESSA'] },
  { value: 'devolucao', label: 'Devolução', keywords: ['DEVOL', 'RETORNO', 'RETORN'] },
  { value: 'venda', label: 'Venda (demais)', keywords: [] },
] as const
export type CategoriaKey = (typeof CATEGORIAS_NF)[number]['value']

// Monta a clausula .or() do PostgREST pro filtro de categoria (multi-select: uma linha
// entra se casar com QUALQUER categoria selecionada). Retorna null se nenhuma categoria
// valida foi selecionada (sem filtro).
export function resolverCategoriaOrClause(categoriaParam: string | undefined | null): string | null {
  const categoriaKeys = valoresMulti(categoriaParam ?? undefined).filter((v): v is CategoriaKey =>
    (CATEGORIAS_NF.map((c) => c.value) as string[]).includes(v),
  )
  if (!categoriaKeys.length) return null

  const todasOutrasKeywords = CATEGORIAS_NF.filter((c) => c.keywords.length > 0).flatMap((c) => c.keywords)
  const keywordsSelecionados = [
    ...new Set(
      categoriaKeys
        .filter((k) => k !== 'venda')
        .flatMap((k) => CATEGORIAS_NF.find((c) => c.value === k)?.keywords ?? []),
    ),
  ]
  const orParts = keywordsSelecionados.map((kw) => `c_natureza_operacao.ilike.%${kw}%`)
  if (categoriaKeys.includes('venda')) {
    const notParts = todasOutrasKeywords.map((kw) => `c_natureza_operacao.not.ilike.%${kw}%`)
    orParts.push(`and(${notParts.join(',')})`)
  }
  return orParts.length ? orParts.join(',') : null
}
