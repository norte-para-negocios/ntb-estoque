// Dicionário de CFOP (Código Fiscal de Operações e Prestações) para a auditoria
// fiscal das compras. Os CFOPs de ENTRADA (que a empresa lança) começam com:
//   1 = mesma UF · 2 = outra UF · 3 = exterior
// O sufixo (3 últimos dígitos) define a natureza; ele é igual entre 1/2/3.
// Categorias agregam o sufixo para o Ramon enxergar o que credita/estoca vs
// uso/consumo, ativo, bonificação, etc.

export type CategoriaCFOP =
  | 'Comercialização/Indústria'
  | 'Uso/consumo'
  | 'Ativo imobilizado'
  | 'Bonificação/Comodato'
  | 'Devolução'
  | 'Outros'

// Sufixo (3 dígitos) -> { descrição curta, categoria }. Cobre os vistos nas NFs
// da NTB + os mais comuns de entrada.
const SUFIXOS: Record<string, { desc: string; cat: CategoriaCFOP }> = {
  '101': { desc: 'Compra para industrialização', cat: 'Comercialização/Indústria' },
  '102': { desc: 'Compra para comercialização', cat: 'Comercialização/Indústria' },
  '111': { desc: 'Compra p/ industrialização (conta e ordem)', cat: 'Comercialização/Indústria' },
  '116': { desc: 'Compra p/ industrialização (de encomenda)', cat: 'Comercialização/Indústria' },
  '118': { desc: 'Compra p/ comercialização (de encomenda)', cat: 'Comercialização/Indústria' },
  '401': { desc: 'Compra p/ industrialização (com ST)', cat: 'Comercialização/Indústria' },
  '403': { desc: 'Compra p/ comercialização (com ST)', cat: 'Comercialização/Indústria' },
  '406': { desc: 'Compra de ativo imobilizado (com ST)', cat: 'Ativo imobilizado' },
  '407': { desc: 'Compra p/ uso/consumo (merc. com ST)', cat: 'Uso/consumo' },
  '551': { desc: 'Compra de bem para o ativo imobilizado', cat: 'Ativo imobilizado' },
  '556': { desc: 'Compra de material para uso/consumo', cat: 'Uso/consumo' },
  '557': { desc: 'Transferência de material p/ uso/consumo', cat: 'Uso/consumo' },
  '651': { desc: 'Compra de combustível/lubrificante p/ industrialização', cat: 'Comercialização/Indústria' },
  '652': { desc: 'Compra de combustível/lubrificante p/ comercialização', cat: 'Comercialização/Indústria' },
  '653': { desc: 'Compra de combustível/lubrificante p/ consumo', cat: 'Uso/consumo' },
  '908': { desc: 'Entrada de bem por comodato/locação', cat: 'Bonificação/Comodato' },
  '910': { desc: 'Entrada de bonificação, doação ou brinde', cat: 'Bonificação/Comodato' },
  '911': { desc: 'Entrada de amostra grátis', cat: 'Bonificação/Comodato' },
  '917': { desc: 'Entrada de merc. em consignação', cat: 'Bonificação/Comodato' },
  '202': { desc: 'Devolução de venda p/ comercialização', cat: 'Devolução' },
  '411': { desc: 'Devolução de venda (com ST)', cat: 'Devolução' },
  '949': { desc: 'Outra entrada não especificada', cat: 'Outros' },
}

const UF: Record<string, string> = { '1': 'mesma UF', '2': 'outra UF', '3': 'exterior' }

export function descreverCFOP(cfop: string | null | undefined): { codigo: string; desc: string; cat: CategoriaCFOP; uf: string } {
  const codigo = (cfop ?? '').trim()
  const so = codigo.replace(/\D/g, '') // "1.556" -> "1556"
  const prefixo = so.charAt(0)
  const sufixo = so.slice(-3)
  const base = SUFIXOS[sufixo]
  return {
    codigo: codigo || '—',
    desc: base?.desc ?? 'CFOP não catalogado',
    cat: base?.cat ?? 'Outros',
    uf: UF[prefixo] ?? '',
  }
}

// Cor (token semântico) por categoria, para o badge na tela.
export const CAT_COR: Record<CategoriaCFOP, string> = {
  'Comercialização/Indústria': 'text-ok',
  'Uso/consumo': 'text-warn',
  'Ativo imobilizado': 'text-info',
  'Bonificação/Comodato': 'text-text-muted',
  Devolução: 'text-text-muted',
  Outros: 'text-text-muted',
}
