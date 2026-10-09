// Intent da ação do app desktop em execução. createClient/createServiceClient mandam o id no
// header x-ntb-intent; o PostgREST o expõe em request.headers e a outbox (servidor) ou o
// rastreio local (desktop) gravam junto com cada linha criada, para parear ids depois.
import { AsyncLocalStorage } from 'node:async_hooks'

export type ContextoOffline = { intentId: string; local?: boolean }

const als = new AsyncLocalStorage<ContextoOffline>()

export function contextoOffline(): ContextoOffline | undefined {
  return als.getStore()
}

export function comContexto<T>(ctx: ContextoOffline, fn: () => T): T {
  return als.run(ctx, fn)
}

export function headersDoContexto(): Record<string, string> | undefined {
  const ctx = als.getStore()
  return ctx ? { 'x-ntb-intent': ctx.intentId } : undefined
}
