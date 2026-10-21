// Regra única de visibilidade de um item de menu (admin, gestão, dev, modo da loja, permissão).
// Usada por Sidebar, MobileNav e pela central de módulos. Sem imports: roda no node --test e não carrega nomes de telas.

/** Subconjunto estrutural de NavItem (sem o ícone). */
export type NavRegra = {
  href: string
  admin?: boolean
  gestaoUsuarios?: boolean
  superAdmin?: boolean
  soEstoqueProprio?: boolean
  comEstoque?: boolean
  ouPedidosOmie?: boolean
  cadeadoSemAdmin?: boolean
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
  /** App Norte Estoque para computador (NEXT_PUBLIC_DESKTOP). */
  desktop: boolean
}

/** Filtro do menu lateral. `permitidas` pode vir pré-calculada (evita refazer o Set a cada item). */
export function navItemVisivel(
  n: NavRegra,
  ctx: CtxVisibilidade,
  permitidas: Set<string> | null = ctx.rotasVisiveis ? new Set(ctx.rotasVisiveis) : null
): boolean {
  return (
    (!n.admin || ctx.isAdmin) &&
    (!n.gestaoUsuarios || ctx.isAdmin || ctx.podeGerirUsuarios) &&
    (!n.superAdmin || ctx.isSuperAdmin) &&
    (!n.soEstoqueProprio || ctx.estoqueProprio || (!!n.ouPedidosOmie && ctx.pedidosOmie)) &&
    (!n.comEstoque || ctx.temEstoque) &&
    (permitidas === null || permitidas.has(n.href))
  )
}

/** Menu novo (por módulos) só existe para desenvolvedores; quem não é dev nunca o recebe. */
export function menuNovoAtivo(isSuperAdmin: boolean, preferencia: string | null): boolean {
  return isSuperAdmin && preferencia !== 'antigo'
}
