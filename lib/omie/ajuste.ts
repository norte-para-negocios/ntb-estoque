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
