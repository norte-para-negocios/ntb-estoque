// Dados da matriz de permissões (ticket 10) que NÃO dá para derivar sozinho do menu: telas fora do menu, botões e APIs.
// Cada linha foi conferida na página/rota correspondente (guarda no código do ERP). Rota do menu herda de
// NAV_ITEMS + MENU_PERMISSAO + ROTAS_SO_DEV (ver regraDaRota); aqui entram só as extras e os ajustes onde a página
// pede mais ou diferente do menu.
import type { Regra, RegraBotao } from './permissoes-puro.ts'

const gestao: Regra = { gestao: true }
const perm = (...n: string[]): Regra => ({ anyOf: n })

export const EXTRAS: Record<string, Regra> = {
  // gestão (getAtorGestao().podeGerir -> notFound)
  '/auditoria-fiscal': gestao, '/cargo': gestao, '/correcoes': gestao, '/faturamento': gestao, '/meta-mensal': gestao,
  '/pendencias-classificacao': gestao,
  '/relatorio-cmv': gestao, '/relatorio-compras': gestao, '/relatorio-consumo': gestao, '/relatorio-curva-abc': gestao,
  '/relatorio-engenharia-cardapio': gestao, '/relatorio-estoque-valorizado': gestao, '/relatorio-faturamento': gestao,
  '/relatorio-indicadores': gestao, '/relatorio-lucro': gestao, '/relatorio-margem': gestao, '/relatorio-mensal': gestao,
  '/relatorio-meta': gestao, '/relatorio-movimentacao': gestao, '/relatorio-ops': gestao, '/relatorio-perdas': gestao,
  '/relatorio-posicao-estoque': gestao, '/relatorio-producao': gestao, '/relatorio-produtos-fornecedor': gestao,
  '/relatorio-variacao-preco': gestao,
  // Norte Cozinha: layout.tsx exige gestão (e o módulo da loja)
  '/cozinha': gestao, '/cozinha/cardapios': gestao, '/cozinha/configuracoes': gestao, '/cozinha/estoque': gestao,
  '/cozinha/eventos': gestao, '/cozinha/guia': gestao, '/cozinha/insumos': gestao, '/cozinha/pacioli': gestao,
  '/cozinha/pratos': gestao, '/cozinha/preparacoes': gestao,
  // desenvolvedor (exigirDev)
  '/central': { dev: true }, '/porta': { dev: true },
  // admin
  '/ordem-producao/teste': { admin: true }, '/estoque-local-teste': { admin: true },
  // estoque (todas as sub-telas pedem Movimentacoes)
  '/estoque/ajustes': perm('Movimentacoes'), '/estoque/fichas': perm('Movimentacoes'), '/estoque/kardex': perm('Movimentacoes'),
  '/estoque/quem-mexeu': perm('Movimentacoes'), '/estoque/saude': perm('Movimentacoes'), '/estoque/correcoes': perm('Movimentacoes'),
  // sub-telas de criação/importação
  '/nota-fiscal/etapas': perm('Notas Fiscais'),
  '/nota-fiscal/importar': perm('Compras - Criar'), '/nota-fiscal/nova': perm('Compras - Criar'),
  '/ordem-producao/abertas': perm('Ordens de Producao'), '/ordem-producao/nova': perm('Ordens de Producao - Criar'),
  '/pedido-compra/importar': perm('Compras - Pedidos'), '/pedido-compra/novo': perm('Compras - Pedidos'),
  '/produto/novo': perm('Produtos - Criar'), '/produto/importar': perm('Produtos - Importar planilha'),
  '/fornecedor/importar': perm('Fornecedores - Importar planilha'),
  '/requisicao-compra/novo': perm('Compras - Requisicoes', 'Compras - Pedidos', 'Compras - Aprovar pedidos'),
  '/financeiro/contas-pagar/nova': perm('Financeiro - Contas a pagar'),
  // telas do menu em que a página pede outra coisa que o MENU_PERMISSAO (ou o menu nem mapeia)
  '/cliente': perm('Clientes'),
  '/historico-cadastro': perm('Produtos'),
  '/sintegra': perm('Fornecedores'), // a página só confere Fornecedores (o comentário do menu fala em "uma das duas")
  '/contador': perm('Contador - Pacote', 'Fechamento - Fechar mes', 'Fechamento - Reabrir mes'),
  '/compras-cadastros': perm('Compras - Pedidos', 'Compras - Aprovar pedidos'),
  '/pedido-compra': perm('Compras - Pedidos', 'Compras - Aprovar pedidos'),
  '/requisicao-compra': perm('Compras - Requisicoes', 'Compras - Pedidos', 'Compras - Aprovar pedidos'),
  '/tarefas-compras': perm('Compras - Aprovar pedidos', 'Compras - Pedidos', 'Compras - Requisicoes', 'Notas Fiscais'),
  '/sugestao-compra': perm('Compras - Sugestao', 'Compras - Pedidos', 'Compras - Requisicoes'),
  '/transferencia-loja': perm('Transferencias - Entre lojas', 'Compras - Emitir NF-e'),
  '/devolucao-fornecedor': perm('Compras - Devolucao ao fornecedor', 'Notas Fiscais'),
  // livres de propósito (sem guarda no código): redirecionadores e painel do desktop
  '/compras': { livre: true }, '/ficha-tecnica': { livre: true }, '/producao-propria': { livre: true },
  '/inventario-proprio': { livre: true }, '/auditoria': { livre: true }, '/sincronizacao': { livre: true },
  '/pacioli': { livre: true },
}

/** Telas que não entram na visita: públicas (login) ou fora do escopo. */
export const IGNORAR_ROTAS = new Set(['/', '/login', '/cadastro', '/entrar', '/aguardando'])

/** Botões que gravam, e a regra que a tela deveria aplicar para mostrá-los. Texto como o coletor devolve (números viram #). */
export const BOTOES: RegraBotao[] = [
  { rota: '/inventario', botao: /^Novo inventário$/, regra: { anyOf: ['Inventarios - Criar'] } },
  { rota: '/inventario', botao: /^Duplicar$/, regra: { anyOf: ['Inventarios - Criar'] } },
  { rota: '/inventario', botao: /^Excluir$/, regra: { anyOf: ['Inventarios - Excluir'] } },
  { rota: '/transferencia', botao: /^Nova transferência$/, regra: { anyOf: ['Transferencias - Criar'] } },
  { rota: '/transferencia', botao: /^Duplicar$/, regra: { anyOf: ['Transferencias - Criar'] } },
  { rota: '/transferencia', botao: /^Excluir$/, regra: { anyOf: ['Transferencias - Excluir'] } },
  { rota: '/ordem-producao', botao: /^Criar OP$/, regra: { anyOf: ['Ordens de Producao - Criar'] } },
  { rota: '/ordem-producao', botao: /^Excluir a OP/, regra: { anyOf: ['Ordens de Producao - Excluir'] } },
  { rota: '/ordem-producao', botao: /^Reverter/, regra: { anyOf: ['Ordens de Producao - Reverter'] } },
  { rota: '/ordem-producao', botao: /^Concluir/, regra: { anyOf: ['Ordens de Producao - Concluir'] } },
  { rota: '/ordem-producao', botao: /^Atualizar agora$/, regra: { anyOf: ['Ordens de Producao - Sincronizar'] } },
  { rota: '/categoria-contabil', botao: /^Nova categoria$/, regra: { anyOf: ['Categorias Contabeis - Criar'] } },
  { rota: '/categoria-contabil', botao: /^Editar$/, regra: { anyOf: ['Categorias Contabeis - Editar'] } },
  { rota: '/categoria-contabil', botao: /^Excluir$/, regra: { anyOf: ['Categorias Contabeis - Excluir'] } },
  { rota: '/produto', botao: /^Novo produto$/, regra: { anyOf: ['Produtos - Criar'] } },
  { rota: '/produto', botao: /^Editar produto$/, regra: { anyOf: ['Produtos - Editar'] } },
  { rota: '/produto', botao: /^Excluir produto$/, regra: { anyOf: ['Produtos - Excluir'] } },
  { rota: '/produto', botao: /^Atualizar tudo$/, regra: { anyOf: ['Produtos - Sincronizar'] } },
  { rota: '/familia', botao: /^Nova família$/, regra: { anyOf: ['Familias - Criar'] } },
  { rota: '/familia', botao: /^Editar$/, regra: { anyOf: ['Familias - Editar'] } },
  { rota: '/familia', botao: /^Excluir$/, regra: { anyOf: ['Familias - Excluir'] } },
  { rota: '/familia', botao: /^Puxar do Omie$/, regra: { admin: true } },
  { rota: '/fornecedor', botao: /^Novo fornecedor$/, regra: { anyOf: ['Fornecedores - Criar'] } },
  { rota: '/fornecedor', botao: /^Editar$/, regra: { anyOf: ['Fornecedores - Editar'] } },
  { rota: '/fornecedor', botao: /^Excluir$/, regra: { anyOf: ['Fornecedores - Excluir'] } },
  { rota: '/fornecedor', botao: /^Puxar do Omie$/, regra: { admin: true } },
  { rota: '/local-estoque', botao: /^Novo local$/, regra: { anyOf: ['Locais de Estoque - Criar'] } },
  { rota: '/local-estoque', botao: /^Editar$/, regra: { anyOf: ['Locais de Estoque - Editar'] } },
  { rota: '/local-estoque', botao: /^Excluir$/, regra: { anyOf: ['Locais de Estoque - Excluir'] } },
  { rota: '/local-estoque', botao: /^Sincronizar com Omie$/, regra: { admin: true } },
  { rota: '/nota-fiscal', botao: /^Atualizar agora$/, regra: { anyOf: ['Notas Fiscais - Sincronizar'] } },
  { rota: '/contador', botao: /^Fechar mês$/, regra: { anyOf: ['Fechamento - Fechar mes'] } },
  { rota: '/usuario', botao: /^(Novo usuário|Editar|Convidar por código)$/, regra: { gestao: true } },
  { rota: '/cargo', botao: /^Novo cargo$/, regra: { gestao: true } },
  { rota: '/loja', botao: /^Nova loja$/, regra: { admin: true } },
]

/** APIs de leitura (GET) alcançáveis por URL. `id` inexistente de propósito: a guarda de permissão roda antes da busca. */
export type ApiRegra = {
  id: string
  caminho: string
  regra: Regra
  /** O bloqueio dessa rota devolve 404 (exigirDev -> notFound) em vez de 403. */
  bloqueioEh404?: boolean
  /** Rotas pesadas ou que gravam: o dono não é chamado (só os cargos que devem ser bloqueados). */
  pularDono?: boolean
  /** Só para logins desta loja (o registro usado só existe nela). */
  soLoja?: string
}
export const APIS: ApiRegra[] = [
  { id: 'nota-fiscal-xml', caminho: '/api/nota-fiscal/0/xml', regra: { anyOf: ['Notas Fiscais'] } },
  { id: 'nota-fiscal-danfe', caminho: '/api/nota-fiscal/0/danfe', regra: { anyOf: ['Notas Fiscais'] } },
  { id: 'nfe-saida-xml', caminho: '/api/nfe-saida/0/xml', regra: { dev: true, anyOf: ['Compras - Emitir NF-e', 'Compras - Devolucao ao fornecedor', 'Transferencias - Entre lojas'] }, bloqueioEh404: true },
  { id: 'nfe-saida-danfe', caminho: '/api/nfe-saida/0/danfe', regra: { dev: true, anyOf: ['Compras - Emitir NF-e', 'Compras - Devolucao ao fornecedor', 'Transferencias - Entre lojas'] }, bloqueioEh404: true },
  { id: 'relatorio-mensal', caminho: '/api/relatorio-mensal', regra: { gestao: true }, pularDono: true },
  { id: 'relatorio-mensal-estrutura-pendente', caminho: '/api/relatorio-mensal/estrutura-pendente', regra: { admin: true } },
  // anexo 2 = nota_entrada da loja 19: ver exige 'Notas Fiscais'
  { id: 'anexo-nota-entrada', caminho: '/api/anexos/2', regra: { anyOf: ['Notas Fiscais'] }, soLoja: '19' },
]

/** Canal do app desktop (/api/offline/snapshot, GET, só lê). Hoje serve a tabela inteira a qualquer usuário logado; a matriz diz quem deveria ler cada uma. */
export const TABELAS_OFFLINE: { tabela: string; regra: Regra }[] = [
  { tabela: 'contas_pagar', regra: { dev: true, anyOf: ['Financeiro - Contas a pagar'] } },
  { tabela: 'contas_receber', regra: { dev: true, anyOf: ['Financeiro - Contas a receber'] } },
  { tabela: 'contas_correntes', regra: { dev: true, anyOf: ['Financeiro - Contas correntes'] } },
  { tabela: 'compras_proprio', regra: { anyOf: ['Compras'] } },
  { tabela: 'notas_fiscais', regra: { anyOf: ['Notas Fiscais'] } },
  { tabela: 'faturamento_importado', regra: { gestao: true } },
  { tabela: 'margem_importada', regra: { gestao: true } },
  { tabela: 'metas_faturamento', regra: { gestao: true } },
  // cargo_permissao, permissao_user, loja_user e profiles ficam de fora de propósito: o app offline os usa para decidir permissão sem internet.
]
