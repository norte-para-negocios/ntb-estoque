import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sugerirFlagsCusto, flagsParaTexto, flagsDeTexto, flagsParaOmie, sugerirCfopEntrada, formatarCfop, cfopValido,
  alertasDoItem, configInicialItem, podeLancarSozinho, decidirConferencia, avaliarItemCompra, validarConfigItem, previaCustoItem, grupoUnidade, fatorConhecido, UNIDADES_ESTOQUE,
} from './nf-item-regras.ts'

// Valores das capturas nf-* (~/Projects/omie-rea/telas/COM/etapas-pedidos-compra) e de D1/K1 (loja 5).
test('memória do produto vence a regra: BATATA FLORÃO (NF 947490 e 956433, SSSSSSSS) com CST 40', () => {
  const r = sugerirFlagsCusto({ memoriaProduto: 'SSSSSSSS', memoriaFornecedor: 'NSSNNNNN', crt: '3', cst: '40', csosn: null })
  assert.equal(flagsParaTexto(r.flags), 'SSSSSSSS'); assert.equal(r.origem, 'produto')
  assert.equal(sugerirFlagsCusto({ memoriaProduto: null, memoriaFornecedor: 'SSSNSSNN', crt: '3', cst: '40', csosn: null }).origem, 'fornecedor')
})
test('regra pela moda de D1', () => {
  const t = (cst: string | null, csosn: string | null, crt: string | null) => { const r = sugerirFlagsCusto({ memoriaProduto: null, memoriaFornecedor: null, crt, cst, csosn }); return [flagsParaTexto(r.flags), r.origem] }
  assert.deepEqual(t('60', null, '3'), ['NNNNNNNN', 'regra'])   // ÁGUA da CRBS, NF 131055
  assert.deepEqual(t('40', null, '3'), ['NSSNNNNN', 'regra'])   // ABOBRINHA, NF 956433
  assert.deepEqual(t(null, '102', '1'), ['SSSNSSNN', 'regra'])
  assert.deepEqual(t('20', null, '3'), ['SSSSSSSS', 'regra'])
  assert.deepEqual(t('51', null, '3'), ['NNNNNNNN', 'padrao'])  // sem caso em D1
  assert.deepEqual(t(null, null, null), ['NNNNNNNN', 'padrao'])
})
test('flagsDeTexto / flagsParaOmie', () => {
  assert.equal(flagsDeTexto('NNN-NN--')!.seguro, false); assert.equal(flagsDeTexto('xx'), null)
  assert.deepEqual(flagsParaOmie(flagsDeTexto('NSSNNNNN')!, 0, 0), { cICMSCusto: 'N', cICMSSTCusto: 'S', cIPICusto: 'S', cSeguroCusto: 'N', cPISCusto: 'N', cCOFINSCusto: 'N', cFreteCusto: 'N', cOutrosDespCusto: 'N', nAliqCredPISCusto: 0, nAliqCredCOFINSCusto: 0 })
})
test('CFOP de entrada: memória, tabela (moda D1), regra', () => {
  assert.deepEqual(sugerirCfopEntrada({ cfopNota: '5405', memoriaProduto: '1403' }), { cfop: '1403', origem: 'produto' }) // CRBS NF 131055
  assert.deepEqual(sugerirCfopEntrada({ cfopNota: '5405', memoriaProduto: null }), { cfop: '1407', origem: 'tabela' })
  assert.deepEqual(sugerirCfopEntrada({ cfopNota: '5102', memoriaProduto: null }), { cfop: '1102', origem: 'tabela' })
  assert.deepEqual(sugerirCfopEntrada({ cfopNota: '6102', memoriaProduto: null }), { cfop: '2102', origem: 'regra' })
  assert.equal(formatarCfop('1403'), '1.403'); assert.equal(cfopValido('5102'), false); assert.equal(cfopValido('1910'), true)
})
test('unidades: grupo ignora dígitos do Omie (UND8, KG9, GFA8) e fatores conhecidos', () => {
  assert.equal(grupoUnidade('UND8'), 'contagem'); assert.equal(grupoUnidade('KG9'), 'massa'); assert.equal(grupoUnidade('GFA8'), 'contagem')
  assert.equal(grupoUnidade('ml'), 'volume'); assert.equal(grupoUnidade('CX'), 'embalagem'); assert.equal(grupoUnidade('XPTO'), null)
  assert.equal(fatorConhecido('KG', 'G'), 1000); assert.equal(fatorConhecido('L', 'ML'), 1000); assert.equal(fatorConhecido('DZ', 'UN'), 12)
  assert.equal(fatorConhecido('UND8', 'UN'), 1); assert.equal(fatorConhecido('CX', 'UN'), null)
  assert.ok(UNIDADES_ESTOQUE.some((u) => u.sigla === 'GF' && u.nome === 'Garrafa'))
})
test('fator suspeito e custo fora: TEQUILA PRATA da NF 189215 (1 UND8 → 1 ML a R$ 139,90)', () => {
  const prata = alertasDoItem({ unidadeNota: 'UND8', unidadeEstoque: 'ML', fator: 1, quantidadeNota: 1, quantidadeRecebida: 1, custoUnitario: 139.9, cmcAtual: 0.186533, valorTotalItem: 139.9, finalidade: '1' })
  assert.deepEqual(prata.map((a) => a.tipo), ['fator_suspeito', 'custo_fora'])
  assert.ok(prata[1].texto.includes('custo por ML 750× o custo médio'), prata[1].texto)
  const ouro = alertasDoItem({ unidadeNota: 'UND8', unidadeEstoque: 'ML', fator: 750, quantidadeNota: 1, quantidadeRecebida: 750, custoUnitario: 0.186533, cmcAtual: 0.186533, valorTotalItem: 139.9, finalidade: '1' })
  assert.deepEqual(ouro, [])
  assert.equal(alertasDoItem({ unidadeNota: 'KG', unidadeEstoque: 'G', fator: 1, quantidadeNota: 2, quantidadeRecebida: 2, custoUnitario: 4, cmcAtual: null, valorTotalItem: 8, finalidade: '1' })[0].tipo, 'fator_suspeito')
  assert.deepEqual(alertasDoItem({ unidadeNota: 'CX', unidadeEstoque: 'UN', fator: 12, quantidadeNota: 10, quantidadeRecebida: 120, custoUnitario: 1.358333, cmcAtual: 1.35, valorTotalItem: 176.41, finalidade: '1' }), [])
})
test('entrega parcial: PEIXE 40,9 KG → 37,888369 KG (NF 4010)', () => {
  const a = alertasDoItem({ unidadeNota: 'KG', unidadeEstoque: 'KG', fator: 1, quantidadeNota: 40.9, quantidadeRecebida: 37.888369, custoUnitario: 80.853573, cmcAtual: 76, valorTotalItem: 3063.41, finalidade: '1' })
  assert.deepEqual(a.map((x) => x.tipo), ['recebido_menor'])
})
test('NF complementar e item de valor zero nascem sem movimentar estoque (NF 7433: 1 UN, R$ 0,00, ICMS 305,23)', () => {
  const c = configInicialItem({ item: { cfop: '5101', valorTotalItem: 0, fiscal: { cst: null, csosn: '900' } }, crt: '1', finalidade: '2', memoriaProduto: null, memoriaFornecedor: null, unidadeProduto: 'UN', localNota: 10 })
  assert.equal(c.movimentaEstoque, false); assert.equal(c.geraContaPagar, true); assert.equal(c.cfopEntrada, '1102')
  assert.equal(configInicialItem({ item: { cfop: '5405', valorTotalItem: 77.27, fiscal: { cst: '60', csosn: null } }, crt: '3', finalidade: '1', memoriaProduto: null, memoriaFornecedor: null, unidadeProduto: 'UN', localNota: 10 }).movimentaEstoque, true)
  assert.deepEqual(alertasDoItem({ unidadeNota: 'UN', unidadeEstoque: 'UN', fator: 1, quantidadeNota: 1, quantidadeRecebida: 1, custoUnitario: 0, cmcAtual: null, valorTotalItem: 0, finalidade: '2' }).map((a) => a.tipo), ['valor_zero', 'complementar'])
})
test('configInicialItem usa o local da memória do produto (bar × cozinha) e cai no da nota', () => {
  const m = { flags: 'NSSNNNNN', cfopEntrada: '1102', codigoLocal: 2746972605 }
  assert.equal(configInicialItem({ item: { cfop: '5102', valorTotalItem: 33, fiscal: { cst: '00', csosn: null } }, crt: '3', finalidade: '1', memoriaProduto: m, memoriaFornecedor: null, unidadeProduto: 'KG', localNota: 2746972551 }).codigoLocal, 2746972605)
  assert.equal(configInicialItem({ item: { cfop: '5102', valorTotalItem: 33, fiscal: { cst: '00', csosn: null } }, crt: '3', finalidade: '1', memoriaProduto: null, memoriaFornecedor: null, unidadeProduto: 'KG', localNota: 2746972551 }).codigoLocal, 2746972551)
})
test('validarConfigItem', () => {
  assert.equal(validarConfigItem({ cfopEntrada: '1403', quantidadeRecebida: 120, aliqCredPis: 1.65 }), null)
  assert.ok(validarConfigItem({ cfopEntrada: '5102' })); assert.ok(validarConfigItem({ quantidadeRecebida: 0 })); assert.ok(validarConfigItem({ aliqCredCofins: 101 }))
})
test('previaCustoItem bate com o kardex do Omie (NF 131055, Long Corona: 96 × 6,589583)', () => {
  const p = previaCustoItem({ quantidadeNota: 4, precoUnit: 158.149101, valorTotalItem: 706.35, desconto: 0, ipi: 20.04, st: 0, icms: 0, frete: 0, seguro: 0, freteCte: 0, flags: flagsDeTexto('NNNNNNNN')!, aliqCredPis: 0, aliqCredCofins: 0, quantidadeRecebida: 96 })
  assert.deepEqual(p, { valorEstoque: 632.6, custoUnitario: 6.589583 })
})

test('podeLancarSozinho: padrão ou alerta de item segura a nota', () => {
  const b = { casamentosSeguros: true, alertasNota: 0, origensFlags: ['produto', 'regra'] as const, alertasItens: [], autoLancar: true }
  assert.equal(podeLancarSozinho({ ...b, origensFlags: [...b.origensFlags] }), true)
  assert.equal(podeLancarSozinho({ ...b, origensFlags: ['padrao'] }), false)
  assert.equal(podeLancarSozinho({ ...b, origensFlags: ['regra'], alertasItens: [{ tipo: 'fator_suspeito', texto: 'x' }] }), false)
  assert.equal(podeLancarSozinho({ ...b, origensFlags: ['regra'], autoLancar: false }), false)
  assert.equal(podeLancarSozinho({ ...b, origensFlags: ['regra'], casamentosSeguros: false }), false)
  assert.equal(podeLancarSozinho({ ...b, origensFlags: ['regra'], alertasNota: 1 }), false)
})

test('marcarConferidaNF recusa sem "Conferi os avisos" (TEQUILA PRATA) e aceita com', () => {
  const a = [{ linha: 5, alertas: [{ tipo: 'fator_suspeito' as const, texto: 'x' }, { tipo: 'custo_fora' as const, texto: 'y' }] }, { linha: 1, alertas: [{ tipo: 'recebido_menor' as const, texto: 'z' }] }]
  assert.deepEqual(decidirConferencia(a, false), { error: 'Há avisos de custo ou quantidade: confira e marque "Conferi os avisos".' })
  assert.deepEqual(decidirConferencia(a, true), { ok: true, aceitos: [{ linha: 5, tipo: 'fator_suspeito' }, { linha: 5, tipo: 'custo_fora' }] })
  assert.deepEqual(decidirConferencia([a[1]], false), { ok: true, aceitos: [] })
})

test('avaliarItemCompra: prévia e avisos do item gravado (tela e servidor usam a mesma conta)', () => {
  const base = { quantidade: 4, valor_unitario: 158.149101, valor_total_item: 706.35, desconto: 0, ipi_valor: 20.04, st_valor: 0, fcp_st_valor: 0, icms_valor: 0,
    frete_valor: 0, seguro_valor: 0, outras_valor: 53.71, frete_cte: 0, flags: 'NNNNNNNN', aliq_cred_pis: 0, aliq_cred_cofins: 0, quantidade_recebida: null,
    fator: 24, unidade_compra: 'CX', unidade_estoque: 'UN', codigo_produto: 1002, movimenta_estoque: true }
  assert.deepEqual(avaliarItemCompra(base, { cmc: 6.5, finalidade: '1' }), { quantidadeRecebida: 96, previa: { valorEstoque: 632.6, custoUnitario: 6.589583 }, alertas: [] })
  const prata = avaliarItemCompra({ ...base, quantidade: 1, valor_unitario: 139.9, valor_total_item: 139.9, ipi_valor: 0, outras_valor: 0, fator: 1, unidade_compra: 'UND8', unidade_estoque: 'ML' }, { cmc: 0.186533, finalidade: '1' })
  assert.deepEqual(prata.alertas.map((a) => a.tipo), ['fator_suspeito', 'custo_fora'])
  assert.equal(avaliarItemCompra({ ...base, valor_total_item: null }, { cmc: null, finalidade: '1' }).previa, null) // compra antiga: sem prévia N3
  assert.deepEqual(avaliarItemCompra({ ...base, codigo_produto: null }, { cmc: null, finalidade: '1' }).alertas, [])
})

// Revisão final (achado 3): o lançamento (SQL 185, item_compra_full_object) usa o crédito do Simples (vCredICMSSN) como o
// "ICMS" do custo quando o item é CSOSN 101/201 sem ICMS próprio. A prévia (única entrada TS de custo: tela, upload,
// SEFAZ) precisa fazer o mesmo, senão a prévia ≠ o que entra (R15). Mesmo caso no SQL: 185, bloco M.
test('HIPÓTESE CSOSN 101: prévia tira o crédito do Simples como ICMS, igual ao lançamento (água da NF 131055 com vCredICMSSN 4,08)', () => {
  const agua = { quantidadeNota: 10, precoUnit: 16.299516, valorTotalItem: 176.41, desconto: 0, ipi: 0, st: 0, icms: 0, frete: 0, seguro: 0, freteCte: 0,
    flags: flagsDeTexto('NNNNNNNN')!, aliqCredPis: 0, aliqCredCofins: 0, quantidadeRecebida: 120, csosn: '101', credIcmsSn: 4.08 }
  assert.deepEqual(previaCustoItem(agua), { valorEstoque: 158.92, custoUnitario: 1.324333 })
  assert.deepEqual(previaCustoItem({ ...agua, csosn: '201' }), { valorEstoque: 158.92, custoUnitario: 1.324333 })
  // ICMS é custo (S): o crédito fica no custo
  assert.equal(previaCustoItem({ ...agua, flags: flagsDeTexto('SNNNNNNN')! }).valorEstoque, 163)
  // CSOSN 102 (sem crédito) e item com ICMS próprio: crédito ignorado
  assert.equal(previaCustoItem({ ...agua, csosn: '102' }).valorEstoque, 163)
  assert.equal(previaCustoItem({ ...agua, icms: 2 }).valorEstoque, 161)
  // item gravado (tela da nota e servidor): o fiscal jsonb traz csosn e credIcmsSn
  const g = { quantidade: 10, valor_unitario: 16.299516, valor_total_item: 176.41, desconto: 0, ipi_valor: 0, st_valor: 0, fcp_st_valor: 0, icms_valor: 0,
    frete_valor: 0, seguro_valor: 0, outras_valor: 13.41, frete_cte: 0, flags: 'NNNNNNNN', aliq_cred_pis: 0, aliq_cred_cofins: 0, quantidade_recebida: null,
    fator: 12, unidade_compra: 'CX', unidade_estoque: 'UN', codigo_produto: 1001, movimenta_estoque: true, csosn: '101', cred_icms_sn: 4.08 }
  assert.deepEqual(avaliarItemCompra(g, { cmc: 1.3, finalidade: '1' }).previa, { valorEstoque: 158.92, custoUnitario: 1.324333 })
})

test('item religado a outro produto: o aviso de fator usa a unidade do produto novo (TEQUILA PRATA: UN → ML)', () => {
  const g = { quantidade: 1, valor_unitario: 139.9, valor_total_item: 139.9, desconto: 0, ipi_valor: 0, st_valor: 0, fcp_st_valor: 0, icms_valor: 0,
    frete_valor: 0, seguro_valor: 0, outras_valor: 0, frete_cte: 0, flags: 'NNNNNNNN', aliq_cred_pis: 0, aliq_cred_cofins: 0, quantidade_recebida: null,
    fator: 1, unidade_compra: 'UND8', unidade_estoque: 'ML', codigo_produto: 3002, movimenta_estoque: true }
  // 1 UND8 = 1 ML: suspeito (a 185 grava a unidade do produto novo ao religar; antes ficava UN e o aviso sumia)
  assert.deepEqual(avaliarItemCompra(g, { cmc: null, finalidade: '1' }).alertas.map((a) => a.tipo), ['fator_suspeito'])
  assert.deepEqual(avaliarItemCompra({ ...g, fator: 750 }, { cmc: null, finalidade: '1' }).alertas, [])
})
