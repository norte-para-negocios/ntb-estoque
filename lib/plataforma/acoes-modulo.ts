// Plataforma Norte: a que módulo pertence cada arquivo de server action e quando o estado do módulo barra a ação
// (PURO, sem banco, sem alias do Next; node --test).
import type { Acesso, ModuloId } from './modulos-puro'

// Arquivos de administração/entrada: nunca bloqueados (login, usuário, loja, cargos, a própria plataforma).
const LIVRES = ['auth', 'usuario', 'loja', 'cargo', 'cadastro', 'loja-selector', 'minha-loja', 'convite', 'onboarding-loja', 'integracao-ntb-vendas', 'sync-status', 'central', 'central-numeros', 'notificacoes', 'busca-global']

// Ações só de leitura que a política offline não marca como 'leitura': passam com o módulo suspenso.
const LEITURAS_EXTRA = [
  'estrutura#verEstrutura',
  'central-numeros#numerosDaCentral',
  'sintegra#consultarCnpj',
  'importacao#previaImportacao',
  'importar-pedidos#previaImportacaoPedidos',
  'nota-fiscal-proprio#buscarNotaPorChaveNF',
  'central#previaRefazerInventario',
]

/** Módulo dono do arquivo de ações (parte antes do '#'); null = livre. */
export function moduloDaAcao(arquivo: string): ModuloId | null {
  if (LIVRES.includes(arquivo) || arquivo.startsWith('plataforma-')) return null
  if (arquivo === 'custo-cardapio' || arquivo.startsWith('cozinha-')) return 'cozinha'
  return 'erp'
}

const VERBOS_ESCRITA = [
  'salvar', 'criar', 'excluir', 'apagar', 'remover', 'lancar', 'concluir', 'cancelar', 'atualizar', 'editar', 'gerar', 'enviar',
  'registrar', 'definir', 'marcar', 'importar', 'adicionar', 'mover', 'duplicar', 'arquivar', 'finalizar', 'reabrir', 'trocar',
  'corrigir', 'confirmar', 'aprovar', 'estornar', 'desfazer', 'ajustar', 'transferir', 'incluir', 'alterar', 'dar', 'refazer',
  'reprocessar', 'sincronizar', 'vincular', 'desvincular', 'revogar', 'emitir', 'usar', 'aplicar',
]

/** Primeira palavra do camelCase da ação ('salvarAjuste' -> 'salvar'). */
function primeiraPalavra(nome: string): string {
  const acao = nome.includes('#') ? nome.split('#')[1] : nome
  return /^[a-z0-9]+/.exec(acao)?.[0] ?? ''
}

/** Barra a ação? vitrine barra tudo; consulta (suspenso) barra só escrita (política local/fila/depende ou verbo de escrita
 *  no nome), leitura passa (fail open); abre nada. */
export function barraAcao(acesso: Acesso, politica: string | null, nome = ''): boolean {
  if (acesso === 'vitrine') return true
  if (acesso === 'abre') return false
  if (LEITURAS_EXTRA.includes(nome)) return false
  if (politica === 'local' || politica === 'fila' || politica === 'depende') return true
  return VERBOS_ESCRITA.includes(primeiraPalavra(nome))
}
