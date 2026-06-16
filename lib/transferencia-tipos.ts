// Tipos de movimento de transferencia aceitos pelo Omie (os unicos dois).
// Em modulo proprio (SEM 'use server') porque um arquivo de Server Actions so
// pode exportar funcoes async — uma const exportada de la chega vazia no client,
// e era por isso que o seletor de "Motivo" da Nova Transferencia abria sem
// opcoes e a transferencia nao podia ser criada.
export const TIPOS_TRANSFERENCIA = {
  TRF: 'Entre locais',
  TPQ: 'Perda e quebra',
} as const

export type TipoTransferencia = keyof typeof TIPOS_TRANSFERENCIA
