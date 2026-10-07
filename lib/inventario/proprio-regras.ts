// Regras puras do inventário em loja de estoque próprio (sem banco).

/** A diferença exige motivo quando |diferença × custo| passa do limite da loja e nenhum motivo foi informado. */
export function exigeMotivo(delta: number, cmc: number, limite: number, motivo: string | null | undefined): boolean {
  return Math.abs(delta * cmc) > limite && !(motivo ?? '').trim()
}
