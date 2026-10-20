import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lerFiltrosMovimentacoes, origemDoKardex, hrefDocumento, numerosCandidatos, interpretarBuscaOP,
  movimentosPrevistosDaOP, casarKardexComOP, totaisDe, clausulasBuscaOP, escolherFonte, faltaHojeNoKardex, avisoFaltaHoje, type OPMin, type KardexMin,
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
  const lixo = lerFiltrosMovimentacoes({ data_inicio: 'xx', page: '-3', local: '12a', cod: '55' }, HOJE, false)
  assert.equal(lixo.page, 1)
  assert.equal(lixo.local, null)
  assert.equal(lixo.produto, 55)
  // links antigos de outras telas mandam ?produto=<nome ou código> (texto): vira a busca
  const antigo = lerFiltrosMovimentacoes({ produto: 'LEITE DE COCO' }, HOJE, true)
  assert.equal(antigo.q, 'LEITE DE COCO')
  assert.equal(antigo.produto, null)
  assert.equal(lerFiltrosMovimentacoes({ produto: 'x', q: 'y' }, HOJE, true).q, 'y')
  // família conta como filtro de produto (teto de 366 dias também na reconstrução)
  const fam = lerFiltrosMovimentacoes({ data_inicio: '2025-01-01', familia: ' BEBIDAS ' }, HOJE, true)
  assert.equal(fam.familia, 'BEBIDAS')
  assert.equal(fam.ini, '2025-10-13')
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
  const esp = [
    { n_cod_prod: 10, local: 100, quantidade: 2, origem: 'op_producao' as const },
    { n_cod_prod: 20, local: 100, quantidade: -1, origem: 'op_consumo' as const },
  ]
  const porDoc = casarKardexComOP([
    k({ num_doc: '42' }), k({ num_doc: '43' }),
    k({ n_cod_prod: 20, quantidade: -0.5, cod_origem: 'OPS', num_doc: '2026/00000042' }),
  ], OP, esp)
  assert.equal(porDoc.criterio, 'documento')
  assert.equal(porDoc.linhas.length, 2)
  assert.ok(porDoc.linhas.every((l) => !l.provavel))
  const porData = casarKardexComOP([
    k({}), k({ data_mov: '2026-10-11', n_cod_prod: 20, cod_origem: 'OPS', quantidade: -1 }),
    k({ data_mov: '2026-10-15' }), k({ n_cod_prod: 99 }), k({ cod_origem: 'PDV' }),
  ], OP, esp)
  assert.equal(porData.criterio, 'data')
  assert.equal(porData.linhas.length, 2)
  assert.ok(porData.linhas.every((l) => l.provavel))
  assert.equal(casarKardexComOP([], OP, esp).criterio, 'nenhum')
})

test('totais: contagem e cancelado fora', () => {
  assert.deepEqual(
    totaisDe([{ quantidade: 5 }, { quantidade: -2 }, { quantidade: 9, contagem: true }, { quantidade: -4, cancelado: true }]),
    { entradas: 5, saidas: 2 },
  )
})

test('cláusulas da busca de OP (texto já escapado)', () => {
  assert.deepEqual(clausulasBuscaOP({ texto: '396850', numero: '396850', data: null }, []), [
    'identificacao_c_num_op.ilike.%396850%', 'identificacao_n_cod_op.eq.396850', 'observacao.ilike.%396850%', 'obs_omie.ilike.%396850%',
  ])
  assert.deepEqual(clausulasBuscaOP({ texto: 'cupom 55', numero: null, data: null }, [11, 12]), [
    'identificacao_c_num_op.ilike.%cupom 55%', 'observacao.ilike.%cupom 55%', 'obs_omie.ilike.%cupom 55%', 'identificacao_n_cod_produto.in.(11,12)',
  ])
  assert.deepEqual(clausulasBuscaOP({ texto: '', numero: null, data: '2026-10-13' }, []), [])
  // código do Omie só quando cabe num bigint
  assert.ok(!clausulasBuscaOP({ texto: '2026/0001', numero: '2026/0001', data: null }, []).some((c) => c.startsWith('identificacao_n_cod_op')))
})

test('fonte: kardex só quando o histórico completo cobre o início do período', () => {
  assert.equal(escolherFonte({ espelho: false, desde: '2026-07-01', ini: '2026-10-01' }), 'reconstruido')
  assert.equal(escolherFonte({ espelho: true, desde: null, ini: '2026-10-01' }), 'reconstruido')
  assert.equal(escolherFonte({ espelho: true, desde: '2026-10-05', ini: '2026-10-01' }), 'reconstruido')
  assert.equal(escolherFonte({ espelho: true, desde: '2026-10-01', ini: '2026-10-01' }), 'kardex')
  // D5: kardex parado (guarda) antes do fim do período → reconstruído
  assert.equal(escolherFonte({ espelho: true, desde: '2026-09-01', ini: '2026-10-01', ate: '2026-10-18', fim: '2026-10-20' }), 'reconstruido')
  assert.equal(escolherFonte({ espelho: true, desde: '2026-09-01', ini: '2026-10-01', ate: null, fim: '2026-10-20' }), 'reconstruido')
  assert.equal(escolherFonte({ espelho: true, desde: '2026-09-01', ini: '2026-10-01', ate: '2026-10-20', fim: '2026-10-20' }), 'kardex')
  // M4: madrugada (kardex até ontem, período até hoje) segue no kardex; ontem − 1 já não
  assert.equal(escolherFonte({ espelho: true, desde: '2026-09-01', ini: '2026-10-01', ate: '2026-10-19', fim: '2026-10-20', hoje: '2026-10-20' }), 'kardex')
  assert.equal(escolherFonte({ espelho: true, desde: '2026-09-01', ini: '2026-10-01', ate: '2026-10-18', fim: '2026-10-20', hoje: '2026-10-20' }), 'reconstruido')
  assert.equal(faltaHojeNoKardex({ ate: '2026-10-19', fim: '2026-10-20', hoje: '2026-10-20' }), true)
  assert.equal(faltaHojeNoKardex({ ate: '2026-10-20', fim: '2026-10-20', hoje: '2026-10-20' }), false)
  assert.match(avisoFaltaHoje(6), /começa às 07:00/)
  assert.doesNotMatch(avisoFaltaHoje(7), /07:00/)
  assert.match(avisoFaltaHoje(15), /atrasada ou pausada/)
})

test('kardex × OP por data: um movimento por esperado (quantidade igual, dia da conclusão primeiro), sem outras OPs', () => {
  const k = (o: Partial<KardexMin>): KardexMin => ({
    n_cod_prod: 10, data_mov: '2026-10-10', cod_origem: 'OPE', des_origem: null, quantidade: 2,
    num_doc: null, num_pedido: null, id_cupom: null, id_ajuste: null, ...o,
  })
  const esperados = [
    { n_cod_prod: 10, local: 100, quantidade: 2, origem: 'op_producao' as const },
    { n_cod_prod: 20, local: 100, quantidade: -0.5, origem: 'op_consumo' as const },
  ]
  const linhas = [
    k({ quantidade: 5 }), // outra OP do mesmo prato (quantidade diferente)
    k({ data_mov: '2026-10-11' }), // mesma quantidade, dia seguinte
    k({}), // mesma quantidade, dia da conclusão: a escolhida
    k({ n_cod_prod: 20, cod_origem: 'OPS', quantidade: -0.5 }),
    k({ n_cod_prod: 20, cod_origem: 'OPS', quantidade: -0.7 }),
    k({ n_cod_prod: 20, cod_origem: 'OPS', quantidade: -0.5, data_mov: '2026-10-09' }),
  ]
  const r = casarKardexComOP(linhas, OP, esperados)
  assert.equal(r.criterio, 'data')
  assert.equal(r.linhas.length, 2)
  assert.deepEqual(r.linhas.map((l) => [l.n_cod_prod, l.quantidade, l.data_mov]), [[10, 2, '2026-10-10'], [20, -0.5, '2026-10-10']])
  assert.ok(r.linhas.every((l) => l.provavel))
  assert.equal(r.empates, 0)
})
