// Compra manual sem duplicar (Fase A, Task 13; matriz A5): o formulário gera um UUID por compra e o banco
// (lancar_compra, migration 181) não lança de novo uma compra com a mesma chave (duplo clique, reenvio da fila do
// desktop). Puro: node --test lib/estoque/compra-manual-puro.test.ts.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Chave de idempotência aceita (UUID, em minúsculas) ou null (ausente/inválida = segue sem proteção, como antes). */
export function chaveIdempotenciaValida(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  return UUID.test(s) ? s : null
}
