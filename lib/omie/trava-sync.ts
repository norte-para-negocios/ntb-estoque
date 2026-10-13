import { createServiceClient } from '@/lib/supabase/server'

/**
 * Trava por loja + recurso (migration 157, `pegar_trava_sync`/`soltar_trava_sync`): impede duas leituras
 * iguais do Omie ao mesmo tempo (botão da tela x cron), o que estoura "Já existe uma requisição" ou
 * MISUSE_API_PROCESS e bloqueia a chave da loja. Se a função não existir (migration não aplicada),
 * segue sem trava, como era antes, só registrando no log.
 */
export async function pegarTravaSync(lojaId: number, recurso: string, segundos: number): Promise<boolean> {
  const { data, error } = await createServiceClient().rpc('pegar_trava_sync', { p_loja_id: lojaId, p_recurso: recurso, p_segundos: segundos })
  if (error) { console.error(`[trava-sync] pegar ${lojaId}/${recurso}: ${error.message} (seguindo sem trava)`); return true }
  return data === true
}

export async function soltarTravaSync(lojaId: number, recurso: string): Promise<void> {
  const { error } = await createServiceClient().rpc('soltar_trava_sync', { p_loja_id: lojaId, p_recurso: recurso })
  if (error) console.error(`[trava-sync] soltar ${lojaId}/${recurso}: ${error.message}`)
}
