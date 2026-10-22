import {
  LayoutDashboard,
  Boxes,
  ShoppingCart,
  Factory,
  FileText,
  Wallet,
  Settings,
  type LucideIcon,
} from 'lucide-react'

// Fonte única da "Central de cada módulo" (menu novo, só para desenvolvedores).
// Todo href aponta para uma rota real de app/(app). A visibilidade (admin, loja, permissão) NÃO mora aqui:
// vem do NAV_ITEMS (ver lib/central/visibilidade.ts) — cada item herda a regra do item de menu dono da rota.

export type ItemCentral = {
  label: string
  /** Rota real (pode ter ?query). Ausente só em itens `emBreve`. */
  href?: string
  desc?: string
  /** href do NAV_ITEMS de onde herdar a visibilidade (padrão: o NAV de maior prefixo do href). */
  regra?: string
  /** Ainda não existe: aparece desabilitado, com a etiqueta "em breve", sem link. */
  emBreve?: boolean
  /** Só em loja de estoque próprio / com estoque (próprio ou Omie) / no app para computador: a página recusa nos outros casos. */
  soEstoqueProprio?: boolean
  comEstoque?: boolean
  /** Só em loja de modo Omie (a página redireciona ou recusa o estoque próprio). */
  soOmie?: boolean
  soDesktop?: boolean
  /** Repetição de um item que pertence a outro módulo (não conta para "módulo ativo"). */
  ref?: boolean
}

/**
 * Como a seção aparece na tela do módulo:
 * - 'cadastro' (padrão): uma linha com o nome da coisa e um botão por ação (+ Novo, Importar, Ver todos);
 * - 'consulta': cada item vira uma linha própria, com ícone e frase (telas de consulta/uso);
 * - 'relatorio': chips numa faixa só.
 */
export type TipoSecao = 'cadastro' | 'consulta' | 'relatorio'
export type SecaoCentral = { nome: string; itens: ItemCentral[]; tipo?: TipoSecao; desc?: string }

export type ModuloCentral = {
  id: string
  nome: string
  desc: string
  icone: LucideIcon
  atalhos: ItemCentral[]
  secoes: SecaoCentral[]
}

/** Relatórios herdam a regra da tela /relatorios (gestão). */
const rel = (label: string, href: string, extra: Partial<ItemCentral> = {}): ItemCentral => ({
  label,
  href,
  regra: '/relatorios',
  ...extra,
})
const breve = (label: string, desc?: string): ItemCentral => ({ label, desc, emBreve: true })

export const MODULOS: ModuloCentral[] = [
  {
    id: 'inicio',
    nome: 'Dashboard',
    desc: 'Resumo da loja e pendências do dia.',
    icone: LayoutDashboard,
    atalhos: [
      { label: 'Ver o dia da loja', href: '/home', desc: 'Painel inicial, num olhar' },
      { label: 'Ver o resumo operacional', href: '/resumo', desc: 'O que entrou, saiu e deu erro' },
      { label: 'Ver o que o robô corrigiu', href: '/correcoes', desc: 'Correções automáticas' },
      { label: 'Corrigir diferenças', href: '/estoque/correcoes', desc: 'Central de correções', ref: true },
      { label: 'Conferir notas de entrada', href: '/nota-fiscal', desc: 'Entradas para conferir', ref: true },
    ],
    secoes: [],
  },
  {
    id: 'estoque',
    nome: 'Estoque',
    desc: 'Saldo, movimentos, inventário e transferências.',
    icone: Boxes,
    atalhos: [
      { label: 'Ver o estoque de hoje', href: '/estoque', desc: 'Saldo e custo de cada produto' },
      { label: 'Corrigir diferenças', href: '/estoque/correcoes', desc: 'Central de correções' },
      { label: 'Ver movimentações', href: '/movimentacoes', desc: 'Todas as entradas e saídas' },
      { label: 'Fazer um inventário', href: '/inventario', desc: 'Contar e acertar o saldo', ref: true },
      { label: 'Ver o que vence', href: '/validade', desc: 'Lotes a vencer' },
    ],
    secoes: [
      {
        nome: 'Consultas do estoque',
        tipo: 'consulta',
        itens: [
          { label: 'Kardex da loja', href: '/estoque/kardex', soOmie: true, desc: 'Histórico de um produto, dia a dia' },
          { label: 'Ajustes de estoque', href: '/estoque/ajustes', desc: 'Acertos manuais de saldo' },
          { label: 'Fichas que usam o insumo', href: '/estoque/fichas', desc: 'Onde cada insumo é consumido' },
          { label: 'Quem mexeu', href: '/estoque/quem-mexeu', desc: 'Quem alterou o estoque e quando' },
          { label: 'Reposição', href: '/reposicao', desc: 'O que está abaixo do mínimo' },
          { label: 'Transferências', href: '/transferencia', desc: 'Entre locais da loja', ref: true },
        ],
      },
      {
        nome: 'Produtos',
        desc: 'Ficha, preço e unidade',
        itens: [
          { label: 'Incluir', href: '/produto/novo' },
          { label: 'Importar planilha', href: '/produto/importar', soEstoqueProprio: true },
          { label: 'Exibir todos', href: '/produto' },
          // A página pede a permissão 'Produto Substituicoes'; a visibilidade herda de Produtos (dev vê tudo).
          { label: 'Produtos substitutos', href: '/produto-substituicao', regra: '/produto' },
        ],
      },
      { nome: 'Locais de estoque', desc: 'Câmara, depósito, balcão', itens: [{ label: 'Exibir todos', href: '/local-estoque' }] },
      { nome: 'Famílias', desc: 'Agrupam produtos parecidos', itens: [{ label: 'Exibir todas', href: '/familia' }] },
      { nome: 'Grupos e subgrupos', desc: 'Classificação dos produtos', itens: [{ label: 'Exibir todos', href: '/grupo-produto' }] },
      { nome: 'Sincronização do catálogo', tipo: 'consulta', itens: [{ label: 'Sincronização Vendas', href: '/sync-catalogo', desc: 'Catálogo enviado ao Norte Vendas' }] },
      {
        nome: 'Relatórios',
        tipo: 'relatorio',
        itens: [
          rel('Posição de estoque', '/relatorio-posicao-estoque'),
          rel('Estoque valorizado', '/relatorio-estoque-valorizado'),
          { label: 'Estoque mínimo', href: '/sugestao-compra?ver=abaixo', regra: '/sugestao-compra', ref: true },
          rel('Curva ABC', '/relatorio-curva-abc'),
          rel('CMV / CPV', '/relatorio-cmv'),
          rel('Movimentação', '/relatorio-movimentacao'),
        ],
      },
    ],
  },
  {
    id: 'compras',
    nome: 'Compras',
    desc: 'Do pedido à nota de entrada.',
    icone: ShoppingCart,
    atalhos: [
      { label: 'Ver o que comprar', href: '/sugestao-compra', desc: 'Sugestão de compra' },
      { label: 'Ver tarefas de compras', href: '/tarefas-compras', desc: 'Pendências do comprador' },
      { label: 'Conferir notas recebidas', href: '/nota-fiscal', desc: 'Notas de entrada e importação de XML' },
    ],
    secoes: [
      {
        nome: 'Fornecedores',
        desc: 'Quem vende para a loja',
        itens: [
          { label: 'Importar planilha', href: '/fornecedor/importar', soEstoqueProprio: true },
          { label: 'Exibir todos', href: '/fornecedor' },
          { label: 'Compradores e prazos', href: '/compras-cadastros' },
          { label: 'Consulta SINTEGRA', href: '/sintegra' },
        ],
      },
      {
        nome: 'Pedidos de compra',
        desc: 'O que foi pedido e ainda não chegou',
        itens: [
          { label: 'Incluir', href: '/pedido-compra/novo' },
          { label: 'Importar planilha', href: '/pedido-compra/importar', soEstoqueProprio: true },
          { label: 'Exibir todos', href: '/pedido-compra' },
        ],
      },
      {
        nome: 'Requisições',
        desc: 'Pedidos internos de reposição',
        itens: [
          { label: 'Incluir', href: '/requisicao-compra/novo' },
          { label: 'Exibir todas', href: '/requisicao-compra' },
        ],
      },
      {
        nome: 'Notas de entrada',
        desc: 'Receber a mercadoria no estoque',
        itens: [
          { label: 'Importar XML', href: '/nota-fiscal/importar', soEstoqueProprio: true },
          { label: 'Lançar sem XML', href: '/nota-fiscal/nova', soEstoqueProprio: true },
          { label: 'Etapas do recebimento', href: '/nota-fiscal/etapas', soEstoqueProprio: true },
        ],
      },
      { nome: 'Devolução ao fornecedor', desc: 'Mercadoria devolvida e nota de devolução', itens: [{ label: 'Exibir todas', href: '/devolucao-fornecedor' }] },
      {
        nome: 'Relatórios',
        tipo: 'relatorio',
        itens: [
          rel('Compras por fornecedor', '/relatorio-compras'),
          rel('Produtos por fornecedor', '/relatorio-produtos-fornecedor', { comEstoque: true }),
        ],
      },
    ],
  },
  {
    id: 'producao',
    nome: 'Produção',
    desc: 'Ordens de produção, inventários e transferências.',
    icone: Factory,
    atalhos: [
      // ?criar=1 abre o formulário direto (a tela /ordem-producao/nova sozinha só funciona depois do passo 1).
      { label: 'Criar uma ordem de produção', href: '/ordem-producao?criar=1', desc: 'Escolher data, local e produtos', regra: '/ordem-producao', soEstoqueProprio: true },
      { label: 'Ver ordens de produção', href: '/ordem-producao', desc: 'Abertas e concluídas' },
      { label: 'Criar um inventário', href: '/inventario?criar=1', desc: 'Contar e acertar o saldo', regra: '/inventario' },
      { label: 'Ver inventários', href: '/inventario', desc: 'Contagens feitas e em andamento' },
      {
        label: 'Ver fichas técnicas',
        href: '/produto',
        desc: 'Estrutura dos produtos (ícone de camadas na lista)',
        soEstoqueProprio: true,
        ref: true,
      },
    ],
    secoes: [
      {
        nome: 'Consultas da produção',
        tipo: 'consulta',
        itens: [
          { label: 'Ordens abertas', href: '/ordem-producao/abertas', desc: 'O que ainda está para produzir' },
          { label: 'Etiquetas e listas', href: '/impressoes', desc: 'Imprimir etiquetas e listas de contagem' },
        ],
      },
      { nome: 'Transferências', desc: 'Entre locais da loja', itens: [{ label: 'Exibir todas', href: '/transferencia' }] },
      {
        nome: 'Relatórios',
        tipo: 'relatorio',
        itens: [rel('Produção por produto', '/relatorio-ops', { comEstoque: true }), rel('Dashboard de produção', '/relatorio-producao')],
      },
    ],
  },
  {
    id: 'fiscal',
    nome: 'Fiscal',
    desc: 'Notas, categorias contábeis e pacote do contador.',
    icone: FileText,
    atalhos: [
      { label: 'Conferir notas de entrada', href: '/nota-fiscal', desc: 'Entradas', ref: true },
      { label: 'Emitir NF-e de saída', href: '/nfe-saida', desc: 'Emitir e acompanhar' },
      { label: 'Fechar o mês com o contador', href: '/contador', desc: 'Pacote do mês' },
    ],
    secoes: [
      { nome: 'Transferências entre lojas', desc: 'Notas de transferência', itens: [{ label: 'Exibir todas', href: '/transferencia-loja' }] },
      { nome: 'Categorias contábeis', desc: 'Como as notas entram na contabilidade', itens: [{ label: 'Exibir todas', href: '/categoria-contabil' }] },
      {
        nome: 'Relatórios',
        tipo: 'relatorio',
        itens: [rel('Auditoria fiscal', '/auditoria-fiscal'), rel('Pendências de classificação', '/pendencias-classificacao')],
      },
    ],
  },
  {
    id: 'financas',
    nome: 'Finanças',
    desc: 'Contas a pagar, a receber e caixa.',
    icone: Wallet,
    atalhos: [
      { label: 'Lançar uma conta a pagar', href: '/financeiro/contas-pagar/nova', desc: 'Fornecedor, valor e vencimento', regra: '/financeiro/contas-pagar', soEstoqueProprio: true },
      breve('Resumo', 'Caixa de hoje e vencimentos'),
      { label: 'Ver contas a pagar', href: '/financeiro/contas-pagar', desc: 'Em aberto e atrasadas', soEstoqueProprio: true },
      breve('Contas a receber', 'Cartões e convênios'),
      breve('Aprovação de pagamentos', 'Aguardando o dono'),
    ],
    secoes: [
      {
        // Exibir todas = o atalho acima; registrar e estornar pagamento são ações da própria lista e da ficha do título.
        nome: 'Contas a pagar',
        desc: 'Boletos e compromissos',
        itens: [breve('Importar planilha')],
      },
      { nome: 'Contas a receber', itens: [breve('Incluir'), breve('Exibir todas'), breve('Registrar recebimentos')] },
      { nome: 'Contas correntes', desc: 'Caixa, banco e cartão', itens: [{ label: 'Exibir todas', href: '/financeiro/contas-correntes', soEstoqueProprio: true }] },
      { nome: 'Categorias financeiras', desc: 'Onde cada despesa cai no DRE', itens: [{ label: 'Exibir todas', href: '/financeiro/categorias', soEstoqueProprio: true }] },
      {
        nome: 'Movimentação',
        desc: 'Entradas e saídas das contas',
        itens: [
          breve('Incluir lançamento'),
          breve('Incluir transferência'),
          breve('Importar extrato OFX'),
          { label: 'Exibir extrato', href: '/financeiro/extrato', soEstoqueProprio: true },
        ],
      },
      {
        nome: 'Relatórios',
        tipo: 'relatorio',
        itens: [breve('Contas a pagar em aberto'), breve('Pagamentos realizados'), breve('Fluxo de caixa'), breve('DRE')],
      },
    ],
  },
  {
    id: 'administracao',
    nome: 'Administração',
    desc: 'Lojas, pessoas, relatórios e saúde do sistema.',
    icone: Settings,
    atalhos: [
      { label: 'Gerenciar usuários', href: '/usuario', desc: 'Quem acessa o quê' },
      { label: 'Ver todos os relatórios', href: '/relatorios', desc: 'Todos num lugar só' },
      { label: 'Ver a saúde da integração', href: '/sync-status', desc: 'Omie e SEFAZ' },
      { label: 'Ver logs de integração', href: '/log', desc: 'Erros e envios' },
    ],
    secoes: [
      {
        nome: 'Lojas',
        desc: 'Unidades da rede',
        itens: [
          { label: 'Exibir todas', href: '/loja' },
          { label: 'Minha loja', href: '/minha-loja' },
        ],
      },
      { nome: 'Usuários', desc: 'Quem acessa o sistema', itens: [{ label: 'Cargos', href: '/cargo', regra: '/usuario' }] },
      {
        nome: 'Sistema',
        tipo: 'consulta',
        itens: [
          { label: 'Saúde do banco', href: '/saude-banco', desc: 'Espaço, lentidão e erros do banco' },
          { label: 'Sincronização', href: '/sincronizacao', soDesktop: true, desc: 'Dados do computador com a nuvem' },
        ],
      },
      {
        nome: 'Relatórios',
        tipo: 'relatorio',
        itens: [
          rel('Relatório mensal', '/relatorio-mensal'),
          rel('Faturamento', '/faturamento'),
          rel('Faturamento (Excel)', '/relatorio-faturamento'),
          rel('Faturamento x Compras', '/relatorio-indicadores'),
          rel('Margem', '/relatorio-margem'),
          rel('Lucro', '/relatorio-lucro', { soEstoqueProprio: true }),
          rel('Meta do mês', '/meta-mensal'),
          rel('Meta de faturamento', '/relatorio-meta'),
        ],
      },
    ],
  },
]

export function moduloPorId(id: string): ModuloCentral | undefined {
  return MODULOS.find((m) => m.id === id)
}

export function semQuery(href: string): string {
  return href.split('?')[0]
}

/** Todos os itens de um módulo (atalhos + seções), na ordem. */
export function itensDoModulo(m: ModuloCentral): ItemCentral[] {
  return [...m.atalhos, ...m.secoes.flatMap((s) => s.itens)]
}

/** Módulo dono de um pathname: /central/<id> ou o módulo cujo item tem o href mais específico. */
export function moduloDoPath(pathname: string): string | null {
  const c = /^\/central\/([^/]+)/.exec(pathname)
  if (c) return moduloPorId(c[1])?.id ?? null
  let melhor: { id: string; len: number } | null = null
  for (const m of MODULOS) {
    for (const i of itensDoModulo(m)) {
      if (!i.href || i.ref) continue
      const h = semQuery(i.href)
      if ((pathname === h || pathname.startsWith(h + '/')) && (melhor == null || h.length > melhor.len)) {
        melhor = { id: m.id, len: h.length }
      }
    }
  }
  return melhor?.id ?? null
}
