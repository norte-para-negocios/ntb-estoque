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

type CryptoLike = { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array }

/**
 * UUID v4 para a chave da compra. crypto.randomUUID só existe em contexto seguro (https/localhost): aberta por http
 * na rede local, a página quebraria ao montar o formulário. Sem ele, monta o UUID com getRandomValues (ou Math.random).
 */
export function novaChaveIdempotencia(c: CryptoLike | undefined = (globalThis as { crypto?: CryptoLike }).crypto): string {
  if (c?.randomUUID) return c.randomUUID()
  const b = new Uint8Array(16)
  if (c?.getRandomValues) c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
