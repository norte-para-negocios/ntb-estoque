// Observação da transferência (2026-09-30, pedido do Ramon): na transferência pra
// AVARIA (ou qualquer outra) não havia onde justificar o motivo. Agora há uma
// observação geral da transferência e um motivo opcional por item; os dois vão no
// campo `obs` do ajuste no Omie, antes do carimbo de quem fez.

const LIMITE_CAMPO = 300 // por campo digitado
const LIMITE_OMIE = 500 // obs final enviada ao Omie

export function limparObservacao(texto: string | null | undefined): string | null {
  const t = (texto ?? '').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, LIMITE_CAMPO) : null
}

/** "<motivo do item> · <observação geral> · <carimbo>", cortado sem perder o carimbo. */
export function montarObsTransferencia(carimbo: string, obsGeral: string | null, obsItem: string | null): string {
  const textos = [limparObservacao(obsItem), limparObservacao(obsGeral)].filter(Boolean) as string[]
  if (!textos.length) return carimbo
  const sufixo = ` · ${carimbo}`
  const espaco = LIMITE_OMIE - sufixo.length
  let corpo = textos.join(' · ')
  if (corpo.length > espaco) corpo = corpo.slice(0, Math.max(0, espaco - 1)).trimEnd() + '…'
  return corpo + sufixo
}
