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
  /** Ainda não existe: aparece desabilitado, com a etiqueta "novo", sem link. */
  emBreve?: boolean
  /** Repetição de um item que pertence a outro módulo (não conta para "módulo ativo"). */
  ref?: boolean
}

export type SecaoCentral = { nome: string; itens: ItemCentral[] }

export type ModuloCentral = {
  id: string
  nome: string
  desc: string
  icone: LucideIcon
  atalhos: ItemCentral[]
  secoes: SecaoCentral[]
}

/** Relatórios herdam a regra da tela /relatorios (gestão). */
const rel = (label: string, href: string, desc?: string): ItemCentral => ({ label, href, desc, regra: '/relatorios' })
const breve = (label: string, desc?: string): ItemCentral => ({ label, desc, emBreve: true })

export const MODULOS: ModuloCentral[] = [
  {
    id: 'inicio',
    nome: 'Início',
    desc: 'Resumo da loja e pendências do dia.',
    icone: LayoutDashboard,
    atalhos: [
      { label: 'Painel inicial', href: '/home', desc: 'O dia da loja num olhar' },
      { label: 'Resumo operacional', href: '/resumo', desc: 'O que entrou, saiu e deu erro' },
      { label: 'Feito pelo robô', href: '/correcoes', desc: 'Correções automáticas' },
      { label: 'Central de correções', href: '/estoque/correcoes', desc: 'Diferenças a corrigir', ref: true },
      { label: 'Notas Fiscais', href: '/nota-fiscal', desc: 'Entradas para conferir', ref: true },
    ],
    secoes: [],
  },
  {
    id: 'estoque',
    nome: 'Estoque',
    desc: 'Saldo, movimentos, inventário e transferências.',
    icone: Boxes,
    atalhos: [
      { label: 'Estoque', href: '/estoque', desc: 'Saldo e custo de hoje' },
      { label: 'Central de correções', href: '/estoque/correcoes', desc: 'Diferenças a corrigir' },
      { label: 'Movimentações', href: '/movimentacoes', desc: 'Entradas e saídas' },
      { label: 'Inventários', href: '/inventario', desc: 'Contagens' },
      { label: 'Validade', href: '/validade', desc: 'Lotes a vencer' },
    ],
    secoes: [
      {
        nome: 'Consultas do estoque',
        itens: [
          { label: 'Saúde do estoque', href: '/estoque/saude' },
          { label: 'Kardex da loja', href: '/estoque/kardex' },
          { label: 'Ajustes de estoque', href: '/estoque/ajustes' },
          { label: 'Fichas que usam o insumo', href: '/estoque/fichas' },
          { label: 'Quem mexeu', href: '/estoque/quem-mexeu' },
          { label: 'Reposição', href: '/reposicao' },
        ],
      },
      {
        nome: 'Produtos',
        itens: [
          { label: 'Incluir', href: '/produto/novo' },
          { label: 'Importar planilha', href: '/produto/importar' },
          { label: 'Exibir todos', href: '/produto' },
          { label: 'Produtos substitutos', href: '/produto-substituicao' },
        ],
      },
      { nome: 'Locais de estoque', itens: [{ label: 'Exibir todos', href: '/local-estoque' }] },
      { nome: 'Famílias', itens: [{ label: 'Exibir todas', href: '/familia' }] },
      { nome: 'Grupos e subgrupos', itens: [{ label: 'Exibir todos', href: '/grupo-produto' }] },
      { nome: 'Sincronização do catálogo', itens: [{ label: 'Sincronização Vendas', href: '/sync-catalogo' }] },
      { nome: 'Inventário', itens: [{ label: 'Inventário do estoque próprio', href: '/inventario-proprio' }] },
      { nome: 'Transferências', itens: [{ label: 'Exibir todas', href: '/transferencia' }] },
      { nome: 'Impressões', itens: [{ label: 'Etiquetas e listas', href: '/impressoes' }] },
      {
        nome: 'Relatórios',
        itens: [
          rel('Posição de estoque', '/relatorio-posicao-estoque'),
          rel('Estoque valorizado', '/relatorio-estoque-valorizado'),
          rel('Estoque mínimo', '/sugestao-compra?ver=abaixo'),
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
      { label: 'Sugestão de compra', href: '/sugestao-compra', desc: 'O que comprar' },
      { label: 'Tarefas de compras', href: '/tarefas-compras', desc: 'Pendências do comprador' },
      { label: 'Notas Fiscais', href: '/nota-fiscal', desc: 'Notas recebidas e importação de XML' },
    ],
    secoes: [
      {
        nome: 'Fornecedores',
        itens: [
          { label: 'Importar planilha', href: '/fornecedor/importar' },
          { label: 'Exibir todos', href: '/fornecedor' },
          { label: 'Compradores e prazos', href: '/compras-cadastros' },
          { label: 'Consulta SINTEGRA', href: '/sintegra' },
        ],
      },
      {
        nome: 'Pedidos de compra',
        itens: [
          { label: 'Incluir', href: '/pedido-compra/novo' },
          { label: 'Importar planilha', href: '/pedido-compra/importar' },
          { label: 'Exibir todos', href: '/pedido-compra' },
        ],
      },
      {
        nome: 'Requisições',
        itens: [
          { label: 'Incluir', href: '/requisicao-compra/novo' },
          { label: 'Exibir todas', href: '/requisicao-compra' },
        ],
      },
      {
        nome: 'Notas de entrada',
        itens: [
          { label: 'Importar XML', href: '/nota-fiscal/importar' },
          { label: 'Lançar sem XML', href: '/nota-fiscal/nova' },
          { label: 'Etapas do recebimento', href: '/nota-fiscal/etapas' },
        ],
      },
      { nome: 'Devolução ao fornecedor', itens: [{ label: 'Exibir todas', href: '/devolucao-fornecedor' }] },
      {
        nome: 'Relatórios',
        itens: [
          rel('Compras por fornecedor', '/relatorio-compras'),
          rel('Produtos por fornecedor', '/relatorio-produtos-fornecedor'),
        ],
      },
    ],
  },
  {
    id: 'producao',
    nome: 'Produção',
    desc: 'Fichas técnicas e ordens de produção.',
    icone: Factory,
    atalhos: [
      { label: 'Ordens de Produção', href: '/ordem-producao', desc: 'Abertas e concluídas' },
      { label: 'Produção própria', href: '/producao-propria', desc: 'Produzir e baixar insumos' },
      { label: 'Fichas técnicas', href: '/ficha-tecnica', desc: 'Estrutura dos produtos' },
    ],
    secoes: [
      {
        nome: 'Ordem de produção',
        itens: [
          { label: 'Incluir', href: '/ordem-producao/nova' },
          { label: 'Abertas', href: '/ordem-producao/abertas' },
        ],
      },
      {
        nome: 'Relatórios',
        itens: [rel('Produção por produto', '/relatorio-ops'), rel('Dashboard de produção', '/relatorio-producao')],
      },
    ],
  },
  {
    id: 'fiscal',
    nome: 'Fiscal',
    desc: 'Notas, categorias contábeis e pacote do contador.',
    icone: FileText,
    atalhos: [
      { label: 'Notas Fiscais', href: '/nota-fiscal', desc: 'Entradas', ref: true },
      { label: 'NF-e de saída', href: '/nfe-saida', desc: 'Emitir e acompanhar' },
      { label: 'Contador e fechamento', href: '/contador', desc: 'Pacote do mês' },
    ],
    secoes: [
      { nome: 'Transferências entre lojas', itens: [{ label: 'Exibir todas', href: '/transferencia-loja' }] },
      { nome: 'Categorias contábeis', itens: [{ label: 'Exibir todas', href: '/categoria-contabil' }] },
      {
        nome: 'Relatórios',
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
      breve('Resumo', 'Caixa de hoje e vencimentos'),
      breve('Contas a pagar', 'Em aberto e atrasadas'),
      breve('Contas a receber', 'Cartões e convênios'),
      breve('Aprovação de pagamentos', 'Aguardando o dono'),
    ],
    secoes: [
      {
        nome: 'Contas a pagar',
        itens: [breve('Incluir'), breve('Importar planilha'), breve('Exibir todas'), breve('Registrar pagamentos')],
      },
      { nome: 'Contas a receber', itens: [breve('Incluir'), breve('Exibir todas'), breve('Registrar recebimentos')] },
      { nome: 'Contas correntes', itens: [breve('Incluir'), breve('Exibir todas')] },
      {
        nome: 'Movimentação',
        itens: [breve('Incluir lançamento'), breve('Incluir transferência'), breve('Importar extrato OFX'), breve('Exibir extrato')],
      },
      {
        nome: 'Relatórios',
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
      { label: 'Usuários', href: '/usuario', desc: 'Quem acessa o quê' },
      { label: 'Relatórios', href: '/relatorios', desc: 'Todos num lugar só' },
      { label: 'Saúde da integração', href: '/sync-status', desc: 'Omie e SEFAZ' },
      { label: 'Logs de integração', href: '/log', desc: 'Erros e envios' },
    ],
    secoes: [
      {
        nome: 'Lojas',
        itens: [
          { label: 'Exibir todas', href: '/loja' },
          { label: 'Minha loja', href: '/minha-loja' },
        ],
      },
      { nome: 'Usuários', itens: [{ label: 'Cargos', href: '/cargo' }] },
      {
        nome: 'Sistema',
        itens: [
          { label: 'Saúde do banco', href: '/saude-banco' },
          { label: 'Sincronização', href: '/sincronizacao' },
        ],
      },
      {
        nome: 'Relatórios',
        itens: [
          rel('Relatório mensal', '/relatorio-mensal'),
          rel('Faturamento', '/faturamento'),
          rel('Faturamento (Excel)', '/relatorio-faturamento'),
          rel('Faturamento x Compras', '/relatorio-indicadores'),
          rel('Margem', '/relatorio-margem'),
          rel('Lucro', '/relatorio-lucro'),
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
