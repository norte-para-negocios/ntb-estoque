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
  ShoppingCart,
  type LucideIcon,
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
  // soOmie: telas que dependem do Omie; somem quando a loja usa o estoque proprio.
  soOmie?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/home', label: 'Início', icon: LayoutDashboard, group: 'Operação' },
  { href: '/estoque', label: 'Estoque', icon: Boxes, group: 'Operação', soEstoqueProprio: true },
  { href: '/compras', label: 'Compras', icon: ShoppingCart, group: 'Operação', soEstoqueProprio: true },
  { href: '/producao-propria', label: 'Produção', icon: CookingPot, group: 'Operação', soEstoqueProprio: true },
  { href: '/inventario-proprio', label: 'Contagens', icon: ClipboardCheck, group: 'Operação', soEstoqueProprio: true },
  { href: '/reposicao', label: 'Reposição', icon: ShoppingCart, group: 'Operação', soEstoqueProprio: true },
  { href: '/nota-fiscal', label: 'Notas Fiscais', icon: FileText, group: 'Operação', soOmie: true },
  { href: '/ordem-producao', label: 'Ordens de Produção', icon: Factory, group: 'Operação', soOmie: true },
  { href: '/transferencia', label: 'Transferências', icon: ArrowLeftRight, group: 'Operação', soOmie: true },
  { href: '/inventario', label: 'Inventários', icon: ClipboardList, group: 'Operação', soOmie: true },
  { href: '/movimentacoes', label: 'Movimentações', icon: ArrowDownUp, group: 'Operação', soOmie: true },
  { href: '/validade', label: 'Validade', icon: CalendarClock, group: 'Operação' },
  { href: '/impressoes', label: 'Impressões', icon: Printer, group: 'Operação' },
  { href: '/produto', label: 'Produtos', icon: Package, group: 'Cadastros' },
  { href: '/ficha-tecnica', label: 'Fichas técnicas', icon: ChefHat, group: 'Cadastros', soEstoqueProprio: true },
  { href: '/local-estoque', label: 'Locais de Estoque', icon: Warehouse, group: 'Cadastros' },
  { href: '/familia', label: 'Famílias', icon: FolderTree, group: 'Cadastros' },
  { href: '/categoria-contabil', label: 'Categorias Contábeis', icon: Tags, group: 'Cadastros' },
  { href: '/fornecedor', label: 'Fornecedores', icon: Truck, group: 'Cadastros' },
  { href: '/sintegra', label: 'SINTEGRA', icon: ScanLine, group: 'Cadastros' },
  { href: '/sync-status', label: 'Saúde da integração', icon: Activity, group: 'Cadastros', admin: true },
  { href: '/log', label: 'Logs de Integração', icon: ScrollText, group: 'Cadastros', admin: true },
  { href: '/resumo', label: 'Resumo Operacional', icon: CalendarCheck, group: 'Administração', gestaoUsuarios: true },
  { href: '/relatorios', label: 'Relatórios', icon: BarChart3, group: 'Administração', gestaoUsuarios: true },
  { href: '/minha-loja', label: 'Minha loja', icon: Settings, group: 'Administração', gestaoUsuarios: true, cadeadoSemAdmin: true },
  { href: '/loja', label: 'Lojas', icon: Store, group: 'Administração', admin: true },
  { href: '/saude-banco', label: 'Saúde do Banco', icon: Database, group: 'Administração', superAdmin: true },
  { href: '/usuario', label: 'Usuários', icon: Users, group: 'Administração', gestaoUsuarios: true },
]
