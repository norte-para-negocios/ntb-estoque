// Tipos de item do Omie (espelha App\Helpers\Constants::PRODUTO_TIPO_ITEM do Laravel)
export const PRODUTO_TIPO_ITEM: { value: string; label: string }[] = [
  { value: '00', label: 'Mercadoria para Revenda' },
  { value: '01', label: 'Matéria Prima' },
  { value: '02', label: 'Embalagem' },
  { value: '03', label: 'Produto em Processo' },
  { value: '04', label: 'Produto Acabado' },
  { value: '05', label: 'Subproduto' },
  { value: '06', label: 'Produto Intermediário' },
  { value: '07', label: 'Material de Uso e Consumo' },
  { value: '08', label: 'Ativo Imobilizado' },
  { value: '09', label: 'Serviços' },
  { value: '10', label: 'Outros Insumos' },
  { value: '99', label: 'Outras' },
]

export function labelTipoItem(tipo: string | null | undefined): string {
  if (!tipo) return '-'
  return PRODUTO_TIPO_ITEM.find((t) => t.value === tipo)?.label ?? tipo
}

// Faixa de código sugerida por tipo de item (pedido da reunião 18/06): ao escolher
// o tipo no cadastro de produto, o sistema sugere o próximo código livre na faixa.
// Matéria-prima ~80 mil; revenda ~90 mil; acabado ~91 mil; processo/uso e consumo
// ~70 mil; ativo ~50 mil. Tipos sem faixa definida não recebem sugestão.
export const FAIXA_CODIGO_POR_TIPO: Record<string, { ini: number; fim: number }> = {
  '01': { ini: 80000, fim: 89999 }, // Matéria Prima
  '00': { ini: 90000, fim: 90999 }, // Mercadoria para Revenda
  '04': { ini: 91000, fim: 91999 }, // Produto Acabado
  '03': { ini: 70000, fim: 79999 }, // Produto em Processo
  '07': { ini: 70000, fim: 79999 }, // Material de Uso e Consumo
  '08': { ini: 50000, fim: 59999 }, // Ativo Imobilizado
}
