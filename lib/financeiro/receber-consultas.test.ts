import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listarFormasRecebimento, listarTitulosReceber, chaveLigada, type Db } from './receber-consultas.ts'

type Resp = { data: unknown; error: { code?: string; message: string } | null }
function falso(resp: Resp): Db {
  const cadeia: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'in']) cadeia[m] = () => cadeia
  cadeia.maybeSingle = () => Promise.resolve(resp)
  cadeia.then = (ok: (r: Resp) => unknown) => Promise.resolve(resp).then(ok)
  return { rpc: () => Promise.resolve(resp), from: () => cadeia } as unknown as Db
}
const erro = (code: string) => ({ data: null, error: { code, message: 'falhou' } })

test('formas: as 7 sempre aparecem, cadastradas ou não (sem cadastro = taxa 0, prazo 0, "configurar")', async () => {
  const r = await listarFormasRecebimento(falso({ data: [{ id: 9, forma: 'credito', adquirente: 'Stone', taxa_percentual: '3.19', taxa_fixa: '0.10', prazo_dias: 30, dias_uteis: false, conta_id: 4, observacao: null }], error: null }), 19)
  assert.equal(r.semMigration, false)
  assert.equal(r.formas.length, 7)
  const cred = r.formas.find((f) => f.forma === 'credito')!
  assert.deepEqual([cred.cadastrada, cred.taxa_percentual, cred.taxa_fixa, cred.adquirente], [true, 3.19, 0.1, 'Stone'])
  const pix = r.formas.find((f) => f.forma === 'pix')!
  assert.deepEqual([pix.cadastrada, pix.taxa_percentual, pix.prazo_dias, pix.conta_id], [false, 0, 0, null])
})

test('formas: sem migration vira aviso; erro real é lançado', async () => {
  assert.equal((await listarFormasRecebimento(falso(erro('42P01')), 19)).semMigration, true)
  await assert.rejects(listarFormasRecebimento(falso(erro('57014')), 19), /formas de recebimento/)
})

test('títulos: converte números e devolve totais; sem migration e erro real são mensagens distintas', async () => {
  const ok = await listarTitulosReceber(falso({ data: {
    itens: [{ id: 1, forma: 'credito', valor_bruto: '150', valor_taxa: '4.99', valor_liquido: '145.01', valor_recebido: null, diferenca: null, status: 'aberto', data_prevista: '2026-11-29', data_venda: '2026-10-30' }],
    totais: { quantidade: 1, bruto: '150', taxa: '4.99', liquido: '145.01', a_receber: '145.01', atrasado: '0', recebido: '0', diferenca: '0', configurar: 0 },
  }, error: null }), 19, {}, '2026-11-05', 50, 0)
  assert.equal(ok.erro, null)
  assert.deepEqual([ok.itens[0].valor_bruto, ok.itens[0].valor_liquido, ok.itens[0].valor_recebido, ok.itens[0].situacao], [150, 145.01, null, 'aberto'])
  assert.equal(ok.totais.liquido, 145.01)
  assert.match((await listarTitulosReceber(falso(erro('PGRST202')), 19, {}, '2026-11-05', 50, 0)).erro!, /migration 380/)
  assert.match((await listarTitulosReceber(falso(erro('57014')), 19, {}, '2026-11-05', 50, 0)).erro!, /Não foi possível/)
})

test('títulos: situação "atrasado" calculada com a data de hoje', async () => {
  const r = await listarTitulosReceber(falso({ data: { itens: [{ id: 1, status: 'aberto', data_prevista: '2026-11-01', valor_bruto: '1', valor_taxa: '0', valor_liquido: '1' }], totais: {} }, error: null }), 19, {}, '2026-11-05', 50, 0)
  assert.equal(r.itens[0].situacao, 'atrasado')
})

test('chave da loja: lida da coluna; sem a coluna (migration não aplicada) = desligada e avisa', async () => {
  assert.deepEqual(await chaveLigada(falso({ data: { fin_cr_vendas_ativo: true }, error: null }), 19), { ligada: true, semMigration: false })
  assert.deepEqual(await chaveLigada(falso(erro('42703')), 19), { ligada: false, semMigration: true })
  await assert.rejects(chaveLigada(falso(erro('57014')), 19), /chave/)
})
