import { politicaDe } from '@/lib/offline/politica'
import { moduloDaAcao, barraAcao } from './acoes-modulo'
import { carregarAcessos, exigirEscritaModulo } from './assinaturas'

/** Linha logo após o viaDesktop de toda server action: devolve { error } quando o módulo da ação está bloqueado (vitrine) ou suspenso (só leitura); null = pode seguir.
 *  nomeAcao = '<arquivo>#<acao>', o mesmo do viaDesktop. Arquivos livres (usuário, loja...) não são tocados. */
export async function guardaModulo(nomeAcao: string): Promise<{ error: string } | null> {
  const modulo = moduloDaAcao(nomeAcao.split('#')[0])
  if (modulo === null) return null
  const { acessos } = await carregarAcessos()
  if (!barraAcao(acessos[modulo], politicaDe(nomeAcao), nomeAcao)) return null
  try {
    await exigirEscritaModulo(modulo) // lança a mensagem certa (vitrine ou suspenso)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Módulo indisponível.' }
  }
  return null
}
