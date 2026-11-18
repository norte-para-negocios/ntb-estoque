import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gravidadeDoTipo, ordenarFalhas, formatarListaFalhas, classificarAcao, formatarInventario, valoresInvalidos, ehPaginaNaoEncontrada, type Falha, type TelaInventario } from './relatorio.ts'

const f = (o: Partial<Falha>): Falha => ({
  tipo: 'erro-console', gravidade: 2, loja: 'Sertão', cargo: 'dono', tela: '/x', passo: 'abrir /x', esperado: 'e', mostrado: 'm', print: 'prints/x.png', ...o,
})

test('gravidade: conta errada > trava/erro > visual', () => {
  assert.equal(gravidadeDoTipo('valor-invalido'), 1)
  assert.equal(gravidadeDoTipo('saldo-divergente'), 1)
  assert.equal(gravidadeDoTipo('conta-divergente'), 1)
  for (const t of ['erro-http-pagina', 'erro-http-requisicao', 'tela-quebrada', 'erro-console', 'tela-vazia', 'timeout'] as const) assert.equal(gravidadeDoTipo(t), 2, t)
  for (const t of ['texto-cortado', 'estouro-horizontal'] as const) assert.equal(gravidadeDoTipo(t), 3, t)
})

test('ordena por gravidade, loja, cargo, tela, tipo, e é estável com entrada embaralhada', () => {
  const a = [f({ gravidade: 3, tela: '/a' }), f({ gravidade: 1, tela: '/z' }), f({ gravidade: 2, loja: 'ODARA', tela: '/b' }), f({ gravidade: 2, loja: 'Loja 19', tela: '/b' })]
  const o1 = ordenarFalhas(a).map((x) => `${x.gravidade}${x.loja}${x.tela}`)
  const o2 = ordenarFalhas([...a].reverse()).map((x) => `${x.gravidade}${x.loja}${x.tela}`)
  assert.deepEqual(o1, o2)
  assert.equal(o1[0], '1Sertão/z')
  assert.equal(o1[3], '3Sertão/a')
})

test('lista em markdown traz os campos combinados e conta por gravidade', () => {
  const md = formatarListaFalhas([f({ gravidade: 1, tipo: 'valor-invalido' }), f({}), f({ gravidade: 3, tipo: 'texto-cortado' })], { visitas: 10, telas: 5, logins: 2 })
  for (const campo of ['Gravidade', 'Loja', 'Tela', 'Passo', 'Esperado', 'Mostrado', 'Print']) assert.match(md, new RegExp(campo))
  assert.match(md, /conta errada: 1/)
  assert.match(md, /trava\/erro: 1/)
  assert.match(md, /visual: 1/)
  assert.match(md, /prints\/x\.png/)
})

test('lista vazia diz que não houve falha', () => {
  assert.match(formatarListaFalhas([], { visitas: 1, telas: 1, logins: 1 }), /nenhuma falha/i)
})

test('lista é igual para a mesma entrada (determinística, sem data)', () => {
  const a = [f({}), f({ tela: '/y' })]
  assert.equal(formatarListaFalhas(a, { visitas: 2, telas: 2, logins: 1 }), formatarListaFalhas([...a].reverse(), { visitas: 2, telas: 2, logins: 1 }))
})

test('classifica ação que grava só pelo texto, sem acionar nada', () => {
  for (const t of ['Salvar', 'Excluir produto', 'Novo produto', 'Criar OP', 'Enviar ao Omie', 'Aprovar', 'Confirmar', 'Gravar', 'Atualizar tudo', 'Sincronizar', 'Remover', 'Importar XML', 'Desfazer']) assert.equal(classificarAcao(t), 'grava', t)
  for (const t of ['Buscar', 'Filtros', 'Excel', 'Imprimir catálogo A4', 'Voltar', 'Ver detalhes', 'Cancelar']) assert.equal(classificarAcao(t), 'leitura', t)
})

test('detecta valor quebrado na tela', () => {
  assert.deepEqual(valoresInvalidos('Total R$ NaN e 3 itens'), ['NaN'])
  assert.deepEqual(valoresInvalidos('Valor undefined'), ['undefined'])
  assert.deepEqual(valoresInvalidos('Estoque: Infinity'), ['Infinity'])
  assert.deepEqual(valoresInvalidos('[object Object]'), ['[object Object]'])
  assert.deepEqual(valoresInvalidos('Banana, Nanquim, Indefinido pelo usuário'), [])
})

test('inventário junta a mesma tela de vários cargos', () => {
  const t: TelaInventario[] = [
    { tela: '/produto', loja: 'Sertão', cargo: 'dono', noMenu: true, resultado: 'abriu', titulo: 'Produtos', acoes: [{ texto: 'Novo produto', tipo: 'button' }, { texto: 'Buscar', tipo: 'button' }] },
    { tela: '/produto', loja: 'ODARA', cargo: 'estoquista', noMenu: false, resultado: 'redirecionou', titulo: '', acoes: [] },
  ]
  const md = formatarInventario(t)
  assert.match(md, /\/produto/)
  assert.match(md, /Novo produto/)
  assert.match(md, /grava/)
  assert.match(md, /dono/)
})

test('reconhece a página 404 que vem com HTTP 200', () => {
  assert.equal(ehPaginaNaoEncontrada('3\nBuscar\n/\n404\nThis page could not be found.'), true)
  assert.equal(ehPaginaNaoEncontrada('Produtos\nNovo produto\n404 itens'), false)
  assert.equal(ehPaginaNaoEncontrada(''), false)
})
