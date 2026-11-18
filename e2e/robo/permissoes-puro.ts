// Lógica pura do robô de permissões (ticket 10): matriz cargo × tela/ação e comparação com o que o ERP realmente mostrou.
// Sem rede, sem navegador, sem banco. A regra de cada rota é DERIVADA do código do ERP (menu, MENU_PERMISSAO, ROTAS_SO_DEV)
// mais uma tabela de extras para as telas fora do menu (conferidas à mão nas páginas, ver permissoes-matriz.ts).
import { classificarAcao } from './relatorio.ts'

export type Usuario = { perfil: string | null; superAdmin: boolean; permissoes: Set<string> }

/** Condições que se SOMAM (todas precisam valer). `anyOf` = basta uma das permissões. */
export type Regra = { livre?: boolean; dev?: boolean; admin?: boolean; gestao?: boolean; anyOf?: string[] }

export type Decisao = { permitido: boolean; motivo: string }

export function decidir(regra: Regra, u: Usuario): Decisao {
  if (regra.dev && !u.superAdmin) return { permitido: false, motivo: 'exige desenvolvedor (is_super_admin)' }
  if (regra.admin && u.perfil !== 'Admin') return { permitido: false, motivo: 'exige perfil Admin' }
  if (regra.gestao && u.perfil !== 'Admin' && u.perfil !== 'AdminLoja') return { permitido: false, motivo: 'exige Admin ou AdminLoja' }
  if (regra.anyOf?.length && !u.permissoes.has('*') && !regra.anyOf.some((p) => u.permissoes.has(p)))
    return { permitido: false, motivo: `exige permissão ${regra.anyOf.join(' ou ')}` }
  return { permitido: true, motivo: 'permitido pela matriz' }
}

export function ordemDeRegra(r: Regra): string {
  const p: string[] = []
  if (r.livre) p.push('livre')
  if (r.dev) p.push('dev')
  if (r.admin) p.push('perfil Admin')
  if (r.gestao) p.push('Admin ou AdminLoja')
  if (r.anyOf?.length) p.push(r.anyOf.length === 1 ? r.anyOf[0] : `(${r.anyOf.join(' ou ')})`)
  return p.join(' + ') || 'livre'
}

export type NavMin = { href: string; admin?: boolean; gestaoUsuarios?: boolean; superAdmin?: boolean }
export type CtxRegras = {
  nav: NavMin[]
  menuPermissao: Record<string, string>
  rotasSoDev: readonly string[]
  /** Regras das rotas que não estão no menu (conferidas nas páginas). */
  extras: Record<string, Regra>
}

const sob = (rota: string, prefixo: string) => rota === prefixo || rota.startsWith(prefixo + '/')

export function regraDaRota(rota: string, c: CtxRegras): Regra | null {
  const nav = c.nav.find((n) => n.href === rota)
  const extra = c.extras[rota]
  if (!nav && !extra) return null
  const r: Regra = extra ? { ...extra } : {}
  if (nav) {
    if (nav.admin) r.admin = true
    if (nav.gestaoUsuarios) r.gestao = true
    if (nav.superAdmin) r.dev = true
    const p = c.menuPermissao[rota]
    if (p && !r.anyOf) r.anyOf = [p]
  }
  if (c.rotasSoDev.some((d) => sob(rota, d))) r.dev = true
  return Object.keys(r).length ? r : { livre: true }
}

/** Lê a lista ROTAS_SO_DEV do texto de lib/recursos-dev.ts (o arquivo usa o alias @/, não dá para importar no node). */
export function lerRotasSoDev(src: string): string[] {
  const m = src.match(/ROTAS_SO_DEV\s*=\s*\[([\s\S]*?)\]/)
  if (!m) return []
  const semComentario = m[1].replace(/\/\/.*$/gm, '')
  return [...semComentario.matchAll(/'(\/[^']*)'/g)].map((x) => x[1])
}

// ---- Resposta HTTP → resultado ----
export type Resultado = { tipo: 'abriu' } | { tipo: 'bloqueada' } | { tipo: 'erro' } | { tipo: 'redireciona'; destino: string }
export type RespostaHttp = { status: number; location?: string | null; corpo: string }

const caminho = (u: string) => new URL(u, 'http://local').pathname.replace(/\/$/, '') || '/'

/** O Next entrega a página 404 com HTTP 200 quando já começou a transmitir: só o corpo denuncia. */
export function classificarResposta(r: RespostaHttp): Resultado {
  if (r.status >= 300 && r.status < 400) return r.location ? { tipo: 'redireciona', destino: caminho(r.location) } : { tipo: 'erro' }
  if (r.status >= 500) return { tipo: 'erro' }
  if (r.status >= 400) return { tipo: 'bloqueada' }
  const meta = r.corpo.match(/http-equiv="refresh"[^>]*content="\d+;\s*url=([^"]+)"/)
  if (meta) return { tipo: 'redireciona', destino: caminho(meta[1]) }
  // O texto "This page could not be found" vem no payload de TODA página (boundary not-found do Next); só a página 404 de verdade ganha robots=noindex.
  if (/<meta name="robots" content="noindex"/.test(r.corpo) || /<title>404: This page could not be found/.test(r.corpo)) return { tipo: 'bloqueada' }
  return { tipo: 'abriu' }
}

/** Destino que não é tela de trabalho: login, vitrine de módulo, início, aguardando. Equivale a "não entrou". */
export const destinoForaDoApp = (d: string) => /^\/(login|entrar|aguardando|modulos(\/|$)|home$)/.test(d)

// ---- Avaliações ----
export type Veredito = { tipo: 'ok' | 'furo' | 'divergencia' | 'sem-regra'; detalhe: string }

export function avaliarRota(a: {
  rota: string
  regra: Regra | null
  usuario: Usuario
  resultado: Resultado
  regraDestino?: Regra | null
  resultadoFinal?: Resultado
}): Veredito {
  if (!a.regra) return { tipo: 'sem-regra', detalhe: 'rota sem regra na matriz' }
  let res = a.resultado
  let permitido = decidir(a.regra, a.usuario)
  let forasDoApp = false
  if (res.tipo === 'redireciona') {
    if (destinoForaDoApp(res.destino)) {
      forasDoApp = true
      res = { tipo: 'bloqueada' }
    } else {
      res = a.resultadoFinal ?? { tipo: 'bloqueada' }
      if (a.regraDestino) {
        const d = decidir(a.regraDestino, a.usuario)
        if (!d.permitido) permitido = d
      }
    }
  }
  const abriu = res.tipo === 'abriu'
  if (abriu && !permitido.permitido) return { tipo: 'furo', detalhe: `abriu, mas a matriz proíbe (${permitido.motivo})` }
  if (!abriu && permitido.permitido && !forasDoApp) return { tipo: 'divergencia', detalhe: `não abriu (${res.tipo}), mas a matriz permite` }
  return { tipo: 'ok', detalhe: abriu ? 'abriu e a matriz permite' : 'bloqueada e a matriz proíbe' }
}

export function avaliarMenu(a: { itens: string[]; usuario: Usuario; regraDe: (h: string) => Regra | null }) {
  const furos: { rota: string; motivo: string }[] = []
  const semRegra: string[] = []
  for (const h of a.itens) {
    const r = a.regraDe(h)
    if (!r) { semRegra.push(h); continue }
    const d = decidir(r, a.usuario)
    if (!d.permitido) furos.push({ rota: h, motivo: d.motivo })
  }
  return { furos, semRegra }
}

export type RegraBotao = { rota: string; botao: RegExp; regra: Regra }

export function avaliarBotoes(a: { rota: string; acoes: { texto: string; tipo: string }[]; usuario: Usuario; regras: RegraBotao[] }) {
  const furos: { botao: string; motivo: string }[] = []
  const semRegra: string[] = []
  for (const ac of a.acoes) {
    if (ac.tipo !== 'botão') continue
    const hit = a.regras.filter((r) => r.rota === a.rota && r.botao.test(ac.texto))
    if (!hit.length) {
      if (classificarAcao(ac.texto) === 'grava') semRegra.push(ac.texto)
      continue
    }
    for (const r of hit) {
      const d = decidir(r.regra, a.usuario)
      if (!d.permitido) { furos.push({ botao: ac.texto, motivo: d.motivo }); break }
    }
  }
  return { furos, semRegra }
}

export function avaliarApi(a: { regra: Regra; usuario: Usuario; status: number; bloqueioEh404?: boolean }): Veredito {
  const bloqueou = a.bloqueioEh404 ? a.status === 404 : a.status === 401 || a.status === 403
  const d = decidir(a.regra, a.usuario)
  if (!d.permitido) {
    return bloqueou
      ? { tipo: 'ok', detalhe: `HTTP ${a.status}: bloqueado` }
      : { tipo: 'furo', detalhe: `HTTP ${a.status}: respondeu a quem a matriz proíbe (${d.motivo})` }
  }
  if (bloqueou && !a.bloqueioEh404) return { tipo: 'divergencia', detalhe: `HTTP ${a.status}: bloqueou, mas a matriz permite` }
  return { tipo: 'ok', detalhe: `HTTP ${a.status}: permitido` }
}

/** Access token do Supabase a partir dos cookies sb-*-auth-token (podem vir em pedaços e com prefixo base64-). */
export function tokenDosCookies(cookies: { name: string; value: string }[]): string | null {
  const partes = cookies.filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
  if (!partes.length) return null
  let v = partes.map((c) => c.value).join('')
  try {
    if (v.startsWith('base64-')) v = Buffer.from(v.slice(7), 'base64url').toString('utf8')
    return (JSON.parse(decodeURIComponent(v)) as { access_token?: string }).access_token ?? null
  } catch {
    try { return (JSON.parse(v) as { access_token?: string }).access_token ?? null } catch { return null }
  }
}

import { ordenarFalhas, type Falha } from './relatorio.ts'

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ⏎ ')

/** Lista de furos de permissão. Todos são gravidade 1 (acesso indevido é o pior achado do robô). Sem data: duas rodadas iguais dão o mesmo texto. */
export function formatarFalhasPermissoes(falhas: Falha[], meta: { logins: number; rotas: number }): string {
  const o = ordenarFalhas(falhas)
  const porCargo = new Map<string, number>()
  for (const f of o) porCargo.set(f.cargo, (porCargo.get(f.cargo) ?? 0) + 1)
  const L = ['# Furos de permissão (robô de permissões)', '']
  L.push(`Logins: ${meta.logins} | rotas conferidas por login: ${meta.rotas} | furos: ${o.length}`, '')
  L.push('Gravidade 1 em todos: cargo alcançou tela, ação ou dado que a matriz proíbe (gravidade 1 é a mais alta do robô; "conta errada" não se aplica aqui).', '')
  L.push('Furos por cargo:', ...[...porCargo.keys()].sort().map((c) => `- ${c}: ${porCargo.get(c)}`), '')
  if (!o.length) return [...L, 'Nenhum furo encontrado.', ''].join('\n')
  L.push('| Gravidade | Loja | Cargo | Onde | Passo | Esperado | Mostrado | Print |', '|---|---|---|---|---|---|---|---|')
  for (const f of o) L.push(`| 1 | ${esc(f.loja)} | ${f.cargo} | ${esc(f.tela)} | ${esc(f.passo)} | ${esc(f.esperado)} | ${esc(f.mostrado)} | ${f.print} |`)
  L.push('')
  return L.join('\n')
}
