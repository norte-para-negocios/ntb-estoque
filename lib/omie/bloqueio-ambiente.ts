/**
 * Trava de ambiente do Omie. Com NTB_OMIE_BLOQUEADO=1 (cópia local de teste do ERP, robô de teste)
 * NENHUMA chamada ao Omie sai, nem escrita nem leitura: devolve a mensagem de erro que omieRequest lança.
 * Sem a variável (produção), devolve null e nada muda.
 */
export function mensagemBloqueioOmie(env: Record<string, string | undefined>, call: string): string | null {
  if (env.NTB_OMIE_BLOQUEADO !== '1') return null
  return `Omie bloqueado neste ambiente (NTB_OMIE_BLOQUEADO=1): a chamada ${call} não foi enviada.`
}
