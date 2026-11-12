// Plataforma Norte: a que módulo pertence cada arquivo de server action e quando o estado do módulo barra a ação
// (PURO, sem banco, sem alias do Next; node --test).
import type { Acesso, ModuloId } from './modulos-puro'

// Arquivos de administração/entrada: nunca bloqueados (login, usuário, loja, cargos, a própria plataforma).
const LIVRES = ['auth', 'usuario', 'loja', 'cargo', 'cadastro', 'loja-selector', 'minha-loja']

/** Módulo dono do arquivo de ações (parte antes do '#'); null = livre. */
export function moduloDaAcao(arquivo: string): ModuloId | null {
  if (LIVRES.includes(arquivo) || arquivo.startsWith('plataforma-')) return null
  if (arquivo === 'custo-cardapio' || arquivo.startsWith('cozinha-')) return 'cozinha'
  return 'erp'
}

/** Barra a ação? vitrine barra tudo; consulta (suspenso) barra tudo menos leitura; abre nada. */
export function barraAcao(acesso: Acesso, politica: string): boolean {
  if (acesso === 'vitrine') return true
  if (acesso === 'consulta') return politica !== 'leitura'
  return false
}
