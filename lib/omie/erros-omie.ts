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

export type DecisaoErroItem = {
  status: 'Concluido' | 'Sem CMC' | 'Erro'
  id_ajuste: number | null
  tentativas: number
  descricao_status: string
}

/**
 * O que gravar num item de inventario quando o IncluirAjusteEstoque falha
 * (achado 2026-09-24: o retry reenviava itens com erro permanente a cada 10 min
 * pra sempre -- ate 4.850 tentativas -- e o Omie bloqueava a chave da loja).
 */
export function decidirErroItemInventario(
  msg: string,
  faultCode: string | undefined,
  tentativas: number | null
): DecisaoErroItem {
  // Ajuste JA lancado com este cod_int_ajuste (id perdido num timeout anterior):
  // adota o ID em vez de reenviar pra sempre.
  const idExistente = idAjusteExistente(msg)
  if (idExistente) {
    return { status: 'Concluido', id_ajuste: idExistente, tentativas: 0, descricao_status: 'Ajuste já existia no Omie (ID recuperado)' }
  }
  const atual = tentativas ?? 0
  // Bloqueio do Omie nao e culpa do item: nao queima tentativa.
  const bloqueio = faultCode === 'BLOQUEIO_LOCAL' || segundosBloqueio(msg) != null
  return {
    // CMC ainda em calculo: mesma natureza de 'Sem CMC' (throttle 1h + teto).
    status: ehCmcPendente(msg) ? 'Sem CMC' : 'Erro',
    id_ajuste: null,
    tentativas: bloqueio ? atual : atual + 1,
    descricao_status: msg.slice(0, 500),
  }
}
