import {
  LayoutDashboard,
  FileText,
  Factory,
  ArrowLeftRight,
  ArrowDownUp,
  ClipboardList,
  CalendarClock,
  Printer,
  Package,
  Warehouse,
  ScrollText,
  Activity,
  Scale,
  ShieldCheck,
  Percent,
  Store,
  Users,
  IdCard,
  FolderTree,
  Truck,
  ScanLine,
  Settings,
  CalendarCheck,
  ShoppingCart,
  DollarSign,
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
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/home', label: 'Início', icon: LayoutDashboard, group: 'Operação' },
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
  { href: '/fornecedor', label: 'Fornecedores', icon: Truck, group: 'Cadastros' },
  { href: '/sintegra', label: 'SINTEGRA', icon: ScanLine, group: 'Cadastros' },
  { href: '/sync-status', label: 'Saúde da integração', icon: Activity, group: 'Cadastros', admin: true },
  { href: '/log', label: 'Logs de Integração', icon: ScrollText, group: 'Cadastros', admin: true },
  { href: '/resumo', label: 'Resumo do dia', icon: CalendarCheck, group: 'Administração', gestaoUsuarios: true },
  { href: '/relatorio-compras', label: 'Compras (BETA)', icon: ShoppingCart, group: 'Administração', gestaoUsuarios: true },
  { href: '/relatorio-movimentacao', label: 'Movimentação (BETA)', icon: ArrowDownUp, group: 'Administração', gestaoUsuarios: true },
  { href: '/relatorio-faturamento', label: 'Faturamento (BETA)', icon: DollarSign, group: 'Administração', gestaoUsuarios: true },
  { href: '/relatorio-indicadores', label: 'Fat × Compras (BETA)', icon: Scale, group: 'Administração', gestaoUsuarios: true },
  { href: '/auditoria-fiscal', label: 'Auditoria fiscal (BETA)', icon: ShieldCheck, group: 'Administração', gestaoUsuarios: true },
  { href: '/relatorio-margem', label: 'Margem (BETA)', icon: Percent, group: 'Administração', gestaoUsuarios: true },
  { href: '/minha-loja', label: 'Minha loja', icon: Settings, group: 'Administração', gestaoUsuarios: true, cadeadoSemAdmin: true },
  { href: '/loja', label: 'Lojas', icon: Store, group: 'Administração', admin: true },
  { href: '/usuario', label: 'Usuários', icon: Users, group: 'Administração', gestaoUsuarios: true },
  { href: '/cargo', label: 'Cargos', icon: IdCard, group: 'Administração', gestaoUsuarios: true },
]
