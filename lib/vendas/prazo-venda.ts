// Prazo da rota de venda do Norte Vendas (03/11/2026). O Vendas espera 150 s (BAIXA_ESTOQUE_TIMEOUT_MS) e, se a
// resposta não chega, marca a baixa como "incerto" e nunca reenvia sozinho. A rota responde dentro deste prazo: o que
// não couber vai para as filas que já existem (OP → vendas_integracao_fila / retry-integracao-vendas; saída →
// movimentos 'Erro' / retry-ajustes-movimentos), e a resposta diz isso ao Vendas (op 'na_fila', baixa != Concluido),
// que ele trata como ok. Módulo puro (roda direto em `node --test`).

/** Prazo padrão da rota. Mesmo com 1 passo em andamento quando ele vence, a resposta sai bem antes dos 150 s. */
export const PRAZO_ROTA_VENDA_MS = 75_000
const PRAZO_MAXIMO_MS = 120_000

/**
 * Espera do "Sem CMC" depois de uma OP recém-concluída: o Omie leva uns segundos para calcular o custo do produzido.
 * Tem de passar de 60 s: o Omie recusa a MESMA consulta (ListarPosEstoque com os mesmos parâmetros) repetida em menos
 * de 60 s ("Consumo redundante detectado. Aguarde 60 segundos", REDUNDANT). As esperas antigas de 6/12/20 s caíam
 * todas nessa janela e cada recusa custava mais 60 s de espera no omieRequest (Sertão, 22/10–02/11/2026).
 */
export const ESPERA_CMC_APOS_OP_MS = 62_000

export function prazoDaRota(inicioMs: number, env: string | undefined = process.env.VENDA_ROTA_PRAZO_MS): number {
  const n = Number(env)
  const ms = Number.isFinite(n) && n > 0 ? Math.min(n, PRAZO_MAXIMO_MS) : PRAZO_ROTA_VENDA_MS
  return inicioMs + ms
}

export function passouDoPrazo(ateMs: number | undefined, agoraMs: number = Date.now()): boolean {
  return ateMs !== undefined && agoraMs >= ateMs
}

/** Uma espera de `ms` termina antes do prazo? Sem prazo, sempre cabe. */
export function cabeNoPrazo(ateMs: number | undefined, agoraMs: number, ms: number): boolean {
  return ateMs === undefined || agoraMs + ms <= ateMs
}

/**
 * Esperas do "Sem CMC" na saída da venda. Produto sem OP nesta venda (taxa de serviço, revenda) não tem custo sendo
 * calculado: esperar não muda nada (a Taxa de Serviço do Sertão volta Sem CMC sempre), fica para o cron.
 */
export function esperasCmcDaSaida(opConcluidaAgora: boolean): number[] {
  return opConcluidaAgora ? [ESPERA_CMC_APOS_OP_MS] : []
}
