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
  /** Repetição de um item que pertence a outro módulo (não conta para "módulo ativo"). Só em relatórios. */
  ref?: boolean
  /** A tela mais usada do módulo: cartão em destaque na central. */
  principal?: boolean
}

/**
 * Como a seção aparece na tela do módulo:
 * - 'cadastro' (padrão): um cartão com o nome da coisa e um botão por ação (+ Novo, Importar, Ver todos);
 * - 'relatorio': chips numa faixa só.
 */
export type TipoSecao = 'cadastro' | 'relatorio'
export type SecaoCentral = { nome: string; itens: ItemCentral[]; tipo?: TipoSecao; desc?: string }

// Regras da organização (docs/superpowers/plans/2026-10-22-menu-novo-reorganizacao.md):
// uma tela, um nome (o do menu antigo), um módulo; criar documento = faixa "Novo"; criar cadastro = cartão do cadastro.
export type ModuloCentral = {
  id: string
  nome: string
  desc: string
  icone: LucideIcon
  /** Para onde o nome do módulo leva (padrão: /central/<id>). Dashboard abre o painel direto. */
  href?: string
  /** Ações de criar documentos (pedido, nota, OP...). */
  novos: ItemCentral[]
  /** Telas do módulo, com o mesmo nome do menu antigo. Também viram a lista do módulo no menu lateral. */
  telas: ItemCentral[]
  /** Cadastros e relatórios. */
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

// Criar pela tela da lista = "<rota>?criar=1": a própria tela abre o formulário (hook useCriarDaCentral).
// `regra` herda a visibilidade da tela.
const criar = (label: string, rota: string, extra: Partial<ItemCentral> = {}): ItemCentral => ({
  label,
  href: `${rota}?criar=1`,
  regra: rota,
  ...extra,
})

export const MODULOS: ModuloCentral[] = [
  {
    id: 'inicio',
    nome: 'Dashboard',
    desc: 'O dia da loja e o que precisa de atenção.',
    icone: LayoutDashboard,
    href: '/home',
    novos: [],
    telas: [
      { label: 'Painel do dia', href: '/home', desc: 'Vendas, estoque e pendências num olhar', principal: true },
      { label: 'Resumo Operacional', href: '/resumo', desc: 'O que entrou, saiu e deu erro' },
      { label: 'Feito pelo robô', href: '/correcoes', desc: 'Correções automáticas do dia' },
    ],
    secoes: [],
  },
  {
    id: 'estoque',
    nome: 'Estoque',
    desc: 'Saldo, movimentos, validade e cadastro de produtos.',
    icone: Boxes,
    novos: [],
    telas: [
      { label: 'Estoque', href: '/estoque', desc: 'Saldo e custo de cada produto', principal: true },
      { label: 'Central de correções', href: '/estoque/correcoes', desc: 'Diferenças a corrigir' },
      { label: 'Movimentações', href: '/movimentacoes', desc: 'Todas as entradas e saídas' },
      { label: 'Validade', href: '/validade', desc: 'Lotes a vencer' },
      { label: 'Reposição', href: '/reposicao', desc: 'O que está abaixo do mínimo' },
      { label: 'Kardex da loja', href: '/estoque/kardex', soOmie: true, desc: 'Histórico de um produto, dia a dia' },
      { label: 'Ajustes de estoque', href: '/estoque/ajustes', desc: 'Acertos manuais de saldo' },
      { label: 'Fichas que usam o insumo', href: '/estoque/fichas', desc: 'Onde cada insumo é consumido' },
      { label: 'Quem mexeu', href: '/estoque/quem-mexeu', desc: 'Quem alterou o estoque e quando' },
      { label: 'Sincronização Vendas', href: '/sync-catalogo', desc: 'Catálogo enviado ao Norte Vendas' },
    ],
    secoes: [
      {
        nome: 'Produtos',
        desc: 'Ficha, preço, unidade e ficha técnica',
        itens: [
          { label: 'Incluir', href: '/produto/novo' },
          { label: 'Importar planilha', href: '/produto/importar', soEstoqueProprio: true },
          { label: 'Exibir todos', href: '/produto' },
          // A página pede a permissão 'Produto Substituicoes'; a visibilidade herda de Produtos (dev vê tudo).
          { label: 'Substitutos', href: '/produto-substituicao', regra: '/produto' },
        ],
      },
      { nome: 'Locais de Estoque', desc: 'Câmara, depósito, balcão', itens: [criar('Incluir', '/local-estoque'), { label: 'Exibir todos', href: '/local-estoque' }] },
      { nome: 'Famílias', desc: 'Agrupam produtos parecidos', itens: [criar('Incluir', '/familia'), { label: 'Exibir todas', href: '/familia' }] },
      { nome: 'Grupos e subgrupos', desc: 'Árvore de classificação dos produtos', itens: [{ label: 'Exibir todos', href: '/grupo-produto' }] },
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
    desc: 'Do pedido ao recebimento da nota.',
    icone: ShoppingCart,
    novos: [
      // Loja Omie: o pedido só é criado com a gravação no Omie ligada (C1, desligada); até lá, só estoque próprio.
      { label: 'Pedido de compra', href: '/pedido-compra/novo', soEstoqueProprio: true },
      { label: 'Requisição', href: '/requisicao-compra/novo' },
      { label: 'Importar XML de nota', href: '/nota-fiscal/importar', soEstoqueProprio: true },
      { label: 'Nota sem XML', href: '/nota-fiscal/nova', soEstoqueProprio: true },
      { label: 'Importar pedidos (planilha)', href: '/pedido-compra/importar', soEstoqueProprio: true },
    ],
    telas: [
      { label: 'Notas Fiscais', href: '/nota-fiscal', desc: 'Notas de entrada recebidas', principal: true },
      { label: 'Sugestão de compra', href: '/sugestao-compra', desc: 'O que comprar agora' },
      { label: 'Tarefas de compras', href: '/tarefas-compras', desc: 'Pendências do comprador' },
      { label: 'Pedidos de compra', href: '/pedido-compra', desc: 'O que foi pedido e ainda não chegou' },
      { label: 'Requisições de compra', href: '/requisicao-compra', desc: 'Pedidos internos de reposição' },
      { label: 'Etapas do recebimento', href: '/nota-fiscal/etapas', desc: 'Conferência e entrada da mercadoria', soEstoqueProprio: true },
      { label: 'Devoluções ao fornecedor', href: '/devolucao-fornecedor', desc: 'Mercadoria devolvida e nota de devolução' },
      { label: 'SINTEGRA', href: '/sintegra', desc: 'Situação cadastral de um fornecedor' },
    ],
    secoes: [
      {
        nome: 'Fornecedores',
        desc: 'Quem vende para a loja',
        itens: [
          criar('Incluir', '/fornecedor'),
          { label: 'Importar planilha', href: '/fornecedor/importar', soEstoqueProprio: true },
          { label: 'Exibir todos', href: '/fornecedor' },
        ],
      },
      { nome: 'Compradores e prazos', desc: 'Quem compra e em quantos dias chega', itens: [{ label: 'Exibir todos', href: '/compras-cadastros' }] },
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
    novos: [
      // A tela /ordem-producao/nova sozinha é o passo 2; o passo 1 é o formulário da lista (?criar=1).
      criar('Ordem de produção', '/ordem-producao', { soEstoqueProprio: true }),
      criar('Inventário', '/inventario'),
      criar('Transferência', '/transferencia'),
    ],
    telas: [
      { label: 'Ordens de Produção', href: '/ordem-producao', desc: 'Abertas e concluídas', principal: true },
      { label: 'OPs abertas', href: '/ordem-producao/abertas', desc: 'O que ainda está para produzir' },
      { label: 'Inventários', href: '/inventario', desc: 'Contagens feitas e em andamento' },
      { label: 'Transferências', href: '/transferencia', desc: 'Entre locais da loja' },
      { label: 'Impressões', href: '/impressoes', desc: 'Etiquetas e listas de contagem' },
    ],
    secoes: [
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
    desc: 'Notas de saída, transferências entre lojas e contador.',
    icone: FileText,
    novos: [criar('Transferência entre lojas', '/transferencia-loja')],
    telas: [
      { label: 'NF-e de saída', href: '/nfe-saida', desc: 'Emitir e acompanhar', principal: true },
      { label: 'Transferências entre lojas', href: '/transferencia-loja', desc: 'Mercadoria enviada com nota fiscal' },
      { label: 'Contador e fechamento', href: '/contador', desc: 'Pacote do mês' },
    ],
    secoes: [
      { nome: 'Categorias Contábeis', desc: 'Como as notas entram na contabilidade', itens: [criar('Incluir', '/categoria-contabil'), { label: 'Exibir todas', href: '/categoria-contabil' }] },
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
    desc: 'Contas a pagar, caixa, extrato e resultado.',
    icone: Wallet,
    novos: [{ label: 'Conta a pagar', href: '/financeiro/contas-pagar/nova', regra: '/financeiro/contas-pagar', soEstoqueProprio: true }],
    telas: [
      { label: 'Contas a pagar', href: '/financeiro/contas-pagar', desc: 'Em aberto e atrasadas', soEstoqueProprio: true, principal: true },
      { label: 'Extrato', href: '/financeiro/extrato', desc: 'Entradas e saídas das contas', soEstoqueProprio: true },
      breve('Resumo do caixa', 'Caixa de hoje e vencimentos'),
      breve('Contas a receber', 'Cartões e convênios'),
      breve('Aprovação de pagamentos', 'Aguardando o dono'),
    ],
    secoes: [
      {
        nome: 'Contas correntes',
        desc: 'Caixa, banco e cartão',
        itens: [
          criar('Incluir', '/financeiro/contas-correntes', { soEstoqueProprio: true }),
          { label: 'Exibir todas', href: '/financeiro/contas-correntes', soEstoqueProprio: true },
        ],
      },
      {
        nome: 'Categorias financeiras',
        desc: 'Onde cada despesa cai no DRE',
        itens: [
          criar('Incluir', '/financeiro/categorias', { soEstoqueProprio: true }),
          { label: 'Exibir todas', href: '/financeiro/categorias', soEstoqueProprio: true },
        ],
      },
      { nome: 'Movimentação', itens: [breve('Lançamento avulso'), breve('Transferência entre contas'), breve('Importar extrato OFX'), breve('Importar contas a pagar (planilha)')] },
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
          breve('Contas a pagar em aberto'),
          breve('Pagamentos realizados'),
          breve('Fluxo de caixa'),
          breve('DRE'),
        ],
      },
    ],
  },
  {
    id: 'administracao',
    nome: 'Administração',
    desc: 'Lojas, pessoas, permissões e saúde do sistema.',
    icone: Settings,
    novos: [],
    telas: [
      { label: 'Relatórios', href: '/relatorios', desc: 'Todos os relatórios num lugar só', principal: true },
      { label: 'Saúde da integração', href: '/sync-status', desc: 'Omie e SEFAZ' },
      { label: 'Logs de Integração', href: '/log', desc: 'Erros e envios' },
      { label: 'Saúde do Banco', href: '/saude-banco', desc: 'Espaço, lentidão e erros do banco' },
      { label: 'Sincronização', href: '/sincronizacao', soDesktop: true, desc: 'Dados do computador com a nuvem' },
      { label: 'Minha loja', href: '/minha-loja', desc: 'Dados e preferências desta loja' },
    ],
    secoes: [
      { nome: 'Usuários', desc: 'Quem acessa o sistema', itens: [criar('Incluir', '/usuario'), { label: 'Exibir todos', href: '/usuario' }] },
      {
        nome: 'Cargos',
        desc: 'O que cada função pode fazer',
        itens: [criar('Incluir', '/cargo', { regra: '/usuario' }), { label: 'Exibir todos', href: '/cargo', regra: '/usuario' }],
      },
      {
        nome: 'Lojas',
        desc: 'Unidades da rede',
        itens: [criar('Incluir', '/loja'), { label: 'Exibir todas', href: '/loja' }],
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

/** Todos os itens de um módulo (novos + telas + seções), na ordem. */
export function itensDoModulo(m: ModuloCentral): ItemCentral[] {
  return [...m.novos, ...m.telas, ...m.secoes.flatMap((s) => s.itens)]
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
