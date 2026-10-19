// Fase G (revisão I1): escrita feita por sincronização não leva o autor do histórico (migration 220), mesmo quando quem
// disparou foi um usuário logado (botão "Atualizar", reprocessar sync). Tudo o que roda dentro de semAutor(), inclusive
// funções chamadas lá dentro, grava como "Sistema".
import { AsyncLocalStorage } from 'node:async_hooks'

const als = new AsyncLocalStorage<true>()

export function semAutor<T>(fn: () => T): T {
  return als.run(true, fn)
}

export function dentroDeSemAutor(): boolean {
  return als.getStore() === true
}

/** Para rotas de sync: `export const POST = rotaSemAutor(async function postSync(req) { ... })`. */
export function rotaSemAutor<A extends unknown[], R>(handler: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args: A) => semAutor(() => handler(...args))
}
