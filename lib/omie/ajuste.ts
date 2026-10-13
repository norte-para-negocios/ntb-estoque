import { omieRequest, logIntegrationAttempt, type LojaOmie } from './client'

/**
 * Exclui um ajuste de estoque no Omie (usado ao editar quantidade ou excluir
 * inventário/transferência já processados). Espelha OmieService::excluirAjusteEstoque.
 */
export async function excluirAjusteEstoque(loja: LojaOmie, idAjuste: number): Promise<boolean> {
  try {
    await omieRequest({
      loja_id: loja.id,
      omie_app_key: loja.omie_app_key,
      omie_app_secret: loja.omie_app_secret,
      is_test: loja.is_test,
      endpoint: 'v1/estoque/ajuste',
      call: 'ExcluirAjusteEstoque',
      data: { id_ajuste: idAjuste },
    })
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'ExcluirAjuste',
      request: JSON.stringify({ id_ajuste: idAjuste }),
      code: '200',
    })
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Ajuste já não existe no Omie (excluído antes / nunca existiu) = idempotente: ok.
    // Só falha de comunicação real (rate limit, rede, mês fechado) retorna false, para
    // o chamador NÃO zerar o id_ajuste e NÃO relançar (senão duplica o ajuste no Omie).
    const naoExiste = /n.o encontrad|n.o existe|inexistente|n.o localizad/i.test(msg)
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'ExcluirAjuste',
      request: JSON.stringify({ id_ajuste: idAjuste }),
      error: !naoExiste,
      error_message: msg,
    })
    return naoExiste
  }
}

export type AjusteOmieLido = {
  id_ajuste: number; id_prod: number; tipo: string; quantidade: number; valor: number
  codigo_local_estoque: number; data: string; motivo?: string; obs?: string; cod_int_ajuste?: string
}

/**
 * Ajustes de estoque de UM dia no Omie (ListarAjusteEstoque com data_movimento_de/ate), até `maxPaginas` de 50.
 * Só leitura. `completa = false` quando havia mais páginas do que o teto (quem procura algo e não acha não pode
 * concluir que "não existe"). Usada pela correção de custo para conferir o ajuste antes de excluir e para achar o
 * relançado pelo cod_int_ajuste antes de incluir de novo.
 */
export async function listarAjustesDoDia(loja: LojaOmie, dataBR: string, maxPaginas = 3): Promise<{ ajustes: AjusteOmieLido[]; completa: boolean }> {
  const ajustes: AjusteOmieLido[] = []
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const r = await omieRequest<{ total_de_paginas?: number; ajuste_estoque_lista?: AjusteOmieLido[] }>({
      loja_id: loja.id, omie_app_key: loja.omie_app_key, omie_app_secret: loja.omie_app_secret, is_test: loja.is_test,
      endpoint: 'v1/estoque/ajuste', call: 'ListarAjusteEstoque',
      data: { pagina, registros_por_pagina: 50, data_movimento_de: dataBR, data_movimento_ate: dataBR },
      semRepetir: true,
    })
    ajustes.push(...(r.ajuste_estoque_lista ?? []))
    const total = Number(r.total_de_paginas ?? 0)
    if (pagina >= total) return { ajustes, completa: true }
  }
  return { ajustes, completa: false }
}

/** IncluirAjusteEstoque com o valor (custo unitário) informado, sem ler o CMC. Devolve a resposta crua do Omie. */
export async function incluirAjusteComCusto(loja: LojaOmie, param: {
  codigo_local_estoque: number; id_prod: number; cod_int_ajuste: string; data: string; quan: number; valor: number
  obs: string; origem: string; tipo: 'ENT' | 'SAI'; motivo: string
}): Promise<{ codigo_status?: string; descricao_status?: string; id_movest?: number; id_ajuste?: number }> {
  const res = await omieRequest<{ codigo_status?: string; descricao_status?: string; id_movest?: number; id_ajuste?: number }>({
    loja_id: loja.id, omie_app_key: loja.omie_app_key, omie_app_secret: loja.omie_app_secret, is_test: loja.is_test,
    endpoint: 'v1/estoque/ajuste', call: 'IncluirAjusteEstoque', data: param,
  })
  await logIntegrationAttempt({ loja_id: loja.id, model: 'CorrecaoCusto', request: JSON.stringify(param), response: JSON.stringify(res), code: res.codigo_status ?? '200' })
  return res
}
