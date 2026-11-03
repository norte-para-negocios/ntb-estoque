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

/**
 * Pior caso da rota com prazo (revisão 03/11/2026). Na rota de venda toda chamada ao Omie passa por omieRequest com o
 * contexto de prazo (lib/omie/contexto-prazo.ts):
 *   - só COMEÇA antes do prazo (depois dele lança MSG_ADIADA_PRAZO sem ir ao Omie: OP → fila, conclusão →
 *     retry-op-conclusao, saída → retry-ajustes-movimentos);
 *   - não dorme nem repete (semRepetir) e dura no máximo 30 s (escrita 30 s; leitura 60 → 30 s);
 *   - as esperas (Sem CMC, cálculo pendente, concorrência) só acontecem se TERMINAM antes do prazo.
 * Logo a última chamada começa antes de PRAZO e termina em até PRAZO + 30 s = 105 s; depois só sobra banco local
 * (milissegundos a poucos segundos com o servidor carregado). Os 150 s do Vendas ficam com ~45 s de folga.
 */
export const TIMEOUT_CHAMADA_COM_PRAZO_MS = 30_000
export const PIOR_CASO_ROTA_MS = PRAZO_ROTA_VENDA_MS + TIMEOUT_CHAMADA_COM_PRAZO_MS

/** "Tente novamente" no texto: classificarErroOmie trata como transitório (vai para fila/cron). */
export const MSG_ADIADA_PRAZO = 'Adiada para o reenvio automático: prazo da resposta ao Norte Vendas (o Omie não foi chamado). Tente novamente depois.'

export function ehAdiadaPorPrazo(msg: string | null | undefined): boolean {
  return (msg ?? '').startsWith('Adiada para o reenvio automático: prazo da resposta')
}

export function podeChamarOmie(ateMs: number | undefined, agoraMs: number = Date.now()): boolean {
  return !passouDoPrazo(ateMs, agoraMs)
}

export function timeoutDaChamadaMs(escrita: boolean, comPrazo: boolean): number {
  if (escrita) return 30_000
  return comPrazo ? TIMEOUT_CHAMADA_COM_PRAZO_MS : 60_000
}

/** Outra requisição do mesmo método em andamento (não é a redundância de 60 s): passa em segundos. */
export const ESPERA_CONCORRENCIA_MS = 5_000
export function ehRecusaPorConcorrencia(msg: string | null | undefined): boolean {
  return /j. existe uma requisi..o desse m.todo/i.test(msg ?? '')
}

/** Fila de vendas recebeu "já cadastrada": só é Concluido se a OP estiver concluída no Omie. */
export function decidirFilaJaExiste(achada: { nCodOP: number; concluida: boolean } | null): 'concluido' | 'concluir' | 'pendente' {
  if (!achada) return 'pendente'
  return achada.concluida ? 'concluido' : 'concluir'
}

/**
 * Linha local da OP da venda quando não deu para consultar o Omie (prazo vencido ou consulta falhou): sem ela o
 * retry-op-conclusao (que lê ordens_producao com conclusao_status) nunca acharia a OP criada e não concluída.
 * O sync-ops completa o resto depois (o upsert dele não apaga conclusao_status de OP não concluída).
 */
export function linhaOPLocalSemConsulta(
  lojaId: number,
  nCodOP: number,
  p: { cCodIntOP: string; codigo_produto: number; quantidade: number; dData: string; obs: string; codigoLocalEstoque: number | null },
  estado: { concluida: boolean; erro?: string; status?: 'Erro' | 'Sem CMC' | 'Precisa corrigir no Omie'; agoraISO: string }
): Record<string, string | number | boolean | undefined> {
  const [dd, mm, yyyy] = p.dData.split('/')
  return {
    loja_id: lojaId,
    identificacao_n_cod_op: nCodOP,
    identificacao_c_cod_int_op: p.cCodIntOP,
    identificacao_n_cod_produto: p.codigo_produto,
    identificacao_n_qtde: p.quantidade,
    identificacao_d_dt_previsao: `${yyyy}-${mm}-${dd}`,
    ...(p.codigoLocalEstoque ? { identificacao_codigo_local_estoque: p.codigoLocalEstoque } : {}),
    observacao: p.obs,
    concluida: estado.concluida,
    ...(estado.concluida
      ? { dt_conclusao_real: `${yyyy}-${mm}-${dd}` }
      : { conclusao_status: estado.status ?? 'Erro', conclusao_erro_msg: (estado.erro ?? '').slice(0, 500), conclusao_tentativas: 1, conclusao_ultima_tentativa_em: estado.agoraISO }),
    updated_at: estado.agoraISO,
  }
}
