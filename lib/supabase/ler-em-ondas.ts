import { paginasEmOndas } from './paginas-em-ondas'

type Res<T> = { data: T[] | null; error: { message: string } | null }

/**
 * Lê todas as páginas (1000 linhas, o corte do PostgREST) em ondas paralelas de 4. A consulta PRECISA de ordem total
 * (ex.: .order('id') no fim), senão OFFSET repete/pula linhas. Erro: loga, chama `onErro` e devolve o que leu.
 */
export async function lerEmOndas<T>(montar: (from: number, to: number) => PromiseLike<Res<T>>, onErro?: (m: string) => void): Promise<T[]> {
  let msg: string | null = null
  const r = await paginasEmOndas<T>(async (p) => {
    const x = await montar(p * 1000, p * 1000 + 999)
    if (x.error) msg = x.error.message
    return x
  }, 1000, 4)
  if (r.falhou) {
    console.error('lerEmOndas: consulta falhou -- resultado pode estar incompleto', msg)
    onErro?.(msg ?? 'falha na leitura')
  }
  return r.linhas
}
