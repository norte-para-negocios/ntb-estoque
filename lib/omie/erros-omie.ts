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
