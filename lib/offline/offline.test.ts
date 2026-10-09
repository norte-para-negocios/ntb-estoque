import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { POLITICA, politicaDe, modoEfetivo } from './politica.ts'
import { serializarArgs, desserializarArgs, lerDigest, serializarValor, desserializarValor } from './serializacao.ts'
import { ehProvisorio, reescreverIds, tabelaDoProvisorio, provisoriosEm, pkProvisorio } from './ids-provisorios.ts'
import { parear } from './pareamento.ts'

test('política: toda ação listada existe em lib/actions', () => {
  const dir = path.join(import.meta.dirname, '..', 'actions')
  const existentes = new Set<string>()
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    for (const m of src.matchAll(/^export async function (\w+)/gm)) existentes.add(`${f.replace('.ts', '')}#${m[1]}`)
  }
  for (const nome of Object.keys(POLITICA)) assert.ok(existentes.has(nome), `ação inexistente na política: ${nome}`)
})

test('política: desconhecida = null, depende resolve pelo modo da loja', () => {
  assert.equal(politicaDe('produto#criarProduto'), null)
  assert.equal(politicaDe('__proto__'), null)
  assert.equal(politicaDe('estoque-proprio#entradaManual'), 'local')
  assert.equal(modoEfetivo('depende', true), 'local')
  assert.equal(modoEfetivo('depende', false), 'fila')
  assert.equal(modoEfetivo('leitura', false), 'leitura')
})

test('serialização: FormData com arquivo, Date e undefined voltam iguais', async () => {
  const fd = new FormData()
  fd.append('nome', 'Queijo')
  fd.append('xml', new File([Buffer.from('<nfe/>')], 'nota.xml', { type: 'text/xml' }))
  const d = new Date('2026-10-09T12:00:00.000Z')
  const json = await serializarArgs([fd, d, undefined, { a: 1, b: [2, 'x'] }])
  const [fd2, d2, u, o] = desserializarArgs(JSON.parse(JSON.stringify(json)))
  assert.ok(fd2 instanceof FormData)
  assert.equal((fd2 as FormData).get('nome'), 'Queijo')
  const arq = (fd2 as FormData).get('xml') as File
  assert.equal(arq.name, 'nota.xml')
  assert.equal(Buffer.from(await arq.arrayBuffer()).toString(), '<nfe/>')
  assert.equal((d2 as Date).toISOString(), d.toISOString())
  assert.equal(u, undefined)
  assert.deepEqual(o, { a: 1, b: [2, 'x'] })
  assert.deepEqual(desserializarValor(await serializarValor({ ok: true })), { ok: true })
})

test('lerDigest: redirect e notFound', () => {
  assert.deepEqual(lerDigest({ digest: 'NEXT_REDIRECT;replace;/inventario/12;307;' }), { tipo: 'redirect', url: '/inventario/12', modo: 'replace', status: 307 })
  assert.deepEqual(lerDigest({ digest: 'NEXT_REDIRECT;push;/a?x=1;b=2;303;' }), { tipo: 'redirect', url: '/a?x=1;b=2', modo: 'push', status: 303 })
  assert.deepEqual(lerDigest({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }), { tipo: 'notfound' })
  assert.equal(lerDigest(new Error('x')), null)
})

test('ids provisórios: faixas int4/int8 e reescrita em número e texto', () => {
  assert.equal(ehProvisorio(1234), false)
  assert.equal(ehProvisorio(2_000_000_005), true)
  assert.equal(ehProvisorio(5_000_000_000_000_007), true)
  assert.equal(ehProvisorio(8_000_000_000_001), false) // n_id_receb da NF própria (8e12) não é provisório
  const faixas = { inventarios: { base: 2_003_000_000, tipo: 'int4' as const }, movimentos: { base: 5_000_000_020_000_000, tipo: 'int8' as const } }
  assert.equal(tabelaDoProvisorio(2_003_000_002, faixas), 'inventarios')
  assert.equal(tabelaDoProvisorio(5_000_000_020_000_001, faixas), 'movimentos')
  assert.equal(tabelaDoProvisorio(2_004_000_000, faixas), null)
  const mapa = new Map([[2_003_000_002, 512]])
  const cand = new Set([2_003_000_002, 2_003_000_009])
  const r = reescreverIds([2_003_000_002, { id: '2003000002', url: '/inventario/2003000002?x=1', outro: 2_003_000_009, fone: '2133334444' }, 'nota 123'], mapa, cand)
  assert.deepEqual(r.json, [512, { id: '512', url: '/inventario/512?x=1', outro: 2_003_000_009, fone: '2133334444' }, 'nota 123'])
  assert.deepEqual(r.faltando, [2_003_000_009])
  // sem nada criado offline, nada é tocado (telefone na faixa não vira "dependência")
  assert.deepEqual(reescreverIds({ fone: 2133334444 }, new Map(), new Set()), { json: { fone: 2133334444 }, faltando: [] })
  assert.deepEqual(provisoriosEm({ a: [2_000_000_001] }, new Set([2_000_000_001])), [2_000_000_001])
  assert.equal(pkProvisorio('inventarios', { id: 2_003_000_002 }, faixas), true)
  assert.equal(pkProvisorio('inventarios', { id: 2_100_000_000 }, faixas), false)
  assert.equal(pkProvisorio('produtos', { id: 2_003_000_002 }, faixas), false)
})

test('pareamento: por tabela, na ordem; contagem diferente = divergente', () => {
  const r = parear(
    [
      { tabela: 'inventarios', pk: { id: 2_003_000_000 } },
      { tabela: 'inventario_items', pk: { id: 2_002_000_000 } },
      { tabela: 'inventario_items', pk: { id: 2_002_000_001 } },
      { tabela: 'audit_log', pk: { id: 2_001_000_000 } },
    ],
    [
      { tabela: 'inventarios', pk: { id: 700 } },
      { tabela: 'inventario_items', pk: { id: 9001 } },
      { tabela: 'inventario_items', pk: { id: 9002 } },
    ],
  )
  assert.deepEqual([...r.mapa.entries()], [[2_003_000_000, 700], [2_002_000_000, 9001], [2_002_000_001, 9002]])
  assert.deepEqual(r.divergentes, ['audit_log'])
})
