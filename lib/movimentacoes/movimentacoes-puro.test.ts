import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lerFiltrosMovimentacoes, origemDoKardex, hrefDocumento, numerosCandidatos, interpretarBuscaOP,
  movimentosPrevistosDaOP, casarKardexComOP, totaisDe, type OPMin, type KardexMin,
} from './movimentacoes-puro.ts'

const HOJE = '2026-10-13'

test('filtros: padrão 7 dias, invertido troca, limite por modo', () => {
  const p = lerFiltrosMovimentacoes({}, HOJE, false)
  assert.deepEqual([p.ini, p.fim], ['2026-10-07', '2026-10-13'])
  const inv = lerFiltrosMovimentacoes({ data_inicio: '2026-10-10', data_final: '2026-10-01' }, HOJE, false)
  assert.deepEqual([inv.ini, inv.fim], ['2026-10-01', '2026-10-10'])
  const longo = lerFiltrosMovimentacoes({ data_inicio: '2025-01-01', data_final: '2026-10-13' }, HOJE, true)
  assert.equal(longo.ini, '2026-07-14')
  assert.match(longo.erro ?? '', /92 dias/)
  const comProduto = lerFiltrosMovimentacoes({ data_inicio: '2025-01-01', q: 'leite' }, HOJE, true)
  assert.equal(comProduto.ini, '2025-10-13')
  assert.match(comProduto.erro ?? '', /366 dias/)
  const kardex = lerFiltrosMovimentacoes({ data_inicio: '2026-01-01' }, HOJE, false)
  assert.equal(kardex.ini, '2026-01-01')
  assert.equal(kardex.erro, null)
  const lixo = lerFiltrosMovimentacoes({ data_inicio: 'xx', page: '-3', local: '12a', produto: '55' }, HOJE, false)
  assert.equal(lixo.page, 1)
  assert.equal(lixo.local, null)
  assert.equal(lixo.produto, 55)
  assert.equal(lixo.ini, '2026-10-07')
})

test('origem do kardex', () => {
  const b = { des_origem: null, quantidade: -1, id_cupom: null, id_ajuste: null }
  assert.equal(origemDoKardex({ ...b, cod_origem: 'PDV', id_cupom: 9 }), 'pdv')
  assert.equal(origemDoKardex({ ...b, cod_origem: 'XYZ', id_cupom: 9 }), 'pdv')
  assert.equal(origemDoKardex({ ...b, cod_origem: 'OPS' }), 'op_consumo')
  assert.equal(origemDoKardex({ ...b, cod_origem: 'OPE', quantidade: 2 }), 'op_producao')
  assert.equal(origemDoKardex({ ...b, cod_origem: 'COM', quantidade: 5 }), 'nf')
  assert.equal(origemDoKardex({ ...b, cod_origem: 'TRF' }), 'transferencia')
  assert.equal(origemDoKardex({ ...b, cod_origem: 'SLD' }), 'inventario')
  assert.equal(origemDoKardex({ ...b, cod_origem: 'AJU', id_ajuste: 3 }), 'ajuste')
  assert.equal(origemDoKardex({ ...b, cod_origem: 'XYZ', des_origem: 'Ordem de Produção' }), 'op_consumo')
  assert.equal(origemDoKardex({ ...b, cod_origem: 'XYZ' }), 'outro')
  assert.equal(origemDoKardex({ ...b, cod_origem: null, id_ajuste: 4 }), 'ajuste')
})

test('link do documento', () => {
  assert.equal(hrefDocumento({ tipo: 'op', id: 7, rotulo: 'OP 1' }), '/ordem-producao/7')
  assert.equal(hrefDocumento({ tipo: 'nf', id: 8, rotulo: 'NF 2' }), '/nota-fiscal/8')
  assert.equal(hrefDocumento({ tipo: 'cupom', id: 9, rotulo: 'Cupom' }), '/faturamento/cupom/9')
  assert.equal(hrefDocumento({ tipo: 'transferencia', id: 4, rotulo: 'T' }), '/transferencia/4')
  assert.equal(hrefDocumento({ tipo: 'inventario', id: 5, rotulo: 'I' }), '/inventario/5')
  assert.equal(
    hrefDocumento({ tipo: 'ajuste', id: 6, rotulo: 'A', dia: '2026-10-01', produto: '701' }),
    '/estoque/ajustes?data_inicio=2026-10-01&data_final=2026-10-01&q=701',
  )
  assert.equal(hrefDocumento({ tipo: 'op', id: null, rotulo: 'OP ?' }), null)
})

test('números candidatos (OP/NF) ignoram ano, barra e zeros', () => {
  assert.deepEqual(numerosCandidatos('2026/00396850'), ['2026/00396850', '396850', '202600396850'])
  assert.ok(numerosCandidatos('000123').includes('123'))
  assert.deepEqual(numerosCandidatos(555), ['555'])
  assert.deepEqual(numerosCandidatos(null, '', undefined), [])
})

test('busca de OP: número, data e texto', () => {
  assert.deepEqual(interpretarBuscaOP('396850', HOJE), { texto: '396850', data: null, numero: '396850' })
  assert.deepEqual(interpretarBuscaOP('13/10', HOJE), { texto: '', data: '2026-10-13', numero: null })
  assert.deepEqual(interpretarBuscaOP('01/12/2025', HOJE), { texto: '', data: '2025-12-01', numero: null })
  assert.deepEqual(interpretarBuscaOP('  cupom 55 ', HOJE), { texto: 'cupom 55', data: null, numero: null })
  assert.deepEqual(interpretarBuscaOP('2026/00396850', HOJE), { texto: '2026/00396850', data: null, numero: '2026/00396850' })
  assert.deepEqual(interpretarBuscaOP('32/13', HOJE), { texto: '32/13', data: null, numero: '32/13' })
})

const OP: OPMin = {
  id: 1, identificacao_n_cod_op: 555, identificacao_c_num_op: '2026/00000042', identificacao_c_cod_int_op: 'X1',
  identificacao_n_cod_produto: 10, identificacao_n_qtde: 2, identificacao_codigo_local_estoque: 100,
  dt_conclusao_real: '2026-10-10', concluida: true,
}

test('movimentos previstos da OP: entrada + consumo de todos os insumos (cUtilizarDoEstoque N também consome)', () => {
  const r = movimentosPrevistosDaOP(OP, [
    { nIdProdutoMalha: 20, nQtde: 0.5, codigo_local_estoque: '200' },
    { nIdProdutoMalha: 21, nQtde: 1 },
    { nIdProdutoMalha: 22, nQtde: 3, cUtilizarDoEstoque: 'N' },
  ])
  assert.deepEqual(r, [
    { n_cod_prod: 10, local: 100, quantidade: 2, origem: 'op_producao' },
    { n_cod_prod: 20, local: 200, quantidade: -0.5, origem: 'op_consumo' },
    { n_cod_prod: 21, local: 100, quantidade: -1, origem: 'op_consumo' },
    { n_cod_prod: 22, local: 100, quantidade: -3, origem: 'op_consumo' },
  ])
  assert.deepEqual(movimentosPrevistosDaOP({ ...OP, concluida: false, dt_conclusao_real: null }, []), [])
})

test('kardex × OP: documento primeiro, senão data+produto (provável)', () => {
  const k = (o: Partial<KardexMin>): KardexMin => ({
    n_cod_prod: 10, data_mov: '2026-10-10', cod_origem: 'OPE', des_origem: null, quantidade: 2,
    num_doc: null, num_pedido: null, id_cupom: null, id_ajuste: null, ...o,
  })
  const porDoc = casarKardexComOP([
    k({ num_doc: '42' }), k({ num_doc: '43' }),
    k({ n_cod_prod: 20, quantidade: -0.5, cod_origem: 'OPS', num_doc: '2026/00000042' }),
  ], OP, [10, 20])
  assert.equal(porDoc.criterio, 'documento')
  assert.equal(porDoc.linhas.length, 2)
  assert.ok(porDoc.linhas.every((l) => !l.provavel))
  const porData = casarKardexComOP([
    k({}), k({ data_mov: '2026-10-11', n_cod_prod: 20, cod_origem: 'OPS', quantidade: -1 }),
    k({ data_mov: '2026-10-15' }), k({ n_cod_prod: 99 }), k({ cod_origem: 'PDV' }),
  ], OP, [10, 20])
  assert.equal(porData.criterio, 'data')
  assert.equal(porData.linhas.length, 2)
  assert.ok(porData.linhas.every((l) => l.provavel))
  assert.equal(casarKardexComOP([], OP, [10]).criterio, 'nenhum')
})

test('totais: contagem e cancelado fora', () => {
  assert.deepEqual(
    totaisDe([{ quantidade: 5 }, { quantidade: -2 }, { quantidade: 9, contagem: true }, { quantidade: -4, cancelado: true }]),
    { entradas: 5, saidas: 2 },
  )
})
