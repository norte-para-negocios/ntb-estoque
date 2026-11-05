// Prazo da rota de venda do Norte Vendas para TODAS as chamadas ao Omie feitas dentro dela (03/11/2026), sem passar
// parâmetro por cada função (incluir/concluir/consultar OP, posição de estoque, ajuste...). Lido por omieRequest.
// Regras em lib/vendas/prazo-venda.ts.
import { AsyncLocalStorage } from 'node:async_hooks'

const contexto = new AsyncLocalStorage<{ ateMs: number }>()

export function comPrazoOmie<T>(ateMs: number | undefined, fn: () => Promise<T>): Promise<T> {
  return ateMs === undefined ? fn() : contexto.run({ ateMs }, fn)
}

export function prazoOmieAtual(): number | undefined {
  return contexto.getStore()?.ateMs
}
