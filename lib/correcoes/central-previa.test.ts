import { test } from 'node:test'
import assert from 'node:assert/strict'
import { opcoesDoProblema, previaAcao, lerNumeroBR, interpretarBuscaRapida, type Problema } from './central-puro.ts'

const P = (o: Partial<Problema>): Problema => ({ chave: 'pa:produto:10', grupo: 'pa', alvo: { tipo: 'produto', id: 10 }, titulo: 'Batata frita', tag: 'PA', causa: '', valor: 58.08, valorRotulo: 'no saldo', lado: '', ladoErro: true, acoes: ['zerar', 'op_prato', 'contagem', 'ramon'], assinatura: '', depende: [], busca: '', d: { produto: 10, unidade: 'UN', tipo: '04', saldo: -11, cmc: 5.28, ref: 5.28, sugerida: 11, locaisNeg: [{ local: 1, nome: 'Depósito', saldo: -11 }] }, ...o })
const ctx = { nome: (c: number) => (c === 10 ? 'Batata frita' : `P${c}`), cmc: () => 0, hoje: '2026-10-13' }
const H = '2026-10-13'
type Linhas = { linhas: { rot: string; de: string; para: string }[]; omie: string; aviso?: string }

test('opções na ordem das ações, com valores iniciais', () => {
  assert.equal(opcoesDoProblema(P({}), H)[0].titulo, 'Zerar o saldo')
  const pi = P({ grupo: 'pi', acoes: ['op_preparo', 'contagem', 'ramon'], d: { produto: 11, unidade: 'KG', tipo: '03', saldo: -64.89, sugerida: 64.89, ref: 9.86, locaisNeg: [{ local: 1, nome: 'Depósito', saldo: -64.89 }] } })
  const o = opcoesDoProblema(pi, H)[0]
  assert.equal(o.titulo, 'Lançar OP de preparo')
  assert.deepEqual(o.campos.map((c) => c.inicial), ['64,89', H])
  assert.equal(opcoesDoProblema(pi, H)[2].titulo, 'Pedir contagem ao Ramon')
})

test('prévia de zerar e de contagem', () => {
  const z = previaAcao('zerar', P({}), {}, ctx) as Linhas
  assert.deepEqual(z.linhas, [{ rot: 'Saldo em Depósito', de: '−11 un', para: '0 un' }, { rot: 'Valor do saldo', de: '−R$ 58,08', para: 'R$ 0,00' }])
  assert.equal(z.omie, 'Lança no Omie um ajuste de entrada de 11 un em Depósito, pelo custo médio atual.')
  assert.ok('vazio' in previaAcao('contagem', P({}), { contado: '' }, ctx))
  const c = previaAcao('contagem', P({}), { contado: '4' }, ctx) as Linhas
  assert.deepEqual(c.linhas[1], { rot: 'Diferença', de: '', para: '+15 un' })
})

test('prévia de OP de preparo e de correção de contagem', () => {
  const pi = P({ grupo: 'pi', titulo: 'FAROFA (PI)', d: { produto: 11, unidade: 'KG', tipo: '03', saldo: -64.89, ref: 9.86, locaisNeg: [{ local: 1, nome: 'Depósito', saldo: -64.89 }] } })
  const o = previaAcao('op_preparo', pi, { qtd: '10', data: '2026-10-13' }, ctx) as Linhas
  assert.deepEqual(o.linhas[0], { rot: 'Saldo', de: '−64,89 kg', para: '−54,89 kg' })
  assert.equal(o.omie, 'Cria e conclui no Omie a OP de 10 kg de FAROFA (PI), com data 13/10/2026.')
  assert.ok('vazio' in previaAcao('op_preparo', pi, { qtd: '0', data: H }, ctx))
  assert.ok('vazio' in previaAcao('op_preparo', pi, { qtd: '1', data: '2026-10-20' }, ctx))
  const cc = P({ grupo: 'contagem', d: { produto: 30, unidade: 'KG', saldo: 4658, ref: 17, local: 1, contagem: { de: 5, para: 4658, data: '2026-08-31', sugerida: 4.658 } } })
  const r = previaAcao('corrigir_contagem', cc, { para: '4,658' }, ctx) as Linhas
  assert.deepEqual(r.linhas[1], { rot: 'Diferença', de: '', para: '−4.653,342 kg' })
})

test('concluir OP com custo errado num insumo avisa', () => {
  const op = P({ grupo: 'op', alvo: { tipo: 'op', id: 2 }, depende: [{ texto: 'Corrija antes o custo de Sachê', chave: 'custo:produto:20' }], d: { produto: 30, unidade: 'UN', saldo: -10, saldoLocal: -10, op: { id: 2, nCodOP: 501, numero: '2026/00000042', produto: 30, qtd: 232, local: 1, origem: 'manual', previsao: '2026-10-03', inclusao: '2026-10-03', cupom: null, insumos: [] } } })
  const r = previaAcao('concluir', op, { data: H }, ctx) as Linhas
  assert.match(r.aviso ?? '', /custo/)
  assert.deepEqual(r.linhas[0], { rot: 'Saldo de P30', de: '−10 un', para: '222 un' })
})

test('número em português e busca rápida', () => {
  assert.equal(lerNumeroBR('4,658'), 4.658); assert.equal(lerNumeroBR('1.234,5'), 1234.5); assert.equal(lerNumeroBR(''), null); assert.equal(lerNumeroBR('abc'), null)
  assert.equal(lerNumeroBR('-2'), -2)
  assert.ok(interpretarBuscaRapida('2026/00396850').numerosOP.includes('396850'))
  const c = interpretarBuscaRapida(' 206453 ')
  assert.equal(c.cupomNum, '206453'); assert.ok(c.numerosOP.includes('206453')); assert.equal(c.nIdCupom, null)
  assert.equal(interpretarBuscaRapida('2302207100').nIdCupom, 2302207100)
  assert.deepEqual(interpretarBuscaRapida('batata'), { texto: 'batata', numerosOP: [], cupomNum: null, nIdCupom: null })
})
