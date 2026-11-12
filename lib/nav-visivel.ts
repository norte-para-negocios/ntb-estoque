// Regra única de visibilidade de um item de menu (admin, gestão, dev, modo da loja, permissão).
// Usada por Sidebar, MobileNav e pela central de módulos. Só importa regra pura: roda no node --test e não carrega nomes de telas.
// @ts-expect-error: o node --test (type stripping) exige a extensão .ts; o tsc do Next não a aceita
import { moduloDaRota, type Acesso, type ModuloId } from './plataforma/modulos-puro.ts'

/** Subconjunto estrutural de NavItem (sem o ícone). */
export type NavRegra = {
  href: string
  admin?: boolean
  gestaoUsuarios?: boolean
  superAdmin?: boolean
  soEstoqueProprio?: boolean
  comEstoque?: boolean
  ouPedidosOmie?: boolean
  /** Pacioli (robô de correções): só dev (admin) e lojas que contrataram o robô. */
  soPacioli?: boolean
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
  /** Loja atual contratou o Pacioli, ou o usuário é dev/admin. */
  pacioli?: boolean
  /** Plataforma Norte: acesso da loja atual a cada módulo. Ausente = menu como antes. Módulo em 'vitrine' some do menu. */
  modulos?: Record<ModuloId, Acesso>
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
    (!n.soPacioli || !!ctx.pacioli) &&
    !moduloEmVitrine(n.href, ctx.modulos) &&
    // Pacioli não depende da permissão por perfil: a loja que paga o robô vê para todos os usuários dela.
    // Cozinha idem: não tem entrada em permissoes-menu; com o módulo aberto ('abre') aparece para todos da loja.
    (permitidas === null || permitidas.has(n.href) || (!!n.soPacioli && !!ctx.pacioli) || cozinhaAberta(n.href, ctx.modulos))
  )
}

function cozinhaAberta(href: string, modulos: CtxVisibilidade['modulos']): boolean {
  return moduloDaRota(href) === 'cozinha' && modulos?.cozinha === 'abre'
}

function moduloEmVitrine(href: string, modulos: CtxVisibilidade['modulos']): boolean {
  if (!modulos) return false
  const m = moduloDaRota(href)
  return m != null && modulos[m] === 'vitrine'
}

/** Menu novo (por módulos) só existe para desenvolvedores; quem não é dev nunca o recebe. */
export function menuNovoAtivo(isSuperAdmin: boolean, preferencia: string | null): boolean {
  return isSuperAdmin && preferencia !== 'antigo'
}
