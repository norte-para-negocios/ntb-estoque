import {
  Activity, Archive, ArrowDownUp, ArrowLeftRight, BadgeCheck, BadgeDollarSign, Banknote, BarChart3, BookOpen, BookOpenCheck, Bot,
  Boxes, Building2, Calculator, CalendarClock, CalendarRange, ChartBar, ChartBarDecreasing, ChartBarStacked, ChartColumnStacked,
  ChartLine, ChartSpline, ClipboardCheck, ClipboardList, ClipboardPen, Coins, Cog, Database, Factory, FileCode2, FileDown,
  FileOutput, FilePenLine, FileQuestion, FileSearch, FileSpreadsheet, FileText, FileUp, FolderTree, Gauge, Goal, Group,
  HandCoins, History, Hourglass, IdCard, Landmark, Layers, LayoutDashboard, Lightbulb, List, ListChecks, ListOrdered,
  ListPlus, ListTree, Logs, MonitorDown, Network, Package, PackageCheck, PackagePlus, PackageSearch, Percent, PiggyBank, Plus,
  Presentation, Printer, QrCode, Receipt, ReceiptText, RefreshCw, Repeat, Replace, Scale, ScanSearch, ScrollText, Search, Shapes,
  ShieldCheck, ShoppingCart, Sigma, SlidersHorizontal, SquareKanban, Stethoscope, Store, Table2, Tags, Target, TrendingDown,
  TrendingUp, Truck, Undo2, Upload, UserCog, UserSearch, Users, Vault, Wallet, Warehouse, Wrench,
  type LucideIcon,
} from 'lucide-react'

/** Tom do bloco do ícone: dá cor a cada tipo de ação (Incluir verde, Importar azul, Relatório roxo…). */
export type Tom = 'marca' | 'novo' | 'importar' | 'relatorio' | 'alerta' | 'neutro'

export const CLASSE_TOM: Record<Tom, string> = {
  marca: 'bg-brand-soft text-brand',
  novo: 'bg-[color-mix(in_srgb,var(--tone-new)_15%,transparent)] text-[var(--tone-new)]',
  importar: 'bg-[color-mix(in_srgb,var(--tone-import)_15%,transparent)] text-[var(--tone-import)]',
  relatorio: 'bg-[color-mix(in_srgb,var(--tone-report)_15%,transparent)] text-[var(--tone-report)]',
  alerta: 'bg-[color-mix(in_srgb,var(--tone-warn)_16%,transparent)] text-[var(--tone-warn)]',
  neutro: 'bg-surface-2 text-text-muted',
}

type Regra = [RegExp, LucideIcon, Tom]

// Reserva (item sem endereço no mapa): a primeira que casar vence. Texto já sem acento e em minúsculas.
const REGRAS: Regra[] = [
  [/^incluir transferencia|transferencia/, ArrowLeftRight, 'marca'],
  [/^incluir|lancar sem xml/, Plus, 'novo'],
  [/importar xml/, FileDown, 'importar'],
  [/importar/, Upload, 'importar'],
  [/^exibir extrato|extrato/, ScrollText, 'marca'],
  [/^exibir|^registrar/, List, 'marca'],
  [/dre/, Percent, 'relatorio'],
  [/fluxo de caixa/, TrendingUp, 'relatorio'],
  [/relatorio|posicao|valorizado|cmv/, BarChart3, 'relatorio'],
  [/painel|dashboard/, LayoutDashboard, 'marca'],
  [/resumo/, Gauge, 'marca'],
  [/robo/, Bot, 'marca'],
  [/central de correcoes|correcoes/, ClipboardCheck, 'alerta'],
  [/notas? fiscais?|notas de entrada|nota fiscal/, ReceiptText, 'marca'],
  [/nf-e de saida/, FileText, 'marca'],
  [/contador|fechamento/, BookOpen, 'marca'],
  [/categorias/, FolderTree, 'marca'],
  [/contas a pagar/, TrendingDown, 'marca'],
  [/contas a receber|recebiment/, TrendingUp, 'marca'],
  [/aprovacao/, BadgeCheck, 'alerta'],
  [/contas correntes/, Landmark, 'marca'],
  [/lancamento/, ListPlus, 'novo'],
  [/pagamentos/, Wallet, 'marca'],
  [/kardex/, ListOrdered, 'marca'],
  [/ajustes/, Scale, 'marca'],
  [/fichas|estrutura dos produtos/, Layers, 'marca'],
  [/quem mexeu|logs?/, History, 'marca'],
  [/reposicao|minimo/, PackagePlus, 'alerta'],
  [/movimentac/, Repeat, 'marca'],
  [/inventario/, ClipboardList, 'marca'],
  [/validade/, CalendarClock, 'alerta'],
  [/estoque/, Boxes, 'marca'],
  [/produtos substitutos|produtos?$/, Package, 'marca'],
  [/locais/, Warehouse, 'marca'],
  [/familias|grupos/, Tags, 'marca'],
  [/sincroniza|saude da integracao/, RefreshCw, 'marca'],
  [/saude do banco/, Database, 'marca'],
  [/etiquetas|impress/, Printer, 'marca'],
  [/sugestao/, ShoppingCart, 'alerta'],
  [/tarefas/, ListChecks, 'marca'],
  [/fornecedores|compradores/, Truck, 'marca'],
  [/sintegra/, ShieldCheck, 'marca'],
  [/pedidos?|requisic/, ShoppingCart, 'marca'],
  [/etapas do recebimento/, PackageCheck, 'marca'],
  [/devoluc/, Undo2, 'marca'],
  [/ordens?|^abertas/, Cog, 'marca'],
  [/usuarios|cargos/, Users, 'marca'],
  [/^lojas|minha loja/, Store, 'marca'],
  [/qr/, QrCode, 'marca'],
  [/sistema/, Wrench, 'marca'],
]

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

type Icone = [LucideIcon, Tom]

/**
 * Um ícone por tela, pelo endereço (auditoria 22/10: escolher pelo nome dava gráfico para "Reposição", que contém
 * "posição", e 17 itens caíam no ícone genérico). Chave = endereço sem a query; a query só entra quando a mesma
 * página tem dois itens (Estoque mínimo × Sugestão de compra). O teste falha se uma tela visível ficar sem ícone.
 */
export const ICONE_POR_ROTA: Record<string, Icone> = {
  // Dashboard
  '/home': [LayoutDashboard, 'marca'],
  '/resumo': [CalendarRange, 'marca'],
  '/correcoes': [Bot, 'marca'],
  // Estoque
  '/estoque': [Boxes, 'marca'],
  '/estoque/correcoes': [Stethoscope, 'alerta'],
  '/movimentacoes': [ArrowDownUp, 'marca'],
  '/inventario': [ClipboardList, 'marca'],
  '/transferencia': [ArrowLeftRight, 'marca'],
  '/validade': [CalendarClock, 'alerta'],
  '/reposicao': [PackagePlus, 'alerta'],
  '/estoque/kardex': [ListOrdered, 'marca'],
  '/estoque/ajustes': [SlidersHorizontal, 'marca'],
  '/estoque/fichas': [ListTree, 'marca'],
  '/estoque/quem-mexeu': [UserSearch, 'marca'],
  '/sync-catalogo': [RefreshCw, 'marca'],
  '/produto': [Package, 'marca'],
  '/produto/novo': [Package, 'novo'],
  '/produto/importar': [FileSpreadsheet, 'importar'],
  '/produto-substituicao': [Replace, 'marca'],
  '/local-estoque': [Warehouse, 'marca'],
  '/familia': [Tags, 'marca'],
  '/grupo-produto': [Group, 'marca'],
  '/relatorio-posicao-estoque': [Table2, 'relatorio'],
  '/relatorio-estoque-valorizado': [Coins, 'relatorio'],
  '/sugestao-compra?ver=abaixo': [PackagePlus, 'relatorio'],
  '/relatorio-curva-abc': [ChartBarDecreasing, 'relatorio'],
  '/relatorio-cmv': [Calculator, 'relatorio'],
  '/relatorio-movimentacao': [ChartColumnStacked, 'relatorio'],
  // Compras
  '/pedido-compra/novo': [ShoppingCart, 'novo'],
  '/requisicao-compra/novo': [ClipboardPen, 'novo'],
  '/nota-fiscal/importar': [FileCode2, 'importar'],
  '/nota-fiscal/nova': [FilePenLine, 'novo'],
  '/pedido-compra/importar': [FileSpreadsheet, 'importar'],
  '/nota-fiscal': [ReceiptText, 'marca'],
  '/sugestao-compra': [Lightbulb, 'alerta'],
  '/tarefas-compras': [ListChecks, 'marca'],
  '/pedido-compra': [ShoppingCart, 'marca'],
  '/requisicao-compra': [ClipboardPen, 'marca'],
  '/nota-fiscal/etapas': [SquareKanban, 'marca'],
  '/devolucao-fornecedor': [Undo2, 'marca'],
  '/sintegra': [ScanSearch, 'marca'],
  '/fornecedor': [Truck, 'marca'],
  '/fornecedor/importar': [FileSpreadsheet, 'importar'],
  '/compras-cadastros': [UserCog, 'marca'],
  '/relatorio-compras': [ChartBar, 'relatorio'],
  '/relatorio-produtos-fornecedor': [PackageSearch, 'relatorio'],
  // Produção
  '/ordem-producao': [Factory, 'marca'],
  '/ordem-producao/abertas': [Hourglass, 'marca'],
  '/impressoes': [Printer, 'marca'],
  '/relatorio-ops': [ChartBarStacked, 'relatorio'],
  '/relatorio-producao': [ChartLine, 'relatorio'],
  // Fiscal
  '/nfe-saida': [FileOutput, 'marca'],
  '/transferencia-loja': [Building2, 'marca'],
  '/contador': [BookOpenCheck, 'marca'],
  '/categoria-contabil': [FolderTree, 'marca'],
  '/auditoria-fiscal': [FileSearch, 'relatorio'],
  '/pendencias-classificacao': [FileQuestion, 'relatorio'],
  // Finanças
  '/financeiro/contas-pagar': [Receipt, 'marca'],
  '/financeiro/contas-pagar/nova': [Receipt, 'novo'],
  '/financeiro/extrato': [ScrollText, 'marca'],
  '/financeiro/contas-correntes': [Landmark, 'marca'],
  '/financeiro/categorias': [Shapes, 'marca'],
  '/relatorio-mensal': [Presentation, 'relatorio'],
  '/faturamento': [BadgeDollarSign, 'relatorio'],
  '/relatorio-faturamento': [FileSpreadsheet, 'relatorio'],
  '/relatorio-indicadores': [Scale, 'relatorio'],
  '/relatorio-margem': [Percent, 'relatorio'],
  '/relatorio-lucro': [PiggyBank, 'relatorio'],
  '/meta-mensal': [Target, 'relatorio'],
  '/relatorio-meta': [Goal, 'relatorio'],
  // Administração
  '/relatorios': [BarChart3, 'relatorio'],
  '/sync-status': [Activity, 'marca'],
  '/log': [Logs, 'marca'],
  '/saude-banco': [Database, 'marca'],
  '/sincronizacao': [MonitorDown, 'marca'],
  '/minha-loja': [Store, 'marca'],
  '/usuario': [Users, 'marca'],
  '/cargo': [IdCard, 'marca'],
  '/loja': [Network, 'marca'],
}

/** Itens "em breve" (sem endereço): pelo nome. */
const ICONE_POR_ROTULO: Record<string, Icone> = {
  'resumo do caixa': [Vault, 'marca'],
  'contas a receber': [HandCoins, 'marca'],
  'aprovacao de pagamentos': [BadgeCheck, 'alerta'],
  'lancamento avulso': [ListPlus, 'novo'],
  'transferencia entre contas': [Banknote, 'marca'],
  'importar extrato ofx': [FileUp, 'importar'],
  'importar contas a pagar (planilha)': [FileSpreadsheet, 'importar'],
  'contas a pagar em aberto': [TrendingDown, 'relatorio'],
  'pagamentos realizados': [Wallet, 'relatorio'],
  'fluxo de caixa': [ChartSpline, 'relatorio'],
  dre: [Sigma, 'relatorio'],
}

// Botões de ação dentro de um cadastro (Incluir, Importar planilha, Exibir todos): o verbo manda.
const ACOES: [RegExp, Icone][] = [
  [/^incluir/, [Plus, 'novo']],
  [/^importar/, [FileSpreadsheet, 'importar']],
  [/^exibir/, [List, 'marca']],
]

const semQuery = (h: string) => h.split('?')[0]

/** Ícone e tom do item: verbo de ação > endereço da tela > nome (itens em breve) > reserva pelo texto. */
export function iconeDoItem(label: string, secao?: string, href?: string): { Icon: LucideIcon; tom: Tom } {
  const l = norm(label)
  for (const [re, [Icon, tom]] of ACOES) if (re.test(l)) return { Icon, tom }
  if (href) {
    const e = ICONE_POR_ROTA[href] ?? ICONE_POR_ROTA[semQuery(href)]
    if (e) return { Icon: e[0], tom: e[1] }
  }
  const r = ICONE_POR_ROTULO[l]
  if (r) return { Icon: r[0], tom: r[1] }
  const comSecao = secao ? norm(`${l} ${secao}`) : l
  for (const [re, Icon, tom] of REGRAS) if (re.test(l)) return { Icon, tom }
  for (const [re, Icon, tom] of REGRAS) if (re.test(comSecao)) return { Icon, tom }
  return { Icon: FileText, tom: 'neutro' }
}

/** Ícone do cabeçalho de cada seção. */
export function iconeDaSecao(nome: string): LucideIcon {
  const n = norm(nome)
  const h = (re: RegExp) => re.test(n)
  if (h(/relatorio/)) return BarChart3
  if (h(/contas a pagar/)) return TrendingDown
  if (h(/contas a receber/)) return TrendingUp
  if (h(/contas correntes/)) return Landmark
  if (h(/categorias/)) return FolderTree
  if (h(/movimentacao/)) return ArrowLeftRight
  if (h(/produtos/)) return Package
  if (h(/locais/)) return Warehouse
  if (h(/familias|grupos/)) return Tags
  if (h(/sincroniza|sistema/)) return RefreshCw
  if (h(/transferenc/)) return ArrowLeftRight
  if (h(/impress/)) return Printer
  if (h(/consultas/)) return Search
  if (h(/fornecedores/)) return Truck
  if (h(/pedidos|requisic/)) return ShoppingCart
  if (h(/notas/)) return ReceiptText
  if (h(/devoluc/)) return Undo2
  if (h(/producao/)) return Cog
  if (h(/usuarios/)) return UserCog
  if (h(/lojas/)) return Store
  return Archive
}
