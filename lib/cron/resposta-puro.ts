// Resposta honesta dos crons (auditoria 2026-11, achado 4.3): o log do sync-cron.sh só guarda o código HTTP, então
// uma rota que devolve 200 com "falhas: N" esconde o apagão (foi assim que a migration 090 passou 9 dias em silêncio).
// Regra única: qualquer loja com falha real -> 500 com o resumo por loja; nada a fazer -> 200.
// Rotas com regra própria de "tudo falhou" (502) mantêm o 502 e usam este helper para o caso parcial.

export type ResultadoCronLoja = {
  loja: number
  ok: boolean
  /** false = a loja não tinha nada a fazer neste ciclo (saudável, nunca conta como falha). */
  trabalho?: boolean
  erro?: string | null
}

function falhou(r: ResultadoCronLoja): boolean {
  if (r.erro) return true
  return !r.ok && r.trabalho !== false
}

export function statusDoCron(resultados: ResultadoCronLoja[]): 200 | 500 {
  return resultados.some(falhou) ? 500 : 200
}

export function corpoDoCron(resultados: ResultadoCronLoja[]) {
  const ruins = resultados.filter(falhou)
  return {
    total: resultados.length,
    ok: resultados.length - ruins.length,
    falhas: ruins.length,
    erros: ruins.map((r) => ({ loja: r.loja, erro: r.erro || 'falhou sem mensagem' })),
  }
}

/** Converte o resultado de Promise.allSettled (na ordem de `lojas`) em ResultadoCronLoja[]. `extra` devolve a mensagem de erro de um valor "cumprido" que na verdade falhou (ex.: `{ error }` do supabase). */
export function resultadosDeSettled<V>(
  lojas: { id: number }[],
  settled: PromiseSettledResult<V>[],
  extra?: (valor: V) => string | null | undefined,
): ResultadoCronLoja[] {
  return settled.map((s, i) => {
    const loja = lojas[i].id
    if (s.status === 'rejected') return { loja, ok: false, erro: s.reason instanceof Error ? s.reason.message : String(s.reason) }
    const erro = extra?.(s.value) ?? null
    return { loja, ok: !erro, erro }
  })
}

/** Resultado de um cron de retry (fila de reenvio): falha de LOJA = erro de consulta, ou tentou e nada deu certo.
 *  Linha que continua pendente numa loja onde outras passaram não derruba o ciclo (a pendência aparece na tela/sininho). */
export function resultadoDeRetry(r: { loja_id: number; tentadas: number; sucesso: number; falhas?: number; encerradas?: number; erro?: string }): ResultadoCronLoja {
  const trabalho = r.tentadas > 0 || Boolean(r.erro)
  const resolveu = r.sucesso > 0 || (r.encerradas ?? 0) > 0
  return { loja: r.loja_id, trabalho, ok: !r.erro && (!trabalho || resolveu), erro: r.erro ?? null }
}

/** Mantém a regra antiga das rotas que já respondiam 502 quando TODAS as lojas falham; falha parcial vira 500. */
export function statusComTotal502(resultados: ResultadoCronLoja[]): 200 | 500 | 502 {
  const ruins = resultados.filter(falhou).length
  if (resultados.length > 0 && ruins === resultados.length) return 502
  return ruins > 0 ? 500 : 200
}

/** Resultado das rotas do espelho (rodarLojasEspelho): `pulado` (guarda, janela, orçamento) é saudável; só `erro` falha. */
export function resultadosDoEspelho(r: { loja: number; erro?: string }[]): ResultadoCronLoja[] {
  return r.map((x) => ({ loja: x.loja, ok: !x.erro, erro: x.erro ?? null }))
}
