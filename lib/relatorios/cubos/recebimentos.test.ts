import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CAMPOS_RECEBIMENTOS, linhaRecebimentos } from './recebimentos.ts'

// Linha real da ODARA (loja 15, estoque próprio), de produção em 26/10/2026.
const odara = {
  c_numero_nfe: '104', c_serie_nfe: '1', c_chave_nfe: '29261025190228000112550010000001041000000011', c_etapa: '60', d_emissao_nfe: '2026-10-26',
  c_razao_social: 'FORNECEDOR TESTE LTDA', c_nome: null, c_cnpj_cpf: '25190228000112', origem: 'sefaz', categoria: 'Compras de Mercadorias para Revenda',
  c_ncm: '62032300', c_cfop: '5101', n_qtde_nfe: 1, c_unidade_nfe: 'ME', n_preco_unit: 139, v_desconto: 6.95, v_total_item: 132.05, n_sequencia: 4,
  c_codigo_produto: '2017096728846', c_descricao_produto: 'CONJUNTO ASG',
  nota_full: { infoCadastro: { cCancelada: 'N', cRecebido: 'S', dRec: '26/10/2026' }, infoAdicionais: { dRegistro: '26/10/2026' }, parcelas: { parcelasLista: [] }, transporte: { cTipoFrete: '0' } },
  item_full: { itensAjustes: { cCFOPEntrada: '1.556' }, itensCustoEstoque: { cICMSCusto: 'S', cFreteCusto: 'N' }, itensICMS: { nValor: 0 }, sefaz: { vFrete: 0, vSeg: 0, vOutro: 0 } },
}

test('ODARA: valores do item e CFOP de entrada', () => {
  const l = linhaRecebimentos(odara)
  assert.equal(l['Total de Mercadoria'], 139)
  assert.equal(l['Desconto'], 6.95)
  assert.equal(l['Total do Documento Fiscal'], 132.05)
  assert.equal(l['CFOP de Entrada'], '1.556')
  assert.equal(l['Situação'], 'Concluída')
  assert.equal(l['Nota Fiscal'], '104')
})

test('datas viram aaaa-mm-dd e geram ano e mês', () => {
  const l = linhaRecebimentos(odara)
  assert.equal(l['Data de Registro (completa)'], '2026-10-26')
  assert.equal(l['Data de Registro.Mês'], '2026-10')
  assert.equal(l['Data de Registro.Ano'], '2026')
})

test('flags de custo viram Sim/Não e ausente vira null', () => {
  const l = linhaRecebimentos(odara)
  assert.equal(l['Custo de Estoque - ICMS é Custo'], 'Sim')
  assert.equal(l['Custo de Estoque - Frete é Custo'], 'Não')
  assert.equal(l['Custo de Estoque - IPI é Custo'], null)
})

test('fornecedor: nome fantasia cai na razão social quando falta', () => {
  assert.equal(linhaRecebimentos(odara)['Fornecedor/Cliente (Nome Fantasia)'], 'FORNECEDOR TESTE LTDA')
})

test('nota cancelada aparece como Cancelada, com data de cancelamento', () => {
  const l = linhaRecebimentos({ ...odara, nota_full: { ...odara.nota_full, infoCadastro: { cCancelada: 'S' } } })
  assert.equal(l['Situação'], 'Cancelada')
  assert.equal(l['Data do Cancelamento (completa)'], '2026-10-26')
})

test('linha vazia nao quebra e todo campo do cubo existe', () => {
  const l = linhaRecebimentos({})
  for (const campo of CAMPOS_RECEBIMENTOS) assert.ok(campo.id in l, `falta ${campo.id}`)
  assert.equal(l['Total de Mercadoria'], null)
})

test('todo campo devolvido pela linha esta declarado no cubo (sem campo fantasma)', () => {
  const declarados = new Set(CAMPOS_RECEBIMENTOS.map((x) => x.id))
  for (const k of Object.keys(linhaRecebimentos(odara))) assert.ok(declarados.has(k), `campo fantasma ${k}`)
})

// Casos no molde dos itens da Donana (loja 5) conferidos contra o relatório do Omie: nota 197852 (sem imposto, 593,92) e 139407 (com IPI, 4.062,48).
test('sem IPI/ST: Total de Mercadoria = total do item + desconto (cravado com o Omie)', () => {
  const l = linhaRecebimentos({ n_qtde_nfe: 3, n_preco_unit: 1.65, item_full: { itensCabec: { nPrecoUnit: 1.6534, vTotalItem: 4.95, vDesconto: 0 } } })
  assert.equal(l['Total de Mercadoria'], 4.95) // 3 x 1,6534 = 4,96: o Omie mostra 4,95
})

test('com IPI: o total do item traz imposto, entao vale quantidade x preco preciso', () => {
  const l = linhaRecebimentos({ n_qtde_nfe: 5, n_preco_unit: 123.26, item_full: { itensCabec: { nPrecoUnit: 123.256132, vTotalItem: 688.13, vDesconto: 0 }, itensIPI: { nValIPI: 19.52 } } })
  assert.equal(l['Total de Mercadoria'], 616.28)
  assert.equal(l['Total do Documento Fiscal'], 688.13)
  assert.equal(l['Valor do IPI'], 19.52)
})
