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
