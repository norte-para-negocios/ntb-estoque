// Classificacao das faultstrings do Omie + disjuntor por app_key e método (2026-09-24; por método desde 2026-10-19).
// Modulo puro (sem imports @/) pra rodar direto em `node --test`.

export function segundosBloqueio(msg: string): number | null {
  const m = msg.match(/bloqueada por consumo indevido.*?(\d+)\s*segundos/i)
  return m ? Number(m[1]) : null
}

export function idAjusteExistente(msg: string): number | null {
  const m = msg.match(/j. existe um ajuste de estoque.*?com o ID \[(\d+)\]/i)
  return m ? Number(m[1]) : null
}

export function ehCmcPendente(msg: string): boolean {
  return /c.lculo do saldo de estoque e CMC .*ainda n.o foi conclu/i.test(msg)
}

// Estado de processo: o ntb-estoque roda como UM `next start` no Contabo e os
// crons batem nele via localhost, entao um Map em memoria cobre tudo. Chamar o
// Omie durante o bloqueio reinicia a contagem dele -- por isso falhar rapido.
// Chave = app_key + método (19/10/2026): o Omie bloqueia por IP + App Key + MÉTODO
// (ajuda.omie.com.br "Limites de consumo da API": 10ª requisição com erro no mesmo
// método = 30 min). Travar a chave inteira parou as vendas do Sertão por uma semana
// por causa de um único método (ConcluirOrdemProducao) que errava sem parar.
const bloqueadoAte = new Map<string, number>()
const chaveBloqueio = (appKey: string, metodo?: string) => `${appKey}\u0000${metodo ?? ''}`

export function registrarBloqueio(appKey: string, segundos: number, agoraMs: number = Date.now(), metodo?: string): void {
  const ate = agoraMs + segundos * 1000
  // Outro método da mesma chave já bloqueado: pode ser bloqueio da chave inteira (já visto: uma leitura limpa
  // reestendeu um MISUSE). Na dúvida, trava a chave toda pelo prazo deste bloqueio, em vez de cada método gastar uma chamada.
  const outroAtivo = metodo !== undefined && msRestantesBloqueio(appKey, agoraMs) > 0 && msRestantesBloqueio(appKey, agoraMs, metodo) === 0
  for (const k of outroAtivo ? [chaveBloqueio(appKey, metodo), chaveBloqueio(appKey)] : [chaveBloqueio(appKey, metodo)]) {
    if ((bloqueadoAte.get(k) ?? 0) < ate) bloqueadoAte.set(k, ate)
  }
}

/** Com método: só aquele método (ou um bloqueio sem método da chave). Sem método: algum método da chave bloqueado. */
export function msRestantesBloqueio(appKey: string, agoraMs: number = Date.now(), metodo?: string): number {
  let maior = 0
  for (const [k, ate] of bloqueadoAte) {
    if (ate <= agoraMs) { bloqueadoAte.delete(k); continue }
    const [chave, m] = k.split('\u0000')
    if (chave !== appKey) continue
    if (metodo === undefined || m === '' || m === metodo) maior = Math.max(maior, ate - agoraMs)
  }
  return maior
}

/**
 * Revisão I2 do D5 (20/10/2026): conferido antes de CADA chamada dos laços do espelho. Se qualquer método da chave
 * está bloqueado (ex.: a integração de vendas tomou um bloqueio no meio do ciclo), a frente para neste ciclo com
 * "limite do Omie" (a guarda pausa a loja): um 2º método bloqueado faria o disjuntor travar a chave inteira e parar as
 * vendas da loja.
 */
export function paradaPorDisjuntor(loja: { omie_app_key: string }, agoraMs: number = Date.now()): string | null {
  const ms = msRestantesBloqueio(loja.omie_app_key, agoraMs)
  return ms > 0 ? `limite do Omie: disjuntor com método bloqueado nesta chave (~${Math.ceil(ms / 60000)} min); frente parada no ciclo` : null
}

/** Mensagem do nosso disjuntor (a chamada nem chegou no Omie). */
export function ehRecusaDoDisjuntor(msg: string): boolean {
  return /API do Omie bloqueada para esta loja/i.test(msg)
}

/**
 * Status da OP quando a conclusão falha (19/10/2026). Erro que não passa sozinho (insumo inativo,
 * produto sem ficha) sai da repetição automática: repetir só junta erros no mesmo método e o Omie
 * bloqueia a chave (Sertão: 16 OPs do Baião/Feijão tropeiro, até 2.021 tentativas cada).
 */
export const TETO_TENTATIVAS_ERRO_OP = 30

export function statusFalhaConclusaoOP(msg: string, tentativas = 0): 'Precisa corrigir no Omie' | 'Sem CMC' | 'Erro' {
  if (/encontra-se inativo|n.o possui nenhum item na sua estrutura/i.test(msg)) return 'Precisa corrigir no Omie'
  if (/\bcmc\b|custo m.dio/i.test(msg)) return 'Sem CMC'
  // Bloqueio/rede/tempo esgotado passam sozinhos e não contam para o teto; outro erro repetido 30 vezes (~5 h) sai da
  // repetição (ex.: OP excluída no Omie), senão 10 desses voltam a bloquear o ConcluirOrdemProducao a cada ciclo.
  if (tentativas >= TETO_TENTATIVAS_ERRO_OP && classificarErroOmie(msg) !== 'transitorio' && !ehRecusaDoDisjuntor(msg)) return 'Precisa corrigir no Omie'
  return 'Erro'
}

// Bloqueio do Omie numa resposta: segundos informados na mensagem ou, se vier so o
// faultcode MISUSE_API_PROCESS sem tempo, um padrao conservador de 15 min.
export function bloqueioDaResposta(msg: string, faultCode: string | undefined): number | null {
  const seg = segundosBloqueio(msg)
  if (seg != null) return seg
  return faultCode === 'MISUSE_API_PROCESS' ? 900 : null
}

export type DecisaoErroItem = {
  status: 'Sem CMC' | 'Erro'
  tentativas: number
  descricao_status: string
}

/**
 * O que gravar num item de inventario quando o IncluirAjusteEstoque falha
 * (achado 2026-09-24: o retry reenviava itens com erro permanente a cada 10 min
 * pra sempre -- ate 4.850 tentativas -- e o Omie bloqueava a chave da loja).
 * Nao grava id_ajuste: o item nunca teve ajuste confirmado por este caminho.
 */
export function decidirErroItemInventario(
  msg: string,
  faultCode: string | undefined,
  tentativas: number | null,
  tetoTentativas: number
): DecisaoErroItem {
  // "Ja existe um ajuste ... com o ID [X]": NAO adotar X. Em producao (2026-09-24)
  // 8 de 10 desses IDs eram de OUTRO item/produto -- adotar marcaria Concluido com
  // o ajuste errado, em silencio. Fica Erro com o motivo e sai do retry automatico
  // (teto); precisa conferencia manual no Omie.
  const idExistente = idAjusteExistente(msg)
  if (idExistente) {
    return {
      status: 'Erro',
      tentativas: Math.max(tentativas ?? 0, tetoTentativas),
      descricao_status: `O Omie diz que já existe um ajuste com este código (ID ${idExistente}), mas não dá pra confirmar que é deste item. Confira no Omie antes de reenviar.`,
    }
  }
  const atual = tentativas ?? 0
  // Bloqueio do Omie nao e culpa do item: nao queima tentativa.
  const bloqueio = bloqueioDaResposta(msg, faultCode) != null
  return {
    // CMC ainda em calculo: mesma natureza de 'Sem CMC' (throttle 1h + teto).
    status: ehCmcPendente(msg) ? 'Sem CMC' : 'Erro',
    tentativas: bloqueio ? atual : atual + 1,
    descricao_status: msg.slice(0, 500),
  }
}

// Integracao de vendas (2026-09-28, lib/vendas-integracao.ts): o que fazer quando
// o Omie recusa a OP/NFC-e de uma venda.
export type TipoErroOmie = 'sem_estrutura' | 'ja_existe' | 'transitorio' | 'permanente'

export function classificarErroOmie(msg: string): TipoErroOmie {
  if (/n.o possui nenhum item na sua estrutura|estrutura preenchida/i.test(msg)) return 'sem_estrutura'
  if (
    /consumo redundante|REDUNDANT|j. existe uma requisi|bloquead|MISUSE|consumo indevido|HTTP (4(08|18|29)|5\d\d)|timeout|timed out|ECONN|ETIMEDOUT|fetch failed|socket|tente novamente|Internal Error|SOAP-ERROR|Falha desconhecida/i.test(
      msg
    )
  )
    return 'transitorio'
  if (/j. (existe|cadastrad).*(integra|cCodIntOP|ordem de produ)/i.test(msg)) return 'ja_existe'
  return 'permanente'
}

// Espera antes da proxima tentativa: 10, 20, 40, 80, 120, 120... minutos.
export function proximaTentativa(tentativas: number, agora = Date.now()): string {
  const min = Math.min(10 * 2 ** Math.max(0, tentativas - 1), 120)
  return new Date(agora + min * 60_000).toISOString()
}


// "Já existe uma requisição"/consumo redundante/429 sem bloqueio: omieRequest espera e repete ate 2x.
// Os crons do espelho completo (Fase 1 do "nosso Omie") pedem semRepetir: param o ciclo na 1a recusa.
export function podeRepetirLimite(tentativa: number, semRepetir: boolean): boolean {
  return !semRepetir && tentativa < 2
}
