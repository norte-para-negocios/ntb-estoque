import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerConfigFinanceiro, listarAprovacoes, listarAvulsosTransferencias, listarRecorrentes, type Db } from './consultas.ts'

// Leituras da migration 370 (aprovação, recorrentes, avulsos e transferências), com cliente falso.
type Resp = { data: unknown; error: { code?: string; message: string } | null }
const falso = (resp: Resp): Db => ({ rpc: () => Promise.resolve(resp), from: () => { throw new Error('não usa from') } }) as unknown as Db
const erro = (code: string) => ({ data: null, error: { code, message: 'falhou' } })

test('lerConfigFinanceiro: converte para centavos; sem migration = padrão do dono e aviso; erro real lança', async () => {
  const r = await lerConfigFinanceiro(falso({ data: { aprovacao_ativa: true, aprovacao_ate: '1000.50', aprovacao_alto_acima: 5000,
    aprovacao_autor_pode_aprovar: false, recorrentes_dias: 30, salva: true, atualizado_por_nome: 'Dono', updated_at: '2026-11-05' }, error: null }), 19)
  assert.equal(r.semMigration, false)
  assert.deepEqual(r.config, { ativa: true, ateCent: 1000_50, altoAcimaCent: 5000_00, autorPodeAprovar: false, recorrentesDias: 30 })
  assert.equal(r.atualizadoPor, 'Dono')
  const s = await lerConfigFinanceiro(falso(erro('PGRST202')), 19)
  assert.equal(s.semMigration, true)
  assert.deepEqual(s.config, { ativa: false, ateCent: 1000_00, altoAcimaCent: 5000_00, autorPodeAprovar: true, recorrentesDias: 45 })
  await assert.rejects(lerConfigFinanceiro(falso(erro('57014')), 19), /configuração/)
})

test('listarAprovacoes: números convertidos, sem migration vira aviso, erro real lança', async () => {
  const r = await listarAprovacoes(falso({ data: [{ id: '7', numero: '3', valor: '2500.00', aprovacao_nivel: '1', aprovacao: 'pendente' }], error: null }), 19, 'pendente')
  assert.deepEqual([r.itens[0].id, r.itens[0].numero, r.itens[0].valor, r.itens[0].aprovacao_nivel], [7, 3, 2500, 1])
  assert.deepEqual(await listarAprovacoes(falso(erro('42883')), 19, 'pendente'), { itens: [], semMigration: true })
  await assert.rejects(listarAprovacoes(falso(erro('500')), 19, 'pendente'), /aprovação/)
})

test('listarRecorrentes: números convertidos, sem migration vira aviso, erro real lança', async () => {
  const r = await listarRecorrentes(falso({ data: [{ id: '2', valor: '3500', dia: '10', geradas: '3', fornecedor_id: '9', categoria_id: null }], error: null }), 19, '2026-11-05')
  assert.deepEqual([r.recorrentes[0].id, r.recorrentes[0].valor, r.recorrentes[0].dia, r.recorrentes[0].geradas, r.recorrentes[0].categoria_id], [2, 3500, 10, 3, null])
  assert.deepEqual(await listarRecorrentes(falso(erro('PGRST202')), 19, '2026-11-05'), { recorrentes: [], semMigration: true })
  await assert.rejects(listarRecorrentes(falso(erro('500')), 19, '2026-11-05'), /recorrentes/)
})

test('listarAvulsosTransferencias: as duas listas, sem migration vira aviso, erro real lança', async () => {
  const r = await listarAvulsosTransferencias(falso({ data: { avulsos: [{ id: '1', valor: '10.5', estorno_id: null }], transferencias: [{ id: '4', valor: '300' }] }, error: null }), 19)
  assert.equal(r.avulsos[0].valor, 10.5)
  assert.equal(r.avulsos[0].estorno_id, null)
  assert.equal(r.transferencias[0].id, 4)
  assert.deepEqual(await listarAvulsosTransferencias(falso(erro('PGRST202')), 19), { avulsos: [], transferencias: [], semMigration: true })
  await assert.rejects(listarAvulsosTransferencias(falso(erro('500')), 19), /lançamentos/)
})

test('o padrão local da configuração é o mesmo de CONFIG_PADRAO', async () => {
  const { CONFIG_PADRAO } = await import('./aprovacao-puro.ts')
  const s = await lerConfigFinanceiro(falso(erro('PGRST202')), 19)
  assert.deepEqual(s.config, CONFIG_PADRAO)
})
