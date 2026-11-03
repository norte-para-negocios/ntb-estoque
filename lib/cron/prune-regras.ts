// O que o cron `prune` NUNCA pode apagar (Fase 1, B2). Cada item tem um leitor vivo no código:
//  - webhooks RecebimentoProduto.*: linha do tempo de status da nota (components/nota-fiscal/HistoricoStatusNF.tsx) e a
//    releitura de nota re-concluída (lib/omie/nota-fiscal.ts, janela de 30 dias).
//  - integration_attempts de NFC-e/cupom: o idCupom gravado no log é o que permite cancelar a nota no Omie
//    (lib/omie/nota-fiscal-venda.ts); sem ele o cancelamento vira exclusão manual. OrdemProducao: estorno de venda antiga
//    (lib/vendas-estorno.ts, vendas anteriores à migration 178).
// Volume protegido hoje: ~5 mil avisos e ~700 logs; o resto (Produto.*, OrdemProducao.*, Financas já processadas,
// InventarioItem, Movimento...) é o que enche o banco (209 mil webhooks, 281 mil tentativas).
export const TOPICOS_WEBHOOK_PROTEGIDOS = ['RecebimentoProduto.%'] as const
export const MODELOS_LOG_PROTEGIDOS = ['ImportarNFCe%', 'IncluirNfce%', 'ExcluirCupom%', 'OrdemProducao'] as const

export const RETENCAO = { webhookDias: 7, tentativaSucessoDias: 2, tentativaQualquerDias: 30 } as const
