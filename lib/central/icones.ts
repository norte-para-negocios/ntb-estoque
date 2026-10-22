import {
  Activity, Archive, ArrowLeftRight, BadgeCheck, BarChart3, BookOpen, Bot, Boxes, Building2, CalendarClock,
  ClipboardCheck, ClipboardList, Cog, Database, FileDown, FileSpreadsheet, FileText, FileUp, FolderTree, Gauge,
  GitBranch, HeartPulse, History, Landmark, Layers, LayoutDashboard, ListChecks, ListOrdered, ListPlus, Package,
  PackageCheck, PackagePlus, Percent, PiggyBank, Printer, QrCode, Receipt, ReceiptText, RefreshCw, Repeat, Scale,
  ScrollText, Search, ShieldCheck, ShoppingCart, Store, Tags, TrendingDown, TrendingUp, Truck, Undo2, UserCog,
  Users, Wallet, Warehouse, Wrench, Plus, Upload, List,
  type LucideIcon,
} from 'lucide-react'

/** Tom do bloco do ícone: dá cor a cada tipo de ação (Incluir verde, Importar azul, Relatório roxo…). */
export type Tom = 'marca' | 'novo' | 'importar' | 'relatorio' | 'alerta' | 'neutro'

export const CLASSE_TOM: Record<Tom, string> = {
  marca: 'bg-brand-soft text-brand',
  novo: 'bg-[color-mix(in_srgb,#16a34a_15%,transparent)] text-[#16a34a]',
  importar: 'bg-[color-mix(in_srgb,#2563eb_15%,transparent)] text-[#3b82f6]',
  relatorio: 'bg-[color-mix(in_srgb,#7c3aed_15%,transparent)] text-[#8b5cf6]',
  alerta: 'bg-[color-mix(in_srgb,#d97706_16%,transparent)] text-[#d97706]',
  neutro: 'bg-surface-2 text-text-muted',
}

type Regra = [RegExp, LucideIcon, Tom]

// Ordem importa: a primeira que casar vence. Texto já sem acento e em minúsculas.
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
  [/painel inicial|dashboard/, LayoutDashboard, 'marca'],
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
  [/devolucao/, Undo2, 'marca'],
  [/ordens? de producao|^abertas/, Cog, 'marca'],
  [/usuarios|cargos/, Users, 'marca'],
  [/^lojas|minha loja/, Store, 'marca'],
  [/qr/, QrCode, 'marca'],
  [/sistema/, Wrench, 'marca'],
]

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Ícone e tom do item pelo nome (rótulo), com a seção como segunda pista. */
export function iconeDoItem(label: string, secao?: string): { Icon: LucideIcon; tom: Tom } {
  const l = norm(label)
  const comSecao = secao ? norm(`${l} ${secao}`) : l
  for (const [re, Icon, tom] of REGRAS) if (re.test(l)) return { Icon, tom }
  // "Exibir todos/todas/Incluir" já casaram acima; o resto herda a pista da seção.
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
  if (h(/devolucao/)) return Undo2
  if (h(/producao/)) return Cog
  if (h(/usuarios/)) return UserCog
  if (h(/lojas/)) return Store
  return Archive
}
