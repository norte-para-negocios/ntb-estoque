import { test } from 'node:test'
import assert from 'node:assert/strict'
import { locaisSumidos, custoValido, escolherFoto, montarPosicao, textoAvisoSuspeito, type LinhaFoto, type MetaProduto, type OpcoesPosicao } from './posicao-estoque-puro.ts'

const P = (o: Partial<MetaProduto> & { codigo_produto: number }): MetaProduto => ({
  codigo: String(o.codigo_produto), descricao: `Produto ${o.codigo_produto}`, familia: 'Insumos', tipo: '01', unidade: 'KG', ncm: '0000.00.00', inativo: false, ...o,
})
const F = (n_cod_prod: number, codigo_local_estoque: number, n_saldo: number, n_cmc: number, reservado: number | null = null): LinhaFoto => ({ n_cod_prod, codigo_local_estoque, n_saldo, n_cmc, reservado })
const locais = new Map([[10, { descricao: 'DEPOSITO', padrao: true }], [20, { descricao: 'COZINHA', padrao: false }]])
const produtos = [P({ codigo_produto: 1 }), P({ codigo_produto: 2, familia: 'Bebidas', tipo: '00' }), P({ codigo_produto: 3, inativo: true }), P({ codigo_produto: 4 })]
const foto = [
  F(1, 0, 0, 5), // sentinela: nunca é linha
  F(1, 10, 10, 5, 2), F(1, 20, -2, 6),
  F(2, 10, 3, 2.7e10), // custo absurdo
  F(3, 10, 4, 1),
  F(4, 0, 0, 7), // só sentinela: zerado
]
const op = (o: Partial<OpcoesPosicao> = {}): OpcoesPosicao => ({ ver: 'produto', zerados: false, inativos: true, tipos: [], familias: [], q: '', ...o })

test('custoValido: (0, 1e7)', () => {
  assert.equal(custoValido(5), true)
  assert.equal(custoValido(0), false)
  assert.equal(custoValido(-1), false)
  assert.equal(custoValido(2.7e10), false)
})

test('mesmo total nas visões por produto e por local; negativo entra; sentinela fora', () => {
  const pr = montarPosicao(foto, produtos, locais, op())
  const lo = montarPosicao(foto, produtos, locais, op({ ver: 'local' }))
  assert.equal(pr.total.valor, 50 - 12 + 4) // 10×5 − 2×6 + 4×1; o absurdo vale 0
  assert.equal(lo.total.valor, pr.total.valor)
  assert.equal(pr.total.positivo, 54)
  assert.equal(pr.total.negativo, -12)
  assert.equal(pr.total.suspeitos, 1)
  assert.equal(lo.linhas.length, 4) // 1@10, 1@20, 2@10, 3@10
  const p1 = pr.linhas.find((l) => l.codProduto === 1)!
  assert.equal(p1.quant, 8)
  assert.equal(p1.valor, 38)
  assert.equal(p1.reservado, 2)
  assert.equal(p1.disponivel, 6)
  assert.equal(pr.linhas.find((l) => l.codProduto === 2)!.custoSuspeito, true)
})

test('zerados só com a opção; na visão por local vão para o local padrão', () => {
  assert.equal(montarPosicao(foto, produtos, locais, op()).linhas.some((l) => l.codProduto === 4), false)
  const pr = montarPosicao(foto, produtos, locais, op({ zerados: true }))
  const z = pr.linhas.find((l) => l.codProduto === 4)!
  assert.equal(z.quant, 0)
  assert.equal(z.cmc, 7) // custo da sentinela
  const lo = montarPosicao(foto, produtos, locais, op({ ver: 'local', zerados: true }))
  assert.equal(lo.linhas.find((l) => l.codProduto === 4)!.local, 'DEPOSITO')
  assert.equal(pr.total.valor, montarPosicao(foto, produtos, locais, op()).total.valor)
})

test('inativos: escondidos sem a opção', () => {
  const r = montarPosicao(foto, produtos, locais, op({ inativos: false }))
  assert.equal(r.linhas.some((l) => l.codProduto === 3), false)
})

test('tipo SPED (Bloco H): só ativo com saldo > 0, valor unitário = valor ÷ quantidade', () => {
  const r = montarPosicao(foto, produtos, locais, op({ ver: 'sped', zerados: true }))
  assert.deepEqual(r.linhas.map((l) => l.codProduto), [1, 2])
  const p1 = r.linhas.find((l) => l.codProduto === 1)!
  assert.equal(p1.quant, 8)
  assert.equal(p1.cmc, 4.75)
  assert.equal(p1.ncm, '0000.00.00')
  assert.equal(r.total.valor, 38) // por produto (o local com −2 já está dentro do produto 1)
  assert.equal(r.total.negativo, 0)
  assert.equal(r.total.suspeitos, 1)
})

test('filtros de tipo, família e busca', () => {
  assert.deepEqual(montarPosicao(foto, produtos, locais, op({ tipos: ['00'] })).linhas.map((l) => l.codProduto), [2])
  assert.deepEqual(montarPosicao(foto, produtos, locais, op({ familias: ['Bebidas'] })).linhas.map((l) => l.codProduto), [2])
  assert.deepEqual(montarPosicao(foto, produtos, locais, op({ q: 'produto 3' })).linhas.map((l) => l.codProduto), [3])
})

test('ordem: maior valor primeiro; sem foto = vazio', () => {
  const r = montarPosicao(foto, produtos, locais, op())
  assert.deepEqual(r.linhas.map((l) => l.codProduto), [1, 3, 2])
  const v = montarPosicao([], produtos, locais, op())
  assert.deepEqual(v.total, { linhas: 0, quant: 0, valor: 0, positivo: 0, negativo: 0, suspeitos: 0, ajusteOmie: 0, suspeitas: [] })
})

test('escolherFoto: a mais recente com local real', () => {
  assert.equal(escolherFoto([{ data: '2026-10-19', temLocalReal: false }, { data: '2026-10-18', temLocalReal: true }]), '2026-10-18')
  assert.equal(escolherFoto([{ data: '2026-10-18', temLocalReal: true }, { data: '2026-10-19', temLocalReal: true }]), '2026-10-19')
  assert.equal(escolherFoto([]), null)
})

test('produto com quantidade 0 mas valor ≠ 0 (locais que se anulam) continua na tabela: as linhas somam o cartão', () => {
  const f = [F(5, 10, 2, 10), F(5, 20, -2, 4)] // 20 − 8 = 12 com quantidade líquida 0
  const r = montarPosicao(f, [P({ codigo_produto: 5 })], locais, op())
  assert.equal(r.linhas.length, 1)
  assert.equal(r.linhas[0].quant, 0)
  assert.equal(r.linhas[0].valor, 12)
  assert.equal(r.linhas.reduce((s, l) => s + l.valor, 0), r.total.valor)
})

test('locaisSumidos: local ativo que estava na foto anterior e não está na atual', () => {
  assert.deepEqual(locaisSumidos([10], [10, 20, 30], new Set([10, 20])), [20])
  assert.deepEqual(locaisSumidos([10, 20], [10, 20], new Set([10, 20])), [])
  assert.deepEqual(locaisSumidos([10], [], new Set([10, 20])), [])
})

// Paridade 20/10/2026 (revisão do B6): a regra do custo suspeito é do banco (posicao_valorizada, migration 282); a tela
// usa o `valor`/`cmc_usado`/`suspeito` que vêm de lá. Caso real da loja 3 (20/10): Moqueca de Camarão 600 g −29 × CMC
// 3.649.182 (sem referência de custo, preço 184,90) vale 0; Pepsi Zero −259 × 34,25 com referência 3,253298 (locais
// positivos) vale −842,60. Sem isso o total da loja 3 ia a −R$ 140 milhões.
test('linhas valorizadas pelo banco: custo suspeito usa a referência e entra no aviso', () => {
  const fotoBanco: LinhaFoto[] = [
    { n_cod_prod: 90151, codigo_local_estoque: 10, n_saldo: -29, n_cmc: 3649182.185099, reservado: 0, cmc_usado: 0, valor: 0, suspeito: true, referencia: null, valor_omie: -105826283.37 },
    { n_cod_prod: 90834, codigo_local_estoque: 10, n_saldo: -259, n_cmc: 34.25188, reservado: 0, cmc_usado: 3.253298, valor: -842.6, suspeito: true, referencia: 3.253298, valor_omie: -8871.24 },
    { n_cod_prod: 90834, codigo_local_estoque: 20, n_saldo: 100, n_cmc: 3.253298, reservado: 0, cmc_usado: 3.253298, valor: 325.33, suspeito: false, referencia: 3.253298, valor_omie: 325.33 },
  ]
  const prods = [P({ codigo_produto: 90151, codigo: '90151', descricao: 'Moqueca de Camarão 600 g' }), P({ codigo_produto: 90834, codigo: '90834', descricao: 'Pepsi Zero 350 ml' })]
  const r = montarPosicao(fotoBanco, prods, locais, op({ ver: 'local' }))
  assert.equal(r.total.valor, -517.27)
  assert.equal(r.total.suspeitos, 2)
  assert.equal(r.total.ajusteOmie, Math.round((-105826283.37 - 8871.24 + 842.6) * 100) / 100)
  assert.equal(r.total.suspeitas[0].codigo, '90151') // maior ajuste primeiro
  assert.equal(r.total.suspeitas[1].referencia, 3.253298)
  assert.equal(Math.round((r.total.valor + r.total.ajusteOmie) * 100) / 100, Math.round((-105826283.37 - 8871.24 + 325.33) * 100) / 100) // total + ajuste = Omie
  assert.equal(montarPosicao(fotoBanco, prods, locais, op()).total.valor, -517.27) // mesmo total por produto
  assert.equal(textoAvisoSuspeito(2, -105834312.01)?.startsWith('2 linhas com custo médio suspeito no Omie ('), true)
  assert.equal(textoAvisoSuspeito(0, 0), null)
})
