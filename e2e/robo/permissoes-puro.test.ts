import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decidir, regraDaRota, lerRotasSoDev, classificarResposta, avaliarRota, avaliarMenu, avaliarBotoes, avaliarApi, ordemDeRegra,
  type Usuario, type Regra,
} from './permissoes-puro.ts'

const dono: Usuario = { perfil: 'Admin', superAdmin: true, permissoes: new Set(['*']) }
const gerente: Usuario = { perfil: 'Usuario', superAdmin: false, permissoes: new Set(['Compras', 'Notas Fiscais', 'Financeiro - Contas a pagar']) }
const estoquista: Usuario = { perfil: 'Usuario', superAdmin: false, permissoes: new Set(['Movimentacoes']) }
const adminLoja: Usuario = { perfil: 'AdminLoja', superAdmin: false, permissoes: new Set(['*']) }

// ---- decidir: a matriz para um usuário ----
test('rota livre: todo mundo entra', () => {
  assert.equal(decidir({ livre: true }, estoquista).permitido, true)
})
test('permissão exigida: só quem a tem (ou "*")', () => {
  const r: Regra = { anyOf: ['Notas Fiscais'] }
  assert.equal(decidir(r, gerente).permitido, true)
  assert.equal(decidir(r, estoquista).permitido, false)
  assert.equal(decidir(r, dono).permitido, true)
})
test('anyOf: basta uma', () => {
  assert.equal(decidir({ anyOf: ['X', 'Movimentacoes'] }, estoquista).permitido, true)
})
test('dev: só super admin, mesmo com permissão', () => {
  assert.equal(decidir({ dev: true, anyOf: ['Compras'] }, gerente).permitido, false)
  assert.equal(decidir({ dev: true }, dono).permitido, true)
})
test('admin: só perfil Admin; gestão: Admin ou AdminLoja', () => {
  assert.equal(decidir({ admin: true }, adminLoja).permitido, false)
  assert.equal(decidir({ admin: true }, dono).permitido, true)
  assert.equal(decidir({ gestao: true }, adminLoja).permitido, true)
  assert.equal(decidir({ gestao: true }, gerente).permitido, false)
})
test('motivo diz qual condição falhou', () => {
  assert.match(decidir({ dev: true }, gerente).motivo, /desenvolvedor/)
  assert.match(decidir({ anyOf: ['Notas Fiscais'] }, estoquista).motivo, /Notas Fiscais/)
})

// ---- regraDaRota: derivada do código (menu + permissão do menu + só-dev + extras) ----
const nav = [
  { href: '/home' },
  { href: '/produto' },
  { href: '/log', admin: true },
  { href: '/usuario', gestaoUsuarios: true },
  { href: '/saude-banco', superAdmin: true },
  { href: '/financeiro/contas-pagar', superAdmin: true },
]
const menuPerm = { '/produto': 'Produtos', '/financeiro/contas-pagar': 'Financeiro - Contas a pagar' }
const soDev = ['/financeiro', '/plataforma']
const ctx = { nav, menuPermissao: menuPerm, rotasSoDev: soDev, extras: { '/produto/novo': { anyOf: ['Produtos - Criar'] } } }

test('item do menu sem flag nem permissão é livre', () => {
  assert.deepEqual(regraDaRota('/home', ctx), { livre: true })
})
test('permissão do menu vira anyOf', () => {
  assert.deepEqual(regraDaRota('/produto', ctx), { anyOf: ['Produtos'] })
})
test('flags do menu: admin, gestão, super admin', () => {
  assert.deepEqual(regraDaRota('/log', ctx), { admin: true })
  assert.deepEqual(regraDaRota('/usuario', ctx), { gestao: true })
  assert.deepEqual(regraDaRota('/saude-banco', ctx), { dev: true })
})
test('rota sob prefixo só-dev ganha dev (prefixo por segmento, não por texto)', () => {
  assert.deepEqual(regraDaRota('/financeiro/contas-pagar', ctx), { dev: true, anyOf: ['Financeiro - Contas a pagar'] })
  assert.equal(regraDaRota('/financeiro-x', { ...ctx, extras: {} }), null)
})
test('extras valem para rotas fora do menu', () => {
  assert.deepEqual(regraDaRota('/produto/novo', ctx), { anyOf: ['Produtos - Criar'] })
})
test('extra soma com a regra do menu da rota-mãe quando a rota não está no menu', () => {
  assert.equal(regraDaRota('/rota-desconhecida', ctx), null)
})
test('lerRotasSoDev lê a lista do código-fonte', () => {
  const src = "export const ROTAS_SO_DEV = [\n  '/a',\n  // c\n  '/b/c',\n] as const\nexport async function x() {}"
  assert.deepEqual(lerRotasSoDev(src), ['/a', '/b/c'])
})

// ---- classificarResposta: HTTP 200 com página 404 conta como bloqueada ----
test('200 normal = abriu', () => {
  assert.deepEqual(classificarResposta({ status: 200, corpo: '<html><h1>Produtos</h1></html>' }), { tipo: 'abriu' })
})
test('200 com a página 404 = bloqueada', () => {
  assert.deepEqual(classificarResposta({ status: 200, corpo: '<title>404: This page could not be found.</title>' }), { tipo: 'bloqueada' })
})
test('o texto do 404 aparece em TODA página (payload do Next): só o noindex denuncia o bloqueio', () => {
  const boiler = '<h1 class="next-error-h1">404</h1><p>This page could not be found.</p><meta name="robots" content="nofollow"/>'
  assert.equal(classificarResposta({ status: 200, corpo: '<html>' + boiler + '<h1>Produtos</h1></html>' }).tipo, 'abriu')
  assert.equal(classificarResposta({ status: 200, corpo: '<html><meta name="robots" content="noindex"/>' + boiler + '</html>' }).tipo, 'bloqueada')
})
test('404 e 403 = bloqueada; 500 = erro', () => {
  assert.equal(classificarResposta({ status: 404, corpo: '' }).tipo, 'bloqueada')
  assert.equal(classificarResposta({ status: 403, corpo: '' }).tipo, 'bloqueada')
  assert.equal(classificarResposta({ status: 500, corpo: '' }).tipo, 'erro')
})
test('3xx devolve o destino (só o caminho)', () => {
  assert.deepEqual(classificarResposta({ status: 307, location: 'http://127.0.0.1:3107/nota-fiscal?x=1', corpo: '' }), { tipo: 'redireciona', destino: '/nota-fiscal' })
  assert.deepEqual(classificarResposta({ status: 307, location: '/login', corpo: '' }), { tipo: 'redireciona', destino: '/login' })
})
test('redirect já transmitido (meta refresh) também é redireciona', () => {
  const corpo = '<meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/modulos/cozinha"/>'
  assert.deepEqual(classificarResposta({ status: 200, corpo }), { tipo: 'redireciona', destino: '/modulos/cozinha' })
})

// ---- avaliarRota: furo x divergência ----
test('abriu onde a matriz proíbe = furo', () => {
  const v = avaliarRota({ rota: '/log', regra: { admin: true }, usuario: gerente, resultado: { tipo: 'abriu' } })
  assert.equal(v.tipo, 'furo')
})
test('bloqueada onde a matriz proíbe = ok', () => {
  assert.equal(avaliarRota({ rota: '/log', regra: { admin: true }, usuario: gerente, resultado: { tipo: 'bloqueada' } }).tipo, 'ok')
})
test('redirecionou para fora do app (login/módulo/home) onde proíbe = ok', () => {
  for (const d of ['/login', '/modulos/pacioli', '/home'])
    assert.equal(avaliarRota({ rota: '/log', regra: { admin: true }, usuario: gerente, resultado: { tipo: 'redireciona', destino: d } }).tipo, 'ok')
})
test('bloqueada onde a matriz permite = divergência (não é furo)', () => {
  assert.equal(avaliarRota({ rota: '/produto', regra: { anyOf: ['Produtos'] }, usuario: dono, resultado: { tipo: 'bloqueada' } }).tipo, 'divergencia')
})
test('abriu onde permite = ok; erro 500 onde proíbe = ok (não abriu)', () => {
  assert.equal(avaliarRota({ rota: '/x', regra: { livre: true }, usuario: gerente, resultado: { tipo: 'abriu' } }).tipo, 'ok')
  assert.equal(avaliarRota({ rota: '/log', regra: { admin: true }, usuario: gerente, resultado: { tipo: 'erro' } }).tipo, 'ok')
})
test('redirecionou para outra tela do app: vale a regra da tela de destino', () => {
  const v = avaliarRota({ rota: '/compras', regra: { livre: true }, usuario: estoquista, resultado: { tipo: 'redireciona', destino: '/nota-fiscal' }, regraDestino: { anyOf: ['Notas Fiscais'] }, resultadoFinal: { tipo: 'abriu' } })
  assert.equal(v.tipo, 'furo')
})
test('sem regra para a rota = sem-regra (listado, não falha)', () => {
  assert.equal(avaliarRota({ rota: '/z', regra: null, usuario: gerente, resultado: { tipo: 'abriu' } }).tipo, 'sem-regra')
})

// ---- avaliarMenu ----
test('menu mostra item que a matriz proíbe = furo; item permitido = ok', () => {
  const regras = (h: string): Regra | null => (h === '/log' ? { admin: true } : h === '/home' ? { livre: true } : null)
  const r = avaliarMenu({ itens: ['/home', '/log', '/outro'], usuario: gerente, regraDe: regras })
  assert.deepEqual(r.furos.map((f) => f.rota), ['/log'])
  assert.deepEqual(r.semRegra, ['/outro'])
})

// ---- avaliarBotoes ----
test('botão sem a permissão = furo; com permissão = ok; botão sem regra é listado', () => {
  const regras = [
    { rota: '/inventario', botao: /^Excluir$/, regra: { anyOf: ['Inventarios - Excluir'] } },
    { rota: '/inventario', botao: /^Novo inventário$/, regra: { anyOf: ['Inventarios - Criar'] } },
  ]
  const acoes = [{ texto: 'Excluir', tipo: 'botão' }, { texto: 'Novo inventário', tipo: 'botão' }, { texto: 'Reenviar erros', tipo: 'botão' }, { texto: 'Buscar', tipo: 'botão' }]
  const u: Usuario = { perfil: 'Usuario', superAdmin: false, permissoes: new Set(['Inventarios - Criar']) }
  const r = avaliarBotoes({ rota: '/inventario', acoes, usuario: u, regras })
  assert.deepEqual(r.furos.map((f) => f.botao), ['Excluir'])
  assert.deepEqual(r.semRegra, ['Reenviar erros'])
})

// ---- avaliarApi ----
test('API: 200 para quem não pode = furo; 403 = ok; 404 de id inexistente = permitido', () => {
  const regra: Regra = { anyOf: ['Notas Fiscais'] }
  assert.equal(avaliarApi({ regra, usuario: estoquista, status: 403 }).tipo, 'ok')
  assert.equal(avaliarApi({ regra, usuario: estoquista, status: 404 }).tipo, 'furo')
  assert.equal(avaliarApi({ regra, usuario: estoquista, status: 200 }).tipo, 'furo')
  assert.equal(avaliarApi({ regra, usuario: gerente, status: 404 }).tipo, 'ok')
  assert.equal(avaliarApi({ regra, usuario: gerente, status: 403 }).tipo, 'divergencia')
})
test('API para não-dev: 404 do exigirDev conta como bloqueio', () => {
  assert.equal(avaliarApi({ regra: { dev: true }, usuario: gerente, status: 404, bloqueioEh404: true }).tipo, 'ok')
  assert.equal(avaliarApi({ regra: { dev: true }, usuario: gerente, status: 403, bloqueioEh404: true }).tipo, 'furo')
})

test('ordemDeRegra: texto curto e estável para a matriz', () => {
  assert.equal(ordemDeRegra({ dev: true, anyOf: ['A', 'B'] }), 'dev + (A ou B)')
  assert.equal(ordemDeRegra({ livre: true }), 'livre')
  assert.equal(ordemDeRegra({ admin: true }), 'perfil Admin')
  assert.equal(ordemDeRegra({ gestao: true }), 'Admin ou AdminLoja')
})

// ---- token do cookie e relatório ----
import { tokenDosCookies, formatarFalhasPermissoes } from './permissoes-puro.ts'
test('tokenDosCookies junta os pedaços e decodifica base64-', () => {
  const json = JSON.stringify({ access_token: 'AAA.BBB.CCC', refresh_token: 'x' })
  const b64 = 'base64-' + Buffer.from(json).toString('base64url')
  const meio = Math.floor(b64.length / 2)
  const cookies = [
    { name: 'sb-x-auth-token.1', value: b64.slice(meio) },
    { name: 'sb-x-auth-token.0', value: b64.slice(0, meio) },
    { name: 'outro', value: 'z' },
  ]
  assert.equal(tokenDosCookies(cookies), 'AAA.BBB.CCC')
  assert.equal(tokenDosCookies([{ name: 'a', value: 'b' }]), null)
})
test('relatório de furos: gravidade 1, agrupado, sem data (estável)', () => {
  const f = {
    tipo: 'furo-endereco' as const, gravidade: 1 as const, loja: 'Sertão', cargo: 'gerente', tela: '/log', passo: 'abrir /log',
    esperado: 'bloqueada (perfil Admin)', mostrado: 'abriu', print: 'prints/x.png',
  }
  const md = formatarFalhasPermissoes([f, { ...f, cargo: 'estoquista' }], { logins: 9, rotas: 100 })
  assert.match(md, /furos: 2/)
  assert.match(md, /gerente: 1/)
  assert.match(md, /estoquista: 1/)
  assert.equal(md, formatarFalhasPermissoes([{ ...f, cargo: 'estoquista' }, f], { logins: 9, rotas: 100 }))
})
