// C1: prova estática de que, com OMIE_GRAVAR_PEDIDOS_COMPRA e OMIE_LER_PEDIDOS_COMPRA desligadas (produção hoje), nada
// novo roda: cada ponto de entrada confere a variável ANTES de ler o banco ou chamar o Omie, e o cron novo não está
// agendado. (Os módulos de servidor importam o Supabase e não rodam no node --test; a regra das variáveis em si está
// testada em pedido-omie-gravar-puro.test.ts.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
/** corpo da função (do nome até a próxima `export`) */
function corpo(src: string, nome: string): string {
  const i = src.indexOf(`export async function ${nome}`)
  assert.ok(i >= 0, `função ${nome} não achada`)
  const j = src.indexOf('\nexport ', i + 10)
  return src.slice(i, j < 0 ? undefined : j)
}
const antes = (s: string, a: string, b: string) => {
  const ia = s.indexOf(a); const ib = s.indexOf(b)
  assert.ok(ia >= 0, `não achou: ${a}`); assert.ok(ib >= 0, `não achou: ${b}`)
  assert.ok(ia < ib, `"${a}" precisa vir antes de "${b}"`)
}

test('o cron novo não está no sync-cron.sh (entra só na ativação)', () => {
  assert.equal(ler('scripts/sync-cron.sh').includes('enviar-pedidos-compra-omie'), false)
})

test('rota do cron: variável desligada responde antes de processar a fila', () => {
  const s = ler('app/api/cron/enviar-pedidos-compra-omie/route.ts')
  antes(s, 'if (!gravacaoPedidosOmieLigada(process.env)) return', 'processarFilaPedidosCompraOmie()')
})

test('gravação: variável conferida antes de qualquer leitura do banco ou chamada ao Omie', () => {
  const s = ler('lib/omie/pedido-compra-gravar.ts')
  const env = 'if (!gravacaoPedidosOmieLigada(process.env)) return'
  antes(corpo(s, 'enviarPedidoCompraOmie'), env, 'carregarLoja(')
  antes(corpo(s, 'enviarPedidoCompraOmie'), env, 'omieRequest')
  antes(corpo(s, 'processarFilaPedidosCompraOmie'), env, "from('lojas')")
})

test('estado da loja: sem a variável de gravação não lê o opt-in (só o modo, como antes)', () => {
  const s = corpo(ler('lib/compras/pedido-compra-loja.ts'), 'estadoPedidoCompraLoja')
  antes(s, "if (modo !== 'omie' || !gravacaoPedidosOmieLigada(process.env))", "from('lojas')")
})

test('leitura dos pedidos do Omie: variável conferida antes de ler', () => {
  const s = ler('lib/omie/pedidos-compra.ts')
  for (const f of ['saldoPedidosCompraOmie', 'listarPedidosCompraOmie']) antes(corpo(s, f), 'if (!leituraPedidosOmieLigada(process.env)) return', 'pedidosComCache(')
})

test('telas e ações do pedido usam o mesmo portão (nenhuma volta a olhar só o modo)', () => {
  for (const p of ['app/(app)/pedido-compra/page.tsx', 'app/(app)/pedido-compra/novo/page.tsx', 'app/(app)/pedido-compra/[id]/page.tsx',
    'app/(app)/pedido-compra/[id]/editar/page.tsx', 'app/(app)/pedido-compra/[id]/pdf/route.ts', 'lib/actions/pedido-compra.ts']) {
    const s = ler(p)
    assert.ok(s.includes('estadoPedidoCompraLoja('), p)
    assert.equal(/modoDaLoja\(lojaId\)\)\s*!==\s*'proprio'/.test(s), false, p)
  }
})

test('omieRequest usa o detector de escrita do módulo puro (AlteraPedCompra/UpsertPedCompra simulados na loja de teste)', () => {
  const s = ler('lib/omie/client.ts')
  assert.ok(s.includes("ehChamadaDeEscrita, msRestantesBloqueio"))
  assert.equal(s.includes('function ehChamadaDeEscrita'), false)
})

test('revisão I1: a tentativa só vira "enviando" pela RPC que trava o pedido (nunca por update direto na fila)', () => {
  const s = ler('lib/omie/pedido-compra-gravar.ts')
  assert.ok(s.includes("rpc('pc_omie_reivindicar'"))
  assert.equal(/status:\s*'enviando'/.test(s), false)
  // revisão 2: a falha da inclusão usa a regra que mantém "já existe" como incerto
  assert.ok(s.includes('incertoAposFalhaDaInclusao(msg, faultCode'))
})

test('revisão I3: "Enviar/Conferir no Omie" exige quem aprova, não pula a espera e olha o bloqueio gravado antes', () => {
  const s = corpo(ler('lib/actions/pedido-compra.ts'), 'enviarPedidoAoOmieAgora')
  assert.ok(s.includes("contexto('Compras - Aprovar pedidos')"))
  assert.equal(s.includes('manual'), false)
  antes(ler('lib/omie/pedido-compra-gravar.ts'), 'await msBloqueioGravado(loja.omie_app_key)', 'const r = await reivindicar(')
})
