// Só tipos de './modulos' (apagados na compilação): assim este arquivo roda no node --test sem resolver extensão.
import type { ItemCentral, ModuloCentral } from './modulos'

const semQuery = (href: string) => href.split('?')[0]

// Visibilidade dos itens da central. NÃO inventa regra nova: cada item herda a do item de menu (NAV_ITEMS) dono da rota,
// com exatamente o mesmo filtro que Sidebar.tsx / MobileNav.tsx aplicam hoje.

/** Subconjunto estrutural de NavItem (sem o ícone), para não acoplar este arquivo ao lucide/NavItems. */
export type NavRegra = {
  href: string
  admin?: boolean
  gestaoUsuarios?: boolean
  superAdmin?: boolean
  soEstoqueProprio?: boolean
  comEstoque?: boolean
  ouPedidosOmie?: boolean
}

/** Mesmos valores que app/(app)/layout.tsx entrega ao AppShell. */
export type CtxVisibilidade = {
  isAdmin: boolean
  isSuperAdmin: boolean
  podeGerirUsuarios: boolean
  /** null = admin/super admin (vê tudo). */
  rotasVisiveis: string[] | null
  estoqueProprio: boolean
  temEstoque: boolean
  pedidosOmie: boolean
}

/**
 * Espelho de ROTAS_SO_DEV (lib/recursos-dev.ts). Não dá para importar de lá num componente de cliente
 * (puxa lib/auth, só servidor). lib/central/modulos.test.ts garante que as duas listas não se afastem.
 */
export const ROTAS_SO_DEV_ESPELHO: readonly string[] = [
  '/sugestao-compra',
  '/tarefas-compras',
  '/requisicao-compra',
  '/pedido-compra',
  '/devolucao-fornecedor',
  '/nfe-saida',
  '/transferencia-loja',
  '/contador',
  '/relatorio-posicao-estoque',
  '/relatorio-cmv',
  '/relatorio-produtos-fornecedor',
]

/** Item de menu que governa a visibilidade do item da central (regra explícita ou NAV de maior prefixo). */
export function navDoItem(item: ItemCentral, nav: readonly NavRegra[]): NavRegra | null {
  if (item.regra) return nav.find((n) => n.href === item.regra) ?? null
  if (!item.href) return null
  const h = semQuery(item.href)
  let melhor: NavRegra | null = null
  for (const n of nav) {
    if ((h === n.href || h.startsWith(n.href + '/')) && (melhor == null || n.href.length > melhor.href.length)) melhor = n
  }
  return melhor
}

/** Mesmo filtro de Sidebar/MobileNav, aplicado a um item de menu. */
export function navVisivel(n: NavRegra, ctx: CtxVisibilidade): boolean {
  const permitidas = ctx.rotasVisiveis ? new Set(ctx.rotasVisiveis) : null
  return (
    (!n.admin || ctx.isAdmin) &&
    (!n.gestaoUsuarios || ctx.isAdmin || ctx.podeGerirUsuarios) &&
    (!n.superAdmin || ctx.isSuperAdmin) &&
    (!n.soEstoqueProprio || ctx.estoqueProprio || (!!n.ouPedidosOmie && ctx.pedidosOmie)) &&
    (!n.comEstoque || ctx.temEstoque) &&
    (permitidas === null || permitidas.has(n.href))
  )
}

export function itemVisivel(item: ItemCentral, nav: readonly NavRegra[], ctx: CtxVisibilidade): boolean {
  if (item.emBreve) return true // "em breve" aparece sempre (desabilitado); Finanças é só informativo
  const n = navDoItem(item, nav)
  return n ? navVisivel(n, ctx) : true
}

/** Etiqueta "só dev": item de menu superAdmin ou rota ainda listada em ROTAS_SO_DEV. */
export function itemSoDev(item: ItemCentral, nav: readonly NavRegra[]): boolean {
  if (item.emBreve || !item.href) return false
  if (navDoItem(item, nav)?.superAdmin) return true
  const h = semQuery(item.href)
  return ROTAS_SO_DEV_ESPELHO.some((r) => h === r || h.startsWith(r + '/'))
}

export type ItemPronto = ItemCentral & { soDev: boolean }
export type SecaoPronta = { nome: string; itens: ItemPronto[] }
export type ModuloPronto = {
  id: string
  nome: string
  desc: string
  icone: ModuloCentral['icone']
  atalhos: ItemPronto[]
  secoes: SecaoPronta[]
}

/** Módulo já filtrado por permissão/loja, com a etiqueta "só dev" calculada. Seções vazias somem. */
export function moduloVisivel(m: ModuloCentral, nav: readonly NavRegra[], ctx: CtxVisibilidade): ModuloPronto {
  const pronto = (i: ItemCentral): ItemPronto => ({ ...i, soDev: itemSoDev(i, nav) })
  const ok = (i: ItemCentral) => itemVisivel(i, nav, ctx)
  return {
    id: m.id,
    nome: m.nome,
    desc: m.desc,
    icone: m.icone,
    atalhos: m.atalhos.filter(ok).map(pronto),
    secoes: m.secoes
      .map((s) => ({ nome: s.nome, itens: s.itens.filter(ok).map(pronto) }))
      .filter((s) => s.itens.length > 0),
  }
}

/** Módulos que aparecem no menu: com ao menos um item utilizável (Finanças, só "em breve", aparece sempre). */
export function modulosVisiveis(modulos: readonly ModuloCentral[], nav: readonly NavRegra[], ctx: CtxVisibilidade): ModuloPronto[] {
  return modulos.map((m) => moduloVisivel(m, nav, ctx)).filter(
    (m) => m.atalhos.length > 0 || m.secoes.length > 0
  )
}
