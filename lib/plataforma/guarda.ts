import { politicaDe } from '@/lib/offline/politica'
import { moduloDaAcao, barraAcao } from './acoes-modulo'
import { carregarAcessos, exigirEscritaModulo } from './assinaturas'

/** Primeira linha de toda server action: recusa quando o módulo da ação está bloqueado (vitrine) ou suspenso (só leitura).
 *  nomeAcao = '<arquivo>#<acao>', o mesmo do viaDesktop. Arquivos livres (usuário, loja...) não são tocados. */
export async function guardaModulo(nomeAcao: string): Promise<void> {
  const modulo = moduloDaAcao(nomeAcao.split('#')[0])
  if (modulo === null) return
  const { acessos } = await carregarAcessos()
  if (!barraAcao(acessos[modulo], politicaDe(nomeAcao) ?? '')) return
  await exigirEscritaModulo(modulo) // lança a mensagem certa (vitrine ou suspenso)
}
