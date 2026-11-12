import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  acaoDaFerramenta, acaoDaPergunta, assuntoDa, blocosDe, buscar, distancia, interpretarPergunta, linkPermitido, notaBusca,
  sistemaDaLoja, textoAcima, textoSimular, textoSugerir, trechosDe, validarEntrada, validarHistorico, LIMITES,
} from './pacioli-puro.ts'

const pratos = [
  { codigo: 1, nome: 'Moqueca de Peixe 2 pessoas' },
  { codigo: 2, nome: 'Farofa da moqueca' },
  { codigo: 3, nome: 'Moqueca Mista de Camarão e Peixe' },
  { codigo: 4, nome: 'Camarão ao alho e óleo' },
  { codigo: 5, nome: 'Bobó de camarão' },
]

test('busca ignora acento, caixa e um erro de digitação', () => {
  assert.equal(buscar(pratos, 'bobo')[0].codigo, 5)
  assert.equal(buscar(pratos, 'CAMARAO alho')[0].codigo, 4)
  assert.equal(buscar(pratos, 'moqeca peixe')[0].codigo, 1)
  assert.deepEqual(buscar(pratos, 'pizza'), [])
})

test('busca: toda palavra precisa casar e o nome que começa pela consulta vem antes', () => {
  const r = buscar(pratos, 'moqueca')
  assert.ok(r.length >= 3)
  assert.notEqual(r[0].codigo, 2)
  assert.equal(notaBusca('moqueca frango', 'Moqueca de Peixe'), 0)
})

test('busca por código exato', () => assert.equal(notaBusca('12345', 'Qualquer', '12345'), 1))

test('distância de edição limitada', () => {
  assert.equal(distancia('moqeca', 'moqueca'), 1)
  assert.ok(distancia('abc', 'xyzxyz', 2) > 2)
})

test('as sugestões da tela viram ferramentas no modo rápido', () => {
  assert.deepEqual(interpretarPergunta('Quais pratos estão acima da meta?'), { ferramenta: 'pratos_acima_da_meta' })
  assert.deepEqual(interpretarPergunta('Quanto devo cobrar no delivery pela moqueca?'), { ferramenta: 'sugerir_preco', prato: 'moqueca', canal: 'delivery' })
  assert.deepEqual(interpretarPergunta('Se o camarão subir 20%, o que acontece?'), { ferramenta: 'simular_preco_insumo', insumo: 'camarao', variacao: 0.2 })
  assert.deepEqual(interpretarPergunta('Qual insumo mais pesa no meu cardápio?'), { ferramenta: 'insumos_que_mais_pesam' })
})

test('modo rápido: outras formas de perguntar', () => {
  assert.deepEqual(interpretarPergunta('e se o azeite cair 10%?'), { ferramenta: 'simular_preco_insumo', insumo: 'azeite', variacao: -0.1 })
  assert.deepEqual(interpretarPergunta('preço da moqueca no salão'), { ferramenta: 'sugerir_preco', prato: 'moqueca', canal: 'salao' })
  assert.deepEqual(interpretarPergunta('onde o dendê é usado?'), { ferramenta: 'onde_e_usado', insumo: 'dende' })
  assert.deepEqual(interpretarPergunta('saldo de camarão'), { ferramenta: 'saldo_insumo', insumo: 'camarao' })
  assert.deepEqual(interpretarPergunta('resumo do cardápio'), { ferramenta: 'resumo_cardapio' })
  assert.deepEqual(interpretarPergunta('bobó de camarão'), { ferramenta: 'detalhe_prato', prato: 'bobo camarao' })
  assert.equal(interpretarPergunta('???'), null)
  assert.equal(assuntoDa('Quanto custa a moqueca?'), 'moqueca')
})

test('ação do mascote pela pergunta e pela ferramenta', () => {
  assert.equal(acaoDaPergunta('Quero criar um prato novo com camarão'), '20-fazendo-prato')
  assert.equal(acaoDaPergunta('Qual a ficha da moqueca?'), '21-ficha-tecnica')
  assert.equal(acaoDaPergunta('Se o camarão subir 20%?'), '23-calculando-custo')
  assert.equal(acaoDaPergunta('oi'), '11-pensando')
  assert.equal(acaoDaFerramenta('detalhe_prato'), '21-ficha-tecnica')
  assert.equal(acaoDaFerramenta('sugerir_preco'), '23-calculando-custo')
  assert.equal(acaoDaFerramenta('buscar_prato'), '11-pensando')
})

test('entrada das ferramentas: confere e converte', () => {
  assert.deepEqual(validarEntrada('sugerir_preco', { codigo: 10, canal: 'delivery' }), { ferramenta: 'sugerir_preco', codigo: 10, canal: 'delivery' })
  assert.ok('erro' in validarEntrada('sugerir_preco', { codigo: 10, canal: 'balcao' }))
  assert.ok('erro' in validarEntrada('apagar_tudo', {}))
  assert.ok('erro' in validarEntrada('detalhe_prato', { codigo: -1 }))
  assert.deepEqual(validarEntrada('pratos_acima_da_meta', { limite: 35 }), { ferramenta: 'pratos_acima_da_meta', limite: 0.35 })
  assert.deepEqual(validarEntrada('simular_preco_insumo', { codigo_insumo: 7, variacao_pct: 20 }), { ferramenta: 'simular_preco_insumo', codigo: 7, novoPreco: null, variacao: 0.2 })
  assert.ok('erro' in validarEntrada('simular_preco_insumo', { codigo_insumo: 7 }))
  assert.deepEqual(validarEntrada('insumos_que_mais_pesam', { limite: 99 }), { ferramenta: 'insumos_que_mais_pesam', limite: 15 })
  assert.deepEqual(validarEntrada('resumo_cardapio', null), { ferramenta: 'resumo_cardapio' })
})

test('histórico: valida, junta papéis repetidos e corta o tamanho', () => {
  assert.ok('erro' in validarHistorico([]))
  assert.ok('erro' in validarHistorico([{ papel: 'pacioli', texto: 'oi' }]))
  assert.ok('erro' in validarHistorico([{ papel: 'sistema', texto: 'oi' }]))
  assert.ok('erro' in validarHistorico([{ papel: 'usuario', texto: 'x'.repeat(LIMITES.caracteresPergunta + 1) }]))
  const r = validarHistorico([{ papel: 'usuario', texto: 'a' }, { papel: 'usuario', texto: 'b' }])
  assert.ok('mensagens' in r && r.mensagens.length === 1 && r.mensagens[0].texto === 'a\n\nb')
  const longa = Array.from({ length: 30 }, (_, i) => ({ papel: i % 2 ? 'pacioli' : 'usuario', texto: `m${i}` }))
  longa.push({ papel: 'usuario', texto: 'fim' })
  const c = validarHistorico(longa.slice(1))
  assert.ok('mensagens' in c)
  if ('mensagens' in c) {
    assert.ok(c.mensagens.length <= LIMITES.mensagens)
    assert.equal(c.mensagens[0].papel, 'usuario')
    assert.equal(c.mensagens[c.mensagens.length - 1].texto, 'fim')
  }
})

test('texto da resposta: só link interno da cozinha vira link', () => {
  assert.ok(linkPermitido('/cozinha/pratos/123'))
  assert.ok(linkPermitido('/cozinha/pratos?filtro=acima'))
  assert.ok(!linkPermitido('https://exemplo.com'))
  assert.ok(!linkPermitido('javascript:alert(1)'))
  assert.ok(!linkPermitido('/cozinha/../loja'))
  assert.deepEqual(trechosDe('Veja [Moqueca](/cozinha/pratos/1) e [isso](https://x.y) **já**'), [
    { tipo: 'texto', v: 'Veja ' }, { tipo: 'link', v: 'Moqueca', href: '/cozinha/pratos/1' }, { tipo: 'texto', v: ' e ' },
    { tipo: 'texto', v: 'isso' }, { tipo: 'texto', v: ' ' }, { tipo: 'negrito', v: 'já' },
  ])
})

test('texto da resposta: parágrafos e listas', () => {
  const b = blocosDe('Olá\nmundo\n\n- um\n- dois\n\n1. a\n2. b\n## Título')
  assert.equal(b.length, 4)
  assert.equal(b[0].tipo, 'paragrafo')
  assert.ok(b[1].tipo === 'lista' && !b[1].ordenada && b[1].itens.length === 2)
  assert.ok(b[2].tipo === 'lista' && b[2].ordenada)
  assert.deepEqual(b[3], { tipo: 'paragrafo', trechos: [{ tipo: 'negrito', v: 'Título' }] })
})

const prato = { codigo: 9, nome: 'Moqueca', link: '/cozinha/pratos/9', preco: 89.9, custo: 30, cmv: 30 / 89.9 }

test('modo rápido: nenhum prato acima da meta = comemora', () => {
  const r = textoAcima({ meta: 0.3, limite: 0.3, total: 0, pratos: [], naoConfiaveis: 2 })
  assert.ok(r.tudoCerto)
  assert.match(r.texto, /2 pratos ficaram de fora/)
  const r2 = textoAcima({ meta: 0.3, limite: 0.3, total: 1, pratos: [{ ...prato, sugeridoSalao: 99.9 }], naoConfiaveis: 0 })
  assert.ok(!r2.tudoCerto)
  assert.match(r2.texto, /\[Moqueca\]\(\/cozinha\/pratos\/9\)/)
  assert.match(r2.texto, /R\$\s?99,90/)
})

test('modo rápido: preço sugerido e simulação mostram R$ e %', () => {
  const s = textoSugerir({ prato, canal: 'delivery', sugerido: 150.12, sugeridoArredondado: 150.9, cmvNoSugerido: 0.2, sobraNoSugerido: 60, cmvAtual: 0.33, sobraAtual: 40, meta: 0.3, avisos: ['x'] })
  assert.match(s, /no delivery/)
  assert.match(s, /R\$\s?150,90/)
  assert.match(s, /30%/)
  const sim = textoSimular({
    insumo: { codigo: 1, nome: 'Camarão', unidade: 'KG', custoAtual: 80, novoCusto: 96, variacao: 0.2 }, afetados: 1, passamDaMeta: 1, impactoMedioCmv: 0.05,
    pratos: [{ codigo: 9, nome: 'Moqueca', link: '/cozinha/pratos/9', custoAntes: 30, custoDepois: 34, cmvAntes: 0.29, cmvDepois: 0.33 }], avisos: [],
  })
  assert.match(sim, /\+20%/)
  assert.match(sim, /1 prato passa a ficar acima da meta/)
})

test('prompt da loja leva meta e taxas', () => {
  const s = sistemaDaLoja({ taxas: { metaCmv: 0.32, impostoPct: 0.06, taxaCartaoPct: 0.03, taxaDeliveryPct: 0.23, embalagem: 2 }, modo: 'omie', dataCusto: '2026-11-10', pratos: 120, hoje: '12/11/2026' })
  assert.match(s, /Meta de CMV: 32%/)
  assert.match(s, /10\/11\/2026/)
  assert.match(s, /120 pratos/)
})
