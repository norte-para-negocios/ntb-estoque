// Lê as linhas de um cubo (RPC por loja e período) e guarda em memória por poucos minutos: trocar o layout da tabela
// dinâmica reagrega as mesmas linhas sem ir ao banco de novo. Servidor apenas.
import { createClient } from '@/lib/supabase/server'
import { paginasEmOndas } from '@/lib/supabase/paginas-em-ondas'
import type { Linha } from './pivot'
import { CUBOS, type IdCubo } from './catalogo'

const PAGINA = 1000 // o PostgREST corta em 1000 linhas por chamada (PGRST_DB_MAX_ROWS)
const TETO_LINHAS = 50_000
const VALIDADE_MS = 2 * 60_000
const MAX_ENTRADAS = 6

type Entrada = { em: number; linhas: Linha[]; truncado: boolean }
const cache = new Map<string, Entrada>()

export type CuboCarregado = { linhas: Linha[]; truncado: boolean; falhou: boolean }

export async function carregarCubo(id: IdCubo, lojaId: number, ini: string, fim: string): Promise<CuboCarregado> {
  const chave = `${id}|${lojaId}|${ini}|${fim}`
  const guardado = cache.get(chave)
  if (guardado && Date.now() - guardado.em < VALIDADE_MS) return { linhas: guardado.linhas, truncado: guardado.truncado, falhou: false }

  const supabase = await createClient()
  const { linhas: cruas, falhou } = await paginasEmOndas<Record<string, unknown>>(
    (pagina) =>
      supabase.rpc(`cubo_${id}`, { p_loja: lojaId, p_ini: ini, p_fim: fim, p_de: pagina * PAGINA, p_ate: pagina * PAGINA + PAGINA - 1 }) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>,
    PAGINA,
    4,
  )
  if (falhou) console.error(`carregarCubo: RPC cubo_${id} falhou (loja ${lojaId}, ${ini} a ${fim}); resultado incompleto`)
  const truncado = cruas.length > TETO_LINHAS
  const linhaDoCubo = CUBOS[id].linhaDoCubo
  const linhas = (truncado ? cruas.slice(0, TETO_LINHAS) : cruas).map(linhaDoCubo)

  if (!falhou) {
    if (cache.size >= MAX_ENTRADAS) cache.delete([...cache.keys()][0])
    cache.set(chave, { em: Date.now(), linhas, truncado })
  }
  return { linhas, truncado, falhou }
}
