import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerCelulaNumero, lerCelulaData, mapearCabecalho, validarImportacao, pedidosParaSql, COLUNAS_MODELO } from './importar-pedidos-puro.ts'
import { parcelasDoTexto } from './pedido-puro.ts'

test('lerCelulaNumero: formatos do Brasil e do Excel', () => {
  assert.deepEqual(lerCelulaNumero(4.5), { ok: true, valor: 4.5 })
  assert.deepEqual(lerCelulaNumero('4,5'), { ok: true, valor: 4.5 })
  assert.deepEqual(lerCelulaNumero('1.234,56'), { ok: true, valor: 1234.56 })
  assert.deepEqual(lerCelulaNumero('4.5'), { ok: true, valor: 4.5 })
  assert.deepEqual(lerCelulaNumero('1.500'), { ok: true, valor: 1500 })
  assert.deepEqual(lerCelulaNumero('R$ 12,90'), { ok: true, valor: 12.9 })
  assert.deepEqual(lerCelulaNumero(''), { ok: true, valor: null })
  assert.deepEqual(lerCelulaNumero(null), { ok: true, valor: null })
  assert.deepEqual(lerCelulaNumero('abc'), { ok: false })
  assert.deepEqual(lerCelulaNumero('1,2,3'), { ok: false })
})

test('lerCelulaData: dd/mm/aaaa, ISO, Date e número de série do Excel', () => {
  assert.deepEqual(lerCelulaData('25/10/2026'), { ok: true, valor: '2026-10-25' })
  assert.deepEqual(lerCelulaData('5/1/26'), { ok: true, valor: '2026-01-05' })
  assert.deepEqual(lerCelulaData('2026-10-25'), { ok: true, valor: '2026-10-25' })
  assert.deepEqual(lerCelulaData(new Date(Date.UTC(2026, 9, 25))), { ok: true, valor: '2026-10-25' })
  assert.deepEqual(lerCelulaData(46320), { ok: true, valor: '2026-10-25' })
  assert.deepEqual(lerCelulaData(''), { ok: true, valor: null })
  assert.deepEqual(lerCelulaData('31/02/2026'), { ok: false })
  assert.deepEqual(lerCelulaData('amanhã'), { ok: false })
})

test('mapearCabecalho aceita o modelo e apelidos, sem acento e sem caixa', () => {
  const m = mapearCabecalho(COLUNAS_MODELO.map((c) => c.titulo))
  assert.ok(!('erro' in m))
  if (!('erro' in m)) { assert.equal(m.produto, 4); assert.equal(m.quantidade, 5) }
  const m2 = mapearCabecalho(['CODIGO', 'QTD', 'Preço', 'cnpj'])
  assert.ok(!('erro' in m2))
  if (!('erro' in m2)) { assert.equal(m2.produto, 0); assert.equal(m2.quantidade, 1); assert.equal(m2.preco, 2); assert.equal(m2.fornecedorCnpj, 3) }
  assert.ok('erro' in mapearCabecalho(['Fornecedor', 'Preço']))
})

const cad = {
  produtos: [
    { codigoProduto: 501, codigo: 'P501', descricao: 'TOMATE', unidade: 'KG' },
    { codigoProduto: 502, codigo: '00123', descricao: 'CERVEJA', unidade: 'UN' },
    { codigoProduto: 503, codigo: 'DUP', descricao: 'A', unidade: 'UN' },
    { codigoProduto: 504, codigo: 'DUP', descricao: 'B', unidade: 'UN' },
  ],
  fornecedores: [{ id: 9, nome: 'HORTI LTDA', cnpj: '11222333000181' }],
  locais: [1, 2],
  lerParcelas: parcelasDoTexto,
}
const CAB = ['Pedido', 'CNPJ do fornecedor', 'Fornecedor', 'Previsão de entrega', 'Código do produto', 'Quantidade', 'Preço unitário', 'Unidade', 'Fator', 'Código do local', 'Nº do pedido no fornecedor', 'Parcelas', 'Frete', 'Observação']

test('validarImportacao: agrupa, resolve cadastro e valida linha a linha', () => {
  const r = validarImportacao([
    ['Modelo de importação'],
    CAB,
    ['A', '11.222.333/0001-81', '', '25/10/2026', 'P501', '10', '4,50', '', '', '1', 'X-1', '30/60', '15', ''],
    ['A', '', '', '', 123, 2, 30, 'CX', 12, '', '', '', '', 'gelada'],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    ['', '', 'Feira', '', 'P501', '3', '', '', '', '', '', '', '', ''],
    ['', '', 'feira', '', 'P501', '1', '', '', '', '', '', '', '', ''],
  ], cad)
  assert.equal(r.erros, 0, JSON.stringify(r.linhas.filter((l) => l.erros.length)))
  assert.equal(r.pedidos.length, 2)
  const a = r.pedidos[0]
  assert.equal(a.fornecedorId, 9)
  assert.equal(a.fornecedorNome, 'HORTI LTDA')
  assert.equal(a.previsao, '2026-10-25')
  assert.equal(a.frete, 15)
  assert.deepEqual(a.parcelas.map((p) => p.dias), [30, 60])
  assert.equal(a.itens.length, 2)
  assert.equal(a.itens[1].codigoProduto, 502)        // código "00123" lido como número 123 pelo Excel
  assert.equal(a.itens[1].fator, 12)
  assert.equal(a.itens[1].obs, 'gelada')
  assert.equal(a.itens[0].codigoLocal, 1)
  assert.deepEqual(a.linhas, [3, 4])
  assert.equal(r.pedidos[1].fornecedorId, null)
  assert.equal(r.pedidos[1].itens.length, 2)          // "Feira" e "feira" = o mesmo fornecedor
  const sql = pedidosParaSql(r.pedidos)
  assert.equal(sql[0].fornecedor_id, 9)
  assert.equal(sql[0].itens[0].preco_unitario, 4.5)
  assert.equal(sql[0].numero_fornecedor, 'X-1')
})

test('validarImportacao: erros por linha', () => {
  const r = validarImportacao([
    CAB,
    ['', '', 'F', '', 'NAOEXISTE', '1', '', '', '', '', '', '', '', ''],
    ['', '', 'F', '', 'DUP', '1', '', '', '', '', '', '', '', ''],
    ['', '', 'F', '', 'P501', '0', '', '', '', '', '', '', '', ''],
    ['', '', 'F', '', 'P501', '1', '-2', '', '', '', '', '', '', ''],
    ['', '', 'F', '', 'P501', '1', '', '', '', '9', '', '', '', ''],
    ['', '', '', '', 'P501', '1', '', '', '', '', '', '', '', ''],
    ['', '123', '', '', 'P501', '1', '', '', '', '', '', '', '', ''],
    ['', '', 'F', '31/02/2026', 'P501', '1', '', '', '', '', '', '', '', ''],
    ['', '', 'F', '', 'P501', '1', '', '', '', '', '', 'trinta', '', ''],
    ['B', '', 'F', '', 'P501', '1', '', '', '', '', '', '', '', ''],
    ['B', '', 'G', '', 'P501', '1', '', '', '', '', '', '', '', ''],
  ], cad)
  const errosDa = (linha: number) => r.linhas.find((l) => l.linha === linha)?.erros.join(' | ') ?? ''
  assert.match(errosDa(2), /não existe/)
  assert.match(errosDa(3), /2 produtos/)
  assert.match(errosDa(4), /Quantidade/)
  assert.match(errosDa(5), /Preço/)
  assert.match(errosDa(6), /Local/)
  assert.match(errosDa(7), /fornecedor/i)
  assert.match(errosDa(8), /CNPJ/)
  assert.match(errosDa(9), /Previsão/)
  assert.match(errosDa(10), /Parcelas/)
  assert.equal(errosDa(11), '')
  assert.match(errosDa(12), /diferente/)              // mesmo "Pedido" com outro fornecedor
  assert.equal(r.erros, 10)
})

test('validarImportacao: sem cabeçalho ou planilha vazia', () => {
  assert.match(validarImportacao([['a', 'b']], cad).erroGeral ?? '', /cabeçalho/)
  assert.match(validarImportacao([CAB], cad).erroGeral ?? '', /nenhuma linha/i)
})
