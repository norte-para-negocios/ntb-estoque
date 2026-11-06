import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detalheTitulo, extratoConta, listarCategorias, listarContas, listarFamiliasCategoria, listarFornecedores, listarTitulos, notasSemConta,
  pendenciasNotaDesfeita, titulosDaNota, type Db,
} from './consultas.ts'

// Cliente falso: rpc devolve o que o teste mandar; from() é uma cadeia que termina com { data, error } (await) ou range().
type Resp = { data: unknown; error: { code?: string; message: string } | null }
function falso(resp: Resp): Db {
  const cadeia: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'in']) cadeia[m] = () => cadeia
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

test('titulosDaNota: converte os números, traz a falha só quando é a última notícia, e não engole erro', async () => {
  const tit = [{ id: 1, numero: 7, parcela: 1, total_parcelas: 2, valor: '100.5', valor_quitado: '0', data_vencimento: '2026-11-10', status: 'aberto', motivo_cancelamento: null }]
  // o cliente falso devolve a mesma resposta para as duas leituras: a 2ª (eventos) vem sem 'tipo' → sem falha
  const ok = await titulosDaNota(falso({ data: tit, error: null }), 19, 5)
  assert.equal(ok.titulos[0].valor, 100.5)
  assert.equal(ok.falha, null)
  const falha = await titulosDaNota(falso({ data: [{ tipo: 'titulos_falha', detalhe: { erro: 'Nota sem CNPJ' } }], error: null }), 19, 5)
  assert.equal(falha.falha, 'Nota sem CNPJ')
  assert.deepEqual(await titulosDaNota(falso(erro('42P01')), 19, 5), { titulos: [], falha: null, semMigration: true })
  await assert.rejects(titulosDaNota(falso(erro('57014')), 19, 5), /contas a pagar da nota/)
})

// ------------------------------------------------------------------------------------- decisões de 05/11 (migration 360)

test('listarFamiliasCategoria: converte, avisa sem a migration 360 e não engole erro real', async () => {
  const ok = await listarFamiliasCategoria(falso({ data: [{ codigo_familia: '8000000000257', nome: 'Atacado', inativa: false, produtos: '24', categoria_id: '36', categoria_nome: 'Insumos', categoria_ok: true }], error: null }), 19)
  assert.equal(ok.semMigration, false)
  assert.deepEqual(ok.familias[0], { codigo_familia: 8000000000257, nome: 'Atacado', inativa: false, produtos: 24, categoria_id: 36, categoria_nome: 'Insumos', categoria_ok: true })
  assert.deepEqual(await listarFamiliasCategoria(falso(erro('PGRST202')), 19), { familias: [], semMigration: true })
  await assert.rejects(listarFamiliasCategoria(falso(erro('57014')), 19), /famílias/)
})

test('notasSemConta: valores e parcelas viram número; sem migration avisa; erro real sobe', async () => {
  const ok = await notasSemConta(falso({ data: [{ loja_id: '15', loja_nome: 'ODARA', chave_ligada: false, nota_id: '9', compra_id: '3', numero: '12', fornecedor_nome: 'F', fornecedor_cnpj: '1',
    emissao: '2026-10-01', data_entrada: '2026-10-02', valor_total: '90.5', status_compra: 'lancada', regra: 'duplicatas',
    parcelas: [{ parcela: 1, total: 1, vencimento: '2026-10-20', valor: '90.5' }], categoria_id: null, categoria_nome: null, familia_nome: 'Bebidas',
    motivo_categoria: 'familia_sem_categoria', ultima_falha: null }], error: null }), null)
  assert.equal(ok.semMigration, false)
  assert.equal(ok.notas[0].valor_total, 90.5)
  assert.equal(ok.notas[0].loja_id, 15)
  assert.equal(ok.notas[0].nota_id, 9)
  assert.deepEqual(ok.notas[0].parcelas, [{ parcela: 1, total: 1, vencimento: '2026-10-20', valor: 90.5 }])
  assert.deepEqual(await notasSemConta(falso(erro('42883')), null), { notas: [], semMigration: true })
  await assert.rejects(notasSemConta(falso(erro('57014')), 15), /notas sem conta/)
})

test('pendenciasNotaDesfeita: converte e trata a migration ausente', async () => {
  const ok = await pendenciasNotaDesfeita(falso({ data: [{ titulo_id: '7', numero: 3, nota_id: '9', documento: 'NF 1', fornecedor_nome: 'F', parcela: 1, total_parcelas: 2,
    valor: '100', valor_quitado: '50', data_vencimento: '2026-11-10', status: 'parcial', status_compra: 'pendente', desfeita_em: '2026-11-05T10:00:00Z', pagamentos: '2' }], error: null }), 19)
  assert.deepEqual([ok.pendencias[0].titulo_id, ok.pendencias[0].valor, ok.pendencias[0].valor_quitado, ok.pendencias[0].pagamentos], [7, 100, 50, 2])
  assert.deepEqual(await pendenciasNotaDesfeita(falso(erro('PGRST202')), 19), { pendencias: [], semMigration: true })
  await assert.rejects(pendenciasNotaDesfeita(falso(erro('500')), 19), /desfeitas/)
})

test('titulosDaNota: traz o nome da categoria de cada conta (null = "A definir" na tela)', async () => {
  const tit = [{ id: 1, numero: 7, parcela: 1, total_parcelas: 1, valor: '10', valor_quitado: '0', data_vencimento: '2026-11-10', status: 'aberto', motivo_cancelamento: null, categoria_id: 1, nome: 'Bebidas' }]
  // o falso devolve as mesmas linhas para a leitura das categorias: id 1 → 'Bebidas'
  const ok = await titulosDaNota(falso({ data: tit, error: null }), 19, 5)
  assert.equal(ok.titulos[0].categoria_nome, 'Bebidas')
  const sem = await titulosDaNota(falso({ data: [{ ...tit[0], categoria_id: null }], error: null }), 19, 5)
  assert.equal(sem.titulos[0].categoria_nome, null)
})
