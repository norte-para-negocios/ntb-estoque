// Tipos e rótulos puros (sem acesso a banco): seguros para importar em Client Components.

export type Situacao = 'negativo' | 'zerado' | 'baixo' | 'ok'

export const TIPOS_ITEM: Record<string, string> = {
  '00': 'Mercadoria para revenda', '01': 'Matéria-prima', '02': 'Embalagem', '03': 'Produto em processo',
  '04': 'Produto acabado', '05': 'Subproduto', '06': 'Produto intermediário', '07': 'Uso e consumo',
  '08': 'Ativo imobilizado', '09': 'Serviços', '10': 'Outros insumos', '99': 'Outras',
}

export const ROTULO_TIPO: Record<string, string> = {
  ENT: 'Entrada', SAI: 'Saída', AJU: 'Ajuste', TRF: 'Transferência', PRD: 'Produção', EST: 'Estorno',
}

export type Movimento = {
  id: number; tipo: string; origem: string; ref: string; quantidade: number; custo: number | null
  saldoApos: number; cmcApos: number | null; local: string; codigoLocal: number; user: string | null
  obs: string | null; criado: string; estornado: boolean; ehEstorno: boolean; custoEstimado: boolean
  codigoProduto: number; produto?: string
}
