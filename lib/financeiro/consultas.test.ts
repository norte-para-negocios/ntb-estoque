import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detalheTitulo, extratoConta, listarCategorias, listarContas, listarFornecedores, listarTitulos, type Db } from './consultas.ts'

// Cliente falso: rpc devolve o que o teste mandar; from() é uma cadeia que termina com { data, error } (await) ou range().
type Resp = { data: unknown; error: { code?: string; message: string } | null }
function falso(resp: Resp): Db {
  const cadeia: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order']) cadeia[m] = () => cadeia
  cadeia.range = () => Promise.resolve(resp)
  cadeia.then = (ok: (r: Resp) => unknown) => Promise.resolve(resp).then(ok)
  return { rpc: () => Promise.resolve(resp), from: () => cadeia } as unknown as Db
}
const erro = (code: string) => ({ data: null, error: { code, message: 'falhou' } })

test('listarContas devolve as contas em sucesso (e converte os números)', async () => {
  const r = await listarContas(falso({ data: [{ id: 1, nome: 'Caixa', saldo_inicial: '10.50', saldo_atual: '8.5', lancamentos: '2' }], error: null }), 15)
  assert.equal(r.semMigration, false)
  assert.equal(r.contas.length, 1)
  assert.deepEqual([r.contas[0].saldo_inicial, r.contas[0].saldo_atual, r.contas[0].lancamentos], [10.5, 8.5, 2])
})

test('listarContas: sem migration vira aviso; erro real é lançado (nunca lista vazia calada)', async () => {
  assert.deepEqual(await listarContas(falso(erro('PGRST202')), 15), { contas: [], semMigration: true })
  await assert.rejects(listarContas(falso(erro('57014')), 15), /contas correntes/)
})

test('listarCategorias / listarFornecedores: sucesso, sem migration e erro real', async () => {
  assert.equal((await listarCategorias(falso({ data: [{ id: 1 }], error: null }), 15)).length, 1)
  assert.deepEqual(await listarCategorias(falso(erro('42P01')), 15), [])
  await assert.rejects(listarCategorias(falso(erro('500')), 15), /categorias/)
  assert.deepEqual(await listarFornecedores(falso({ data: [{ id: 3, razao_social: 'A', nome_fantasia: null }], error: null }), 15), [{ id: 3, nome: 'A' }])
  await assert.rejects(listarFornecedores(falso(erro('500')), 15), /fornecedores/)
})

test('listarTitulos: sucesso, sem migration e erro real viram mensagens distintas', async () => {
  const ok = await listarTitulos(falso({ data: { itens: [{ id: 1, valor: '5', valor_quitado: '0', restante: '5' }], totais: { quantidade: 1, valor_total: '5' } }, error: null }), 15, {}, '2026-10-21', 50, 0)
  assert.equal(ok.erro, null)
  assert.equal(ok.itens[0].restante, 5)
  assert.match((await listarTitulos(falso(erro('42883')), 15, {}, '2026-10-21', 50, 0)).erro ?? '', /ainda não foi ativado/)
  assert.match((await listarTitulos(falso(erro('57014')), 15, {}, '2026-10-21', 50, 0)).erro ?? '', /Não foi possível carregar/)
})

test('detalheTitulo e extratoConta checam o erro', async () => {
  const det = { titulo: { valor: '10', valor_quitado: '0', restante: '10' }, pagamentos: [], eventos: [] }
  assert.equal((await detalheTitulo(falso({ data: det, error: null }), 15, 1, '2026-10-21'))?.titulo.valor, 10)
  assert.equal(await detalheTitulo(falso({ data: null, error: null }), 15, 1, '2026-10-21'), null)
  await assert.rejects(detalheTitulo(falso(erro('57014')), 15, 1, '2026-10-21'), /título/)
  const ex = { saldo_anterior: '1', saldo_final: '2', itens: [{ id: 1, valor: '3', saldo_apos: '2' }] }
  assert.equal((await extratoConta(falso({ data: ex, error: null }), 15, 1, null, null))?.saldoFinal, 2)
  assert.equal(await extratoConta(falso(erro('22023')), 15, 1, null, null), null) // conta de outra loja
  await assert.rejects(extratoConta(falso(erro('57014')), 15, 1, null, null), /extrato/)
})
