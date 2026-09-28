// Classificacao das faultstrings do Omie + disjuntor por app_key (2026-09-24).
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
const bloqueadoAte = new Map<string, number>()

export function registrarBloqueio(appKey: string, segundos: number, agoraMs: number = Date.now()): void {
  const ate = agoraMs + segundos * 1000
  if ((bloqueadoAte.get(appKey) ?? 0) < ate) bloqueadoAte.set(appKey, ate)
}

export function msRestantesBloqueio(appKey: string, agoraMs: number = Date.now()): number {
  const ate = bloqueadoAte.get(appKey)
  if (!ate) return 0
  if (ate <= agoraMs) {
    bloqueadoAte.delete(appKey)
    return 0
  }
  return ate - agoraMs
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

