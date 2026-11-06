import {
  LayoutDashboard,
  FileText,
  Factory,
  ArrowLeftRight,
  ArrowDownUp,
  ClipboardCheck,
  ClipboardList,
  ShoppingCart,
  CalendarClock,
  Printer,
  Package,
  Warehouse,
  ScrollText,
  Activity,
  Store,
  Users,
  FolderTree,
  Truck,
  ScanLine,
  Settings,
  CalendarCheck,
  BarChart3,
  Database,
  Tags,
  Boxes,
  ChefHat,
  CookingPot,
  RefreshCw,
  ListTodo,
  ClipboardPen,
  UserCog,
  Undo2,
  FileOutput,
  BookOpenCheck,
  Receipt,
  Landmark,
  type LucideIcon,
  HandCoins,
  Percent,
  TrendingUp,
  FileBarChart,
  Sigma,
  Trash2,
  ChartSpline,
} from 'lucide-react'

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  group: 'Operação' | 'Cadastros' | 'Administração'
  // admin: so admin GLOBAL ('Admin') ve a rota.
  admin?: boolean
  // gestaoUsuarios: admin global OU AdminLoja veem (gestao de usuarios escopada).
  gestaoUsuarios?: boolean
  // cadeadoSemAdmin: aparece pra quem nao e admin global com cadeado (em breve).
  cadeadoSemAdmin?: boolean
  // superAdmin: so quem tem is_super_admin = true ve a rota.
  superAdmin?: boolean
  // soEstoqueProprio: so aparece quando a loja atual usa o estoque proprio (modo_estoque='proprio').
  soEstoqueProprio?: boolean
  // comEstoque: aparece em loja de estoque proprio OU Omie (espelho); some so em modo 'nenhum'.
  comEstoque?: boolean
  // ouPedidosOmie: item soEstoqueProprio que também aparece na loja Omie com pedido de compra liberado (C1).
  ouPedidosOmie?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/home', label: 'Início', icon: LayoutDashboard, group: 'Operação' },
  { href: '/estoque', label: 'Estoque', icon: Boxes, group: 'Operação', comEstoque: true },
  { href: '/reposicao', label: 'Reposição', icon: ShoppingCart, group: 'Operação', soEstoqueProprio: true },
  { href: '/sugestao-compra', label: 'Sugestão de compra', icon: ShoppingCart, group: 'Operação', comEstoque: true, superAdmin: true },
  { href: '/tarefas-compras', label: 'Tarefas de compras', icon: ListTodo, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  { href: '/requisicao-compra', label: 'Requisições de compra', icon: ClipboardPen, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  { href: '/pedido-compra', label: 'Pedidos de compra', icon: ClipboardCheck, group: 'Operação', soEstoqueProprio: true, ouPedidosOmie: true, superAdmin: true },
  { href: '/devolucao-fornecedor', label: 'Devoluções ao fornecedor', icon: Undo2, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  { href: '/nfe-saida', label: 'NF-e de saída', icon: FileOutput, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  { href: '/transferencia-loja', label: 'Transferências entre lojas', icon: Truck, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  // Finanças, etapa 1 (só estoque próprio, só desenvolvedores). Todas herdam a rota-mãe /financeiro em ROTAS_SO_DEV.
  { href: '/financeiro/contas-pagar', label: 'Contas a pagar', icon: Receipt, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  { href: '/financeiro/contas-correntes', label: 'Contas correntes', icon: Landmark, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  { href: '/financeiro/extrato', label: 'Extrato', icon: ScrollText, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  { href: '/financeiro/categorias', label: 'Categorias financeiras', icon: Tags, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  // Decisões do dono de 05/11 (migration 360), também só dev (rota-mãe /financeiro em ROTAS_SO_DEV).
  { href: '/financeiro/familias', label: 'Categoria por família', icon: Tags, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  { href: '/financeiro/notas-sem-conta', label: 'Notas sem conta a pagar', icon: Receipt, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  { href: '/financeiro/notas-desfeitas', label: 'Notas desfeitas com conta paga', icon: Receipt, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  // Fase 4 passo 2 (migrations 370/371), também só dev (rota-mãe /financeiro em ROTAS_SO_DEV).
  { href: '/financeiro/aprovacoes', label: 'Aprovação de pagamentos', icon: Receipt, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  { href: '/financeiro/recorrentes', label: 'Contas recorrentes', icon: Receipt, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  { href: '/financeiro/lancamentos', label: 'Lançamentos e transferências', icon: Landmark, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  // Contas a receber das vendas (migration 380), também só dev (rota-mãe /financeiro em ROTAS_SO_DEV).
  { href: '/financeiro/contas-receber', label: 'Contas a receber', icon: HandCoins, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  { href: '/financeiro/formas-recebimento', label: 'Taxas e prazos de recebimento', icon: Percent, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  // DRE e fluxo de caixa (Fase 4 passo 5, migration 390), também só dev (rota-mãe /financeiro em ROTAS_SO_DEV).
  { href: '/financeiro/fluxo-caixa', label: 'Fluxo de caixa', icon: TrendingUp, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  { href: '/financeiro/dre', label: 'DRE', icon: FileBarChart, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  // Fase 5 (T5.3/T5.4, migration 400): relatórios de estoque próprio, só dev (rotas em ROTAS_SO_DEV).
  { href: '/relatorio-consumo', label: 'Consumo teórico × real', icon: Sigma, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  { href: '/relatorio-perdas', label: 'Perdas e desperdício', icon: Trash2, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  { href: '/relatorio-variacao-preco', label: 'Variação de preço nas notas', icon: ChartSpline, group: 'Operação', soEstoqueProprio: true, superAdmin: true },
  { href: '/nota-fiscal', label: 'Notas Fiscais', icon: FileText, group: 'Operação' },
  { href: '/ordem-producao', label: 'Ordens de Produção', icon: Factory, group: 'Operação' },
  { href: '/transferencia', label: 'Transferências', icon: ArrowLeftRight, group: 'Operação' },
  { href: '/inventario', label: 'Inventários', icon: ClipboardList, group: 'Operação' },
  { href: '/movimentacoes', label: 'Movimentações', icon: ArrowDownUp, group: 'Operação' },
  { href: '/validade', label: 'Validade', icon: CalendarClock, group: 'Operação' },
  { href: '/impressoes', label: 'Impressões', icon: Printer, group: 'Operação' },
  { href: '/produto', label: 'Produtos', icon: Package, group: 'Cadastros' },
  { href: '/local-estoque', label: 'Locais de Estoque', icon: Warehouse, group: 'Cadastros' },
  { href: '/familia', label: 'Famílias', icon: FolderTree, group: 'Cadastros' },
  { href: '/grupo-produto', label: 'Grupos e subgrupos', icon: FolderTree, group: 'Cadastros', soEstoqueProprio: true },
  { href: '/sync-catalogo', label: 'Sincronização Vendas', icon: RefreshCw, group: 'Cadastros', soEstoqueProprio: true },
  { href: '/categoria-contabil', label: 'Categorias Contábeis', icon: Tags, group: 'Cadastros' },
  { href: '/fornecedor', label: 'Fornecedores', icon: Truck, group: 'Cadastros' },
  { href: '/compras-cadastros', label: 'Compradores e prazos', icon: UserCog, group: 'Cadastros', soEstoqueProprio: true },
  { href: '/sintegra', label: 'SINTEGRA', icon: ScanLine, group: 'Cadastros' },
  { href: '/sync-status', label: 'Saúde da integração', icon: Activity, group: 'Cadastros', admin: true },
  { href: '/log', label: 'Logs de Integração', icon: ScrollText, group: 'Cadastros', admin: true },
  { href: '/resumo', label: 'Resumo Operacional', icon: CalendarCheck, group: 'Administração', gestaoUsuarios: true },
  { href: '/relatorios', label: 'Relatórios', icon: BarChart3, group: 'Administração', gestaoUsuarios: true },
  { href: '/contador', label: 'Contador e fechamento', icon: BookOpenCheck, group: 'Administração', gestaoUsuarios: true, superAdmin: true },
  { href: '/minha-loja', label: 'Minha loja', icon: Settings, group: 'Administração', gestaoUsuarios: true, cadeadoSemAdmin: true },
  { href: '/loja', label: 'Lojas', icon: Store, group: 'Administração', admin: true },
  { href: '/saude-banco', label: 'Saúde do Banco', icon: Database, group: 'Administração', superAdmin: true },
  { href: '/usuario', label: 'Usuários', icon: Users, group: 'Administração', gestaoUsuarios: true },
]
