// Robô de permissões (ticket 10): entra com cada cargo e confere a matriz cargo × tela/ação/API.
// SÓ LÊ: nenhuma escrita no banco; só GET e navegação; nenhum botão de gravação é clicado (só se clica no envio do login e nos
// grupos do menu lateral). Reusa o ERP já rodando em http://127.0.0.1:3107 (não sobe outro Next).
// Uso: npm run robo:permissoes            (saída em .local-data/robo-permissoes/<rodada>/, fora do git)
//      npm run robo:permissoes -- --matriz (só gera e2e/robo/matriz-permissoes.md a partir do código e do banco local)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { verificarTravaLocal } from './trava.ts'
import { ORIGEM_API_LOCAL, valorEnv as valorEnvBase } from './base.ts'
import { coletar } from './coletor.ts'
import { type Falha, type TipoFalha, gravidadeDoTipo } from './relatorio.ts'
import {
  decidir, regraDaRota, lerRotasSoDev, classificarResposta, avaliarRota, avaliarMenu, avaliarBotoes, avaliarApi, ordemDeRegra,
  destinoForaDoApp, tokenDosCookies, formatarFalhasPermissoes, type Usuario, type Regra, type Resultado,
} from './permissoes-puro.ts'
import { EXTRAS, IGNORAR_ROTAS, BOTOES, APIS, TABELAS_OFFLINE } from './permissoes-matriz.ts'

const RAIZ = path.resolve(import.meta.dirname, '..', '..')
const NOMES_LOJA: Record<string, string> = { '4': 'Sertão', '15': 'ODARA', '19': 'Loja 19' }
const GRUPOS_MENU = ['Operação', 'Cadastros', 'Administração']
const SO_MATRIZ = process.argv.includes('--matriz')

function sair(msg: string, codigo = 2): never {
  console.error(`ROBÔ RECUSOU RODAR: ${msg}`)
  process.exit(codigo)
}

// ---- 1) Trava: só a cópia local, Omie bloqueado ----
const trava = await verificarTravaLocal(RAIZ)
if (!trava.ok) sair(trava.motivo)
const ORIGEM = trava.origem
const envLocal = path.join(RAIZ, '.env.local')
const envTexto = trava.envTexto
const API = ORIGEM_API_LOCAL
const valorEnv = (k: string) => valorEnvBase(envTexto, k) ?? ''
const CHAVE = valorEnv('SUPABASE_SERVICE_ROLE_KEY')
if (!CHAVE) sair('SUPABASE_SERVICE_ROLE_KEY ausente no .env.local')

// ---- 2) Leitura do banco local (SÓ GET, via PostgREST/GoTrue da cópia local) ----
async function ler<T = unknown>(caminho: string): Promise<T> {
  const r = await fetch(`${API}${caminho}`, { headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}` } })
  if (!r.ok) throw new Error(`GET ${caminho} -> ${r.status}`)
  return (await r.json()) as T
}
type PermRow = { permissoes: { nome: string } | { nome: string }[] | null }
const nomes = (rows: PermRow[]) => rows.flatMap((r) => (Array.isArray(r.permissoes) ? r.permissoes : r.permissoes ? [r.permissoes] : [])).map((p) => p.nome)

type Login = { email: string; senha: string; loja: string; lojaNome: string; cargo: string }
function lerLogins(): Login[] {
  const f = path.join(RAIZ, '.local-data', 'logins.txt')
  if (!fs.existsSync(f)) return []
  const out: Login[] = []
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = l.match(/^(\S+@ntb-teste\.local)\s+(\S+)\s+loja=(\d+)\s+cargo=(\w+)/)
    if (m) out.push({ email: m[1], senha: m[2], loja: m[3], lojaNome: NOMES_LOJA[m[3]] ?? `Loja ${m[3]}`, cargo: m[4] })
  }
  return out
}

async function usuarioDoBanco(lg: Login, idPorEmail: Map<string, string>): Promise<Usuario & { cargoBanco: string | null }> {
  const id = idPorEmail.get(lg.email)
  if (!id) throw new Error(`usuário ${lg.email} não achado no GoTrue local`)
  const [[p], [vinc]] = await Promise.all([
    ler<{ perfil: string | null; is_super_admin: boolean }[]>(`/rest/v1/profiles?id=eq.${id}&select=perfil,is_super_admin`),
    ler<{ cargo_id: number | null; cargos: { nome: string } | null }[]>(`/rest/v1/loja_user?user_id=eq.${id}&loja_id=eq.${lg.loja}&select=cargo_id,cargos(nome)`),
  ])
  const permissoes = new Set<string>()
  if (p?.perfil === 'Admin' || p?.perfil === 'AdminLoja') permissoes.add('*')
  else {
    for (const n of nomes(await ler<PermRow[]>(`/rest/v1/permissao_user?user_id=eq.${id}&loja_id=eq.${lg.loja}&select=permissoes(nome)`))) permissoes.add(n)
    if (vinc?.cargo_id) for (const n of nomes(await ler<PermRow[]>(`/rest/v1/cargo_permissao?cargo_id=eq.${vinc.cargo_id}&select=permissoes(nome)`))) permissoes.add(n)
  }
  return { perfil: p?.perfil ?? null, superAdmin: p?.is_super_admin === true, permissoes, cargoBanco: vinc?.cargos?.nome ?? null }
}

// ---- 3) Rotas e regras (derivadas do código real) ----
const { NAV_ITEMS } = (await import('../../components/shell/NavItems.ts')) as { NAV_ITEMS: { href: string; admin?: boolean; gestaoUsuarios?: boolean; superAdmin?: boolean }[] }
const { MENU_PERMISSAO } = (await import('../../lib/permissoes-catalogo.ts')) as { MENU_PERMISSAO: Record<string, string> }
const ROTAS_SO_DEV = lerRotasSoDev(fs.readFileSync(path.join(RAIZ, 'lib', 'recursos-dev.ts'), 'utf8'))
const CENTRAL: Record<string, Regra> = Object.fromEntries(['administracao', 'compras', 'estoque', 'financas', 'fiscal', 'producao'].map((m) => [`/central/${m}`, { dev: true }]))
const ctxRegras = { nav: NAV_ITEMS, menuPermissao: MENU_PERMISSAO, rotasSoDev: ROTAS_SO_DEV, extras: { ...EXTRAS, ...CENTRAL } }
const regraDe = (r: string) => regraDaRota(r, ctxRegras)
const ROTAS = [...new Set([...NAV_ITEMS.map((n) => n.href), ...Object.keys(ctxRegras.extras)])].filter((r) => !IGNORAR_ROTAS.has(r)).sort()

const logins = lerLogins()
const idPorEmail = new Map<string, string>()
for (const u of (await ler<{ users: { id: string; email: string }[] }>('/auth/v1/admin/users?per_page=200')).users) idPorEmail.set(u.email, u.id)

// ---- 4) Cargos do banco, permissões sem cargo e migration 310 ----
async function cargosDoBanco() {
  const cargos = await ler<{ id: number; nome: string }[]>('/rest/v1/cargos?select=id,nome&order=id')
  const permissoes = await ler<{ id: number; nome: string }[]>('/rest/v1/permissoes?select=id,nome&order=nome')
  const cp = await ler<{ cargo_id: number; permissao_id: number }[]>('/rest/v1/cargo_permissao?select=cargo_id,permissao_id&limit=5000')
  const comCargo = new Set(cp.map((x) => x.permissao_id))
  const porCargo = new Map<string, Set<string>>()
  for (const c of cargos) porCargo.set(c.nome, new Set(cp.filter((x) => x.cargo_id === c.id).map((x) => permissoes.find((p) => p.id === x.permissao_id)!.nome)))
  const orfas = permissoes.filter((p) => !comCargo.has(p.id)).map((p) => p.nome)
  // migration 310: todas as linhas (cargo, permissão) do `desejo` já estão em cargo_permissao?
  const sql = fs.readFileSync(path.join(RAIZ, 'supabase', 'migrations', '310_permissoes_nos_cargos.sql'), 'utf8')
  const pares = [...sql.matchAll(/\('(Gerente|Estoquista|Conferente)','([^']+)'\)/g)].map((m) => [m[1], m[2]] as const)
  const faltam = pares.filter(([c, p]) => !porCargo.get(c)?.has(p))
  return { cargos, porCargo, totalPermissoes: permissoes.length, orfas, migration310: { linhas: pares.length, faltam } }
}

// ---- 5) Modo --matriz: documento versionado ----
async function gerarDocumento() {
  const db = await cargosDoBanco()
  const modelo = (cargo: string): Usuario => ({ perfil: cargo === 'dono' ? 'Admin' : 'Usuario', superAdmin: cargo === 'dono', permissoes: cargo === 'dono' ? new Set(['*']) : (db.porCargo.get(cargo === 'gerente' ? 'Gerente' : 'Estoquista') ?? new Set()) })
  const cols = ['dono', 'gerente', 'estoquista'] as const
  const sn = (r: Regra | null, c: (typeof cols)[number]) => (r ? (decidir(r, modelo(c)).permitido ? 'sim' : 'não') : '?')
  const L: string[] = []
  L.push('# Matriz de permissões: cargo × tela / ação / API', '')
  L.push('Gerada por `npm run robo:permissoes -- --matriz` (e2e/robo/permissoes.ts) a partir do código do ERP e do banco da cópia local. Não edite à mão: mude `e2e/robo/permissoes-matriz.ts` (extras, botões, APIs) ou o código do ERP e gere de novo.', '')
  L.push('## Como a matriz é derivada', '')
  L.push('- Rota do menu: regra de `components/shell/NavItems.ts` (`admin` = perfil Admin; `gestaoUsuarios` = Admin ou AdminLoja; `superAdmin` = desenvolvedor) mais a permissão de `MENU_PERMISSAO` (`lib/permissoes-catalogo.ts`) mais `ROTAS_SO_DEV` (`lib/recursos-dev.ts`, vale também para as sub-rotas).')
  L.push('- Telas fora do menu e telas em que a página pede outra coisa que o menu: tabela `EXTRAS`, conferida em cada `page.tsx` (`requirePermissao`, `getAtorGestao().podeGerir`, `isAdmin`, `exigirDev`, `notFound`).')
  L.push('- Permissões de cada cargo: `cargo_permissao` do banco local (cópia do backup de 17/11/2026). Dono = Admin global + `is_super_admin` (passa em tudo). Gerente/Estoquista = perfil `Usuario` com o cargo na loja.')
  L.push('- Condições que só SOMAM restrição (loja em estoque próprio, módulo da plataforma, loja de teste) não entram na matriz: "sim" quer dizer "o cargo pode", não "a tela abre em toda loja". O robô só acusa furo quando a tela ABRE e a matriz diz "não".')
  L.push('- Rota bloqueada responde HTTP 200 com a página 404 do Next (achado do ticket 02): o robô lê o corpo, não só o código.', '')
  L.push('## Cargos no banco', '', '| Cargo | Permissões | Login de teste |', '|---|---|---|')
  for (const c of db.cargos) L.push(`| ${c.nome} | ${db.porCargo.get(c.nome)?.size ?? 0} | ${logins.some((l) => l.cargo === c.nome.toLowerCase()) ? 'sim (lojas 4, 15, 19)' : 'NÃO (não coberto)'} |`)
  L.push('', `Permissões sem nenhum cargo: ${db.orfas.length} de ${db.totalPermissoes}. Migration 310: ${db.migration310.linhas - db.migration310.faltam.length} de ${db.migration310.linhas} linhas já estão em \`cargo_permissao\`${db.migration310.faltam.length ? ` (faltam: ${db.migration310.faltam.map((f) => f.join(' / ')).join('; ')})` : ' (aplicada)'}.`, '')
  L.push('Sem cargo (só Admin/AdminLoja alcançam):', '', db.orfas.map((o) => `\`${o}\``).join(', '), '')
  L.push('Por que ficam só com Admin/AdminLoja (F-19, decisão de segurança, NADA foi concedido): 30 foram deixadas assim de propósito na auditoria de novembro (cadastros de Produtos/Famílias/Fornecedores/Locais, regra da migration 046; Notas - Excluir, Estoque - Corrigir custo, Fechamento - Reabrir mes, Contas a pagar - Pagar, Categorias): apagam, reescrevem custo, reabrem mês ou movem dinheiro. As 4 do Financeiro criadas depois (migrations 370/371: Aprovar pagamento alto valor, Configurar aprovacao, Lancamentos e transferencias, Contas a receber - Receber) também ficam só com Admin até o dono decidir: quem as recebe aprova valor alto, muda a regra de aprovação ou mexe em caixa. Para conceder, o dono diz a quem; aí entra uma migration em cargo_permissao (arquivo no repo, aplicada com backup), nunca por script do robô.', '')
  L.push('## Telas (acesso direto ao endereço)', '', '| Rota | Regra | dono | gerente | estoquista |', '|---|---|---|---|---|')
  for (const r of ROTAS) {
    const regra = regraDe(r)
    L.push(`| ${r} | ${regra ? ordemDeRegra(regra) : 'SEM REGRA'} | ${cols.map((c) => sn(regra, c)).join(' | ')} |`)
  }
  L.push('', '## Ações (botões que gravam)', '', 'Visíveis só com a regra abaixo. O robô lê o botão na tela; nunca o clica.', '', '| Tela | Botão | Regra | dono | gerente | estoquista |', '|---|---|---|---|---|---|')
  for (const b of BOTOES) L.push(`| ${b.rota} | \`${b.botao.source}\` | ${ordemDeRegra(b.regra)} | ${cols.map((c) => sn(b.regra, c)).join(' | ')} |`)
  L.push('', '## APIs de leitura por endereço (GET)', '', '| API | Regra | Bloqueio | dono | gerente | estoquista |', '|---|---|---|---|---|---|')
  for (const a of APIS) L.push(`| ${a.caminho}${a.soLoja ? ` (loja ${a.soLoja})` : ''} | ${ordemDeRegra(a.regra)} | ${a.bloqueioEh404 ? '404' : '403'} | ${cols.map((c) => sn(a.regra, c)).join(' | ')} |`)
  L.push('', '## Dados pelo canal offline (`GET /api/offline/snapshot?tabela=`)', '', 'Quem deveria poder ler cada tabela, pela regra da tela que a mostra.', '', '| Tabela | Regra | dono | gerente | estoquista |', '|---|---|---|---|---|')
  for (const t of TABELAS_OFFLINE) L.push(`| ${t.tabela} | ${ordemDeRegra(t.regra)} | ${cols.map((c) => sn(t.regra, c)).join(' | ')} |`)
  L.push('', '## O que a matriz NÃO cobre (honesto)', '')
  L.push('- Server actions e POST (`/api/sync/*`, `/api/estoque/kardex-omie`, `/api/anexos` POST, `/api/offline/{acao,linhas,mudancas,sessao,tabelas}`): só se chamam por POST/gravação; o robô é só leitura. Ficam sem prova em execução. `/api/offline/tabelas` até no GET faz `offline_compactar` (grava).')
  L.push('- `/api/cron/*`, `/api/integracao/*`, `/api/webhook`, `/api/correcoes/ingest`: autenticam por segredo/chave, não por cargo; não chamados (um GET sem segredo poderia disparar trabalho).')
  L.push('- Cargo Conferente e perfil AdminLoja: sem login de teste (o robô não cria). Dados por loja (um cargo ver outra loja) não entram.')
  L.push('- Botões só são conferidos nas telas que abrem para o login e que têm regra em `BOTOES`; botão que grava sem regra é listado como "sem regra" no relatório da rodada.', '')
  fs.writeFileSync(path.join(RAIZ, 'e2e', 'robo', 'matriz-permissoes.md'), L.join('\n'))
  console.log(`matriz gerada: ${ROTAS.length} rotas, ${BOTOES.length} botões, ${APIS.length} APIs, ${TABELAS_OFFLINE.length} tabelas`)
}
if (SO_MATRIZ) {
  await gerarDocumento()
  process.exit(0)
}

// ---- 6) Passeio ----
if (!logins.length) sair('.local-data/logins.txt sem logins de teste')
const filtro = process.env.ROBO_SO
const alvo = logins.filter((l) => !filtro || l.email.startsWith(filtro))
const ID_RODADA = process.env.ROBO_RODADA ?? new Date().toISOString().replace(/[:.]/g, '-')
const SAIDA = path.join(RAIZ, '.local-data', 'robo-permissoes', ID_RODADA)
fs.mkdirSync(path.join(SAIDA, 'prints'), { recursive: true })

const slug = (r: string) => r.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-') || 'raiz'
const limparHref = (h: string) => h.split('#')[0].split('?')[0].replace(/\/$/, '') || '/'
const dentroDoMenu = (h: string) => h.startsWith('/') && !h.startsWith('//') && h !== '/'

async function esperar(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1500)
}

async function menuDoLogin(page: Page): Promise<string[]> {
  const links = new Set<string>()
  const colher = async () => { for (const h of (await page.evaluate(coletar)).linksMenu) if (dentroDoMenu(h)) links.add(limparHref(h)) }
  await colher()
  const aside = page.locator('aside:visible').first()
  for (const g of GRUPOS_MENU) {
    const b = aside.getByRole('button', { name: g, exact: true })
    if (await b.count()) { await b.first().click(); await page.waitForTimeout(250); await colher() } // só abre/fecha o grupo do menu
  }
  return [...links]
}

type Linha = { loja: string; cargo: string; rota: string; resultado: string; esperado: string; veredito: string; detalhe: string }
type Saida = { falhas: Falha[]; linhas: Linha[]; semRegraRotas: string[]; semRegraBotoes: { rota: string; botao: string }[]; divergencias: string[] }

async function rodarLogin(browser: Awaited<ReturnType<typeof chromium.launch>>, lg: Login): Promise<Saida> {
  const out: Saida = { falhas: [], linhas: [], semRegraRotas: [], semRegraBotoes: [], divergencias: [] }
  const usuario = await usuarioDoBanco(lg, idPorEmail)
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce' })
  await ctx.route('**/*', (rota) => {
    const u = new URL(rota.request().url())
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.origin === ORIGEM || u.origin === API) return rota.continue()
    return rota.abort('blockedbyclient') // nada sai da máquina
  })
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  const falha = (tipo: TipoFalha, tela: string, passo: string, esperado: string, mostrado: string, print: string) =>
    out.falhas.push({ tipo, gravidade: gravidadeDoTipo(tipo), loja: lg.lojaNome, cargo: lg.cargo, tela, passo, esperado, mostrado, print })
  const pngDe = async (rota: string, sufixo: string): Promise<string> => {
    const png = `prints/${lg.loja}-${lg.cargo}-${slug(rota)}${sufixo}.png`
    await page.screenshot({ path: path.join(SAIDA, png) }).catch(() => {})
    return png
  }

  // login real pelo formulário
  await page.goto(`${ORIGEM}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.fill('#email', lg.email)
  await page.fill('#password', lg.senha)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/(home|resumo|central|entrar|porta)/, { timeout: 90000 })
  await esperar(page)

  // (a) menu: nada que a matriz proíba pode aparecer
  const noMenu = await menuDoLogin(page)
  const m = avaliarMenu({ itens: noMenu, usuario, regraDe })
  for (const f of m.furos) {
    const png = await pngDe(f.rota, '-menu')
    falha('furo-menu', f.rota, 'ler o menu lateral', `item fora do menu (${f.motivo})`, 'o item aparece no menu', png)
  }
  for (const r of m.semRegra) out.semRegraRotas.push(r)

  // (b) acesso direto ao endereço, sem clicar em nada (GET com os cookies da sessão)
  const get = async (caminho: string) => {
    const resp = await ctx.request.get(`${ORIGEM}${caminho}`, { maxRedirects: 0, failOnStatusCode: false, timeout: 90000 })
    return classificarResposta({ status: resp.status(), location: resp.headers()['location'], corpo: await resp.text() })
  }
  const abertas: string[] = []
  for (const rota of [...new Set([...ROTAS, ...noMenu])].sort()) {
    const regra = regraDe(rota)
    const primeiro = await get(rota)
    let final: Resultado = primeiro
    let caminhoFinal = rota
    for (let salto = 0; final.tipo === 'redireciona' && !destinoForaDoApp(final.destino) && salto < 5; salto++) {
      caminhoFinal = final.destino
      final = await get(caminhoFinal)
    }
    const regraDestino = caminhoFinal !== rota ? regraDe(caminhoFinal) : null
    const ver = avaliarRota({ rota, regra, usuario, resultado: primeiro, regraDestino, resultadoFinal: final })
    const resTxt = primeiro.tipo === 'redireciona' ? `redireciona ${primeiro.destino}${final.tipo !== 'redireciona' ? ` -> ${final.tipo}` : ''}` : primeiro.tipo
    out.linhas.push({ loja: lg.lojaNome, cargo: lg.cargo, rota, resultado: resTxt, esperado: regra ? (decidir(regra, usuario).permitido ? 'permitido' : 'proibido') : '?', veredito: ver.tipo, detalhe: ver.detalhe })
    if (ver.tipo === 'sem-regra') out.semRegraRotas.push(rota)
    if (ver.tipo === 'divergencia') out.divergencias.push(`${lg.lojaNome}/${lg.cargo} ${rota}: ${ver.detalhe}`)
    if (final.tipo === 'abriu' && caminhoFinal === rota) abertas.push(rota)
    if (ver.tipo === 'furo') {
      await page.goto(`${ORIGEM}${rota}`, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {})
      await esperar(page)
      const png = await pngDe(rota, '')
      falha('furo-endereco', rota, `abrir ${rota} direto pelo endereço`, `bloqueada (${decidir(regraDestino && !decidir(regraDestino, usuario).permitido ? regraDestino : regra!, usuario).motivo})`, `abriu (${resTxt})`, png)
    }
  }

  // (c) botões que gravam, só nas telas que abriram (lê o DOM, não clica)
  for (const rota of [...new Set(BOTOES.map((b) => b.rota))]) {
    if (!abertas.includes(rota)) continue
    await page.goto(`${ORIGEM}${rota}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await esperar(page)
    const info = await page.evaluate(coletar)
    const r = avaliarBotoes({ rota, acoes: info.acoes, usuario, regras: BOTOES })
    for (const s of r.semRegra) out.semRegraBotoes.push({ rota, botao: s })
    for (const f of r.furos) {
      const png = await pngDe(rota, `-botao`)
      falha('furo-acao', rota, `ver o botão "${f.botao}" (sem clicar)`, `botão ausente (${f.motivo})`, 'o botão aparece na tela', png)
    }
  }

  // (d) APIs de leitura por endereço
  const token = tokenDosCookies(await ctx.cookies())
  const api = async (caminho: string, cab: Record<string, string> = {}) => {
    const resp = await ctx.request.get(`${ORIGEM}${caminho}`, { maxRedirects: 0, failOnStatusCode: false, timeout: 120000, headers: cab })
    return { status: resp.status(), corpo: await resp.text() }
  }
  for (const a of APIS) {
    if ((a.soLoja && a.soLoja !== lg.loja) || (a.pularDono && lg.cargo === 'dono')) continue
    const r = await api(a.caminho)
    const ver = avaliarApi({ regra: a.regra, usuario, status: r.status, bloqueioEh404: a.bloqueioEh404 })
    out.linhas.push({ loja: lg.lojaNome, cargo: lg.cargo, rota: `GET ${a.caminho}`, resultado: `HTTP ${r.status}`, esperado: decidir(a.regra, usuario).permitido ? 'permitido' : 'proibido', veredito: ver.tipo, detalhe: ver.detalhe })
    if (ver.tipo === 'furo') falha('furo-api', `GET ${a.caminho}`, `chamar ${a.caminho} direto`, `bloqueado (${decidir(a.regra, usuario).motivo})`, `HTTP ${r.status}`, '(sem tela: resposta HTTP)')
    if (ver.tipo === 'divergencia') out.divergencias.push(`${lg.lojaNome}/${lg.cargo} GET ${a.caminho}: ${ver.detalhe}`)
  }
  if (token) {
    for (const t of TABELAS_OFFLINE) {
      const caminho = `/api/offline/snapshot?tabela=${t.tabela}&limite=1`
      const r = await api(caminho, { Authorization: `Bearer ${token}`, 'x-ntb-versao': '99.0.0' })
      let linhas = 0
      let bloqueado = false
      try {
        const j = JSON.parse(r.corpo) as { linhas?: unknown[]; bloqueado?: boolean }
        linhas = j.linhas?.length ?? 0
        bloqueado = j.bloqueado === true
      } catch { /* corpo não-JSON */ }
      // Desde a correção da F-05 o canal bloqueia com 200 + { bloqueado: true } e página vazia (o app desktop não pode receber erro, senão aborta a carga inicial).
      const statusEfetivo = r.status === 200 && bloqueado ? 403 : r.status
      const ver = avaliarApi({ regra: t.regra, usuario, status: statusEfetivo })
      out.linhas.push({ loja: lg.lojaNome, cargo: lg.cargo, rota: `GET ${caminho}`, resultado: `HTTP ${r.status}${bloqueado ? ' bloqueado' : ''} (${linhas} linha lida)`, esperado: decidir(t.regra, usuario).permitido ? 'permitido' : 'proibido', veredito: ver.tipo, detalhe: ver.detalhe })
      if (ver.tipo === 'furo' && statusEfetivo === 200)
        falha('furo-api', `GET /api/offline/snapshot?tabela=${t.tabela}`, `ler a tabela ${t.tabela} pelo canal offline (token do próprio login)`, `bloqueado (${decidir(t.regra, usuario).motivo})`, `HTTP 200, ${linhas} linha(s) devolvida(s)`, '(sem tela: resposta HTTP)')
      if (ver.tipo === 'furo' && statusEfetivo !== 200) out.divergencias.push(`${lg.lojaNome}/${lg.cargo} snapshot ${t.tabela}: HTTP ${r.status} inesperado (não é bloqueio claro)`)
    }
  } else {
    out.divergencias.push(`${lg.lojaNome}/${lg.cargo}: token da sessão não achado nos cookies; canal offline não conferido`)
  }
  await ctx.close()
  return out
}

const t0 = Date.now()
const browser = await chromium.launch()
const paralelo = Math.max(1, Number(process.env.ROBO_PARALELO ?? 2))
const resultados: Saida[] = new Array(alvo.length)
let prox = 0
await Promise.all(Array.from({ length: paralelo }, async () => {
  while (prox < alvo.length) {
    const i = prox++
    const t = Date.now()
    try {
      resultados[i] = await rodarLogin(browser, alvo[i])
      console.log(`${alvo[i].lojaNome}/${alvo[i].cargo}: ${resultados[i].linhas.length} conferências, ${resultados[i].falhas.length} furos (${Math.round((Date.now() - t) / 1000)}s)`)
    } catch (e) {
      console.error(`${alvo[i].email}: FALHOU ${(e as Error).message}`)
      resultados[i] = { falhas: [], linhas: [], semRegraRotas: [], semRegraBotoes: [], divergencias: [`${alvo[i].email}: o login não terminou (${(e as Error).message})`] }
    }
  }
}))
await browser.close()

const falhas = resultados.flatMap((r) => r.falhas)
const linhas = resultados.flatMap((r) => r.linhas)
const md = formatarFalhasPermissoes(falhas, { logins: alvo.length, rotas: ROTAS.length })
fs.writeFileSync(path.join(SAIDA, 'falhas.md'), md)
fs.writeFileSync(path.join(SAIDA, 'observado.json'), JSON.stringify(linhas, null, 1))
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const db = await cargosDoBanco()
const cob: string[] = ['# Cobertura e achados sem furo', '']
cob.push('## Cargos', '', ...db.cargos.map((c) => `- ${c.nome}: ${logins.some((l) => l.cargo === c.nome.toLowerCase()) ? 'coberto' : 'NÃO COBERTO (sem login de teste)'}`), '- Perfil AdminLoja: NÃO COBERTO (sem login de teste)', '')
cob.push(`## Auditoria de novembro`, '', `- Permissões sem nenhum cargo hoje: ${db.orfas.length} de ${db.totalPermissoes} (a auditoria contou 57 de 79 em 03/11).`, `- Migration 310: ${db.migration310.linhas - db.migration310.faltam.length} de ${db.migration310.linhas} linhas já estão em cargo_permissao${db.migration310.faltam.length ? '; faltam: ' + db.migration310.faltam.map((f) => f.join(' / ')).join('; ') : ' (aplicada no backup de 17/11)'}.`, `- Sem cargo: ${db.orfas.join('; ')}`, '')
const semRotas = [...new Set(resultados.flatMap((r) => r.semRegraRotas))].sort(cmp)
cob.push('## Rotas sem regra na matriz (não avaliadas)', '', semRotas.length ? semRotas.map((r) => `- ${r}`).join('\n') : '(nenhuma)', '')
const semBot = [...new Set(resultados.flatMap((r) => r.semRegraBotoes).map((b) => `${b.rota} | ${b.botao}`))].sort(cmp)
cob.push('## Botões que gravam, visíveis a algum login, sem regra na matriz (não avaliados)', '', semBot.length ? semBot.map((r) => `- ${r}`).join('\n') : '(nenhum)', '')
const dv = [...new Set(resultados.flatMap((r) => r.divergencias))].sort(cmp)
cob.push('## Divergências (bloqueado onde a matriz permite; não é furo)', '', dv.length ? dv.map((r) => `- ${r}`).join('\n') : '(nenhuma)', '')
fs.writeFileSync(path.join(SAIDA, 'cobertura.md'), cob.join('\n'))
const porCargo: Record<string, number> = {}
for (const f of falhas) porCargo[`${f.loja}/${f.cargo}`] = (porCargo[`${f.loja}/${f.cargo}`] ?? 0) + 1
const porTipo: Record<string, number> = {}
for (const f of falhas) porTipo[f.tipo] = (porTipo[f.tipo] ?? 0) + 1
const resumo = { rodada: ID_RODADA, urlBase: ORIGEM, logins: alvo.length, rotas: ROTAS.length, conferencias: linhas.length, furos: falhas.length, porTipo, furosPorLoginCargo: porCargo, divergencias: dv.length, sha256FalhasMd: crypto.createHash('sha256').update(md).digest('hex'), segundos: Math.round((Date.now() - t0) / 1000) }
fs.writeFileSync(path.join(SAIDA, 'resumo.json'), JSON.stringify(resumo, null, 1))
console.log(JSON.stringify(resumo))
process.exit(0)
