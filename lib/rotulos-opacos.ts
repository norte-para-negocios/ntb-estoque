// Tradução central dos rótulos "opacos" que aparecem nos relatórios quando o
// dado de origem não tem classificação. Cada um ganha nome claro + o motivo
// (vira tooltip). null = rotulo normal, exibe como veio.
const MAPA: Record<string, { label: string; motivo: string }> = {
  'Sem classificação': {
    label: 'Sem cadastro de produto',
    motivo: 'Itens de nota fiscal cujo produto não existe no cadastro (ou o campo está vazio). Veja a lista exata em Pendências de classificação.',
  },
  'Não classificado': {
    label: 'Produto sem tipo',
    motivo: 'Cupons de produtos cujo cadastro no Omie não tem "tipo do item" preenchido.',
  },
  'Sem família': {
    label: 'Produto sem família',
    motivo: 'Cupons de produtos cujo cadastro no Omie não tem família preenchida.',
  },
  'Produto não identificado': {
    label: 'Cupom sem produto vinculado',
    motivo: 'Itens de cupom fiscal sem produto correspondente no cadastro.',
  },
  'N/D': {
    label: 'Sem valor no BD',
    motivo: 'Linhas do arquivo MOV_DRV importado que vieram sem esse campo preenchido.',
  },
}

export function explicarRotulo(rotulo: string): { label: string; motivo: string } | null {
  return MAPA[rotulo] ?? null
}
