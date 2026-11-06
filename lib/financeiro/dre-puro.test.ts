import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  linhaDoGrupo, mesesEntre, montarDre, origensDaLinha, mesclarTaxasCartao, linhasVendasPorProduto,
  type CategoriaDre, type EntradaDre,
} from './dre-puro.ts'

const CATS: CategoriaDre[] = [
  { id: 1, nome: 'Venda de mercadorias e pratos', tipo: 'receita', grupo_dre: 'receita_bruta' },
  { id: 2, nome: 'Impostos sobre vendas', tipo: 'despesa', grupo_dre: 'deducoes' },
  { id: 3, nome: 'Matéria-prima e insumos', tipo: 'despesa', grupo_dre: 'cmv' },
  { id: 4, nome: 'Folha de pagamento e encargos', tipo: 'despesa', grupo_dre: 'despesa_pessoal' },
  { id: 5, nome: 'Aluguel e condomínio', tipo: 'despesa', grupo_dre: 'despesa_ocupacao' },
  { id: 6, nome: 'Manutenção e reparos', tipo: 'despesa', grupo_dre: 'despesa_operacional' },
  { id: 7, nome: 'Telefone e internet', tipo: 'despesa', grupo_dre: 'despesa_administrativa' },
  { id: 8, nome: 'Juros e multas pagos', tipo: 'despesa', grupo_dre: 'despesa_financeira' },
  { id: 9, nome: 'Rendimentos', tipo: 'receita', grupo_dre: 'receita_financeira' },
  { id: 10, nome: 'Outras despesas', tipo: 'despesa', grupo_dre: 'outras' },
  { id: 11, nome: 'IRPJ/CSLL', tipo: 'despesa', grupo_dre: 'imposto_resultado' },
  { id: 12, nome: 'Freezer novo', tipo: 'despesa', grupo_dre: 'investimento' },
]

const base = (over: Partial<EntradaDre> = {}): EntradaDre => ({
  meses: ['2026-10'],
  categorias: CATS,
  vendas: [{ loja_id: 15, mes: '2026-10', faturamento: 31482.67, cmv: 7395.92 }],
  taxasCartao: [],
  titulos: [],
  lancamentos: [],
  ...over,
})
const valor = (d: ReturnType<typeof montarDre>, codigo: string, mes = '2026-10') => d.linhas.find((l) => l.codigo === codigo)?.valores[mes]

test('mesesEntre lista os meses do intervalo (inclusive) e recusa intervalo invertido ou longo demais', () => {
  assert.deepEqual(mesesEntre('2026-09', '2026-11'), ['2026-09', '2026-10', '2026-11'])
  assert.deepEqual(mesesEntre('2025-12', '2026-01'), ['2025-12', '2026-01'])
  assert.deepEqual(mesesEntre('2026-11', '2026-10'), [])
  assert.equal(mesesEntre('2025-01', '2026-12', 12).length, 12)
})

test('linhaDoGrupo: padrão de restaurante (ocupação separada; CMV e investimento fora da DRE; sem categoria fora)', () => {
  assert.equal(linhaDoGrupo('receita_bruta'), 'receita_bruta')
  assert.equal(linhaDoGrupo('deducoes'), 'deducoes')
  assert.equal(linhaDoGrupo('despesa_ocupacao'), 'despesa_ocupacao')
  assert.equal(linhaDoGrupo('despesa_financeira'), 'resultado_financeiro')
  assert.equal(linhaDoGrupo('receita_financeira'), 'resultado_financeiro')
  assert.equal(linhaDoGrupo('cmv'), 'fora_compras_estoque')
  assert.equal(linhaDoGrupo('investimento'), 'fora_investimento')
  assert.equal(linhaDoGrupo(null), 'fora_sem_categoria')
  assert.equal(linhaDoGrupo('grupo_que_nao_existe'), 'fora_sem_categoria')
})

test('ODARA sem despesas lançadas: a DRE vai até a margem bruta e o resto fica vazio (nunca zero inventado)', () => {
  const d = montarDre(base())
  assert.equal(valor(d, 'receita_bruta'), 31482.67)
  assert.equal(valor(d, 'deducoes'), 0)
  assert.equal(valor(d, 'receita_liquida'), 31482.67)
  assert.equal(valor(d, 'cmv'), 7395.92)
  assert.equal(valor(d, 'lucro_bruto'), 24086.75)
  assert.equal(d.temDespesas, false)
  for (const c of ['despesa_pessoal', 'despesa_ocupacao', 'total_despesas', 'resultado_operacional', 'resultado_financeiro', 'resultado_liquido']) {
    assert.equal(valor(d, c), null, `${c} fica vazio`)
  }
  assert.ok(d.avisos.some((a) => /sem despesas lançadas/i.test(a)))
})

test('DRE completa: cada categoria cai na sua linha e os subtotais fecham em centavos', () => {
  const d = montarDre(base({
    taxasCartao: [{ loja_id: 15, data: '2026-10-05', forma: 'credito', quantidade: 3, bruto: 300, valor: 9.3, fonte: 'previa', configurar: false }],
    titulos: [
      { loja_id: 15, id: 1, numero: 1, fornecedor_nome: 'Prefeitura', documento: 'DAS', valor: 1200.1, data_competencia: '2026-10-01', categoria_id: 2, origem_tipo: 'manual' },
      { loja_id: 15, id: 2, numero: 2, fornecedor_nome: 'Equipe', documento: null, valor: 8000, data_competencia: '2026-10-01', categoria_id: 4, origem_tipo: 'manual' },
      { loja_id: 15, id: 3, numero: 3, fornecedor_nome: 'Imobiliária', documento: null, valor: 4500, data_competencia: '2026-10-01', categoria_id: 5, origem_tipo: 'recorrente' },
      { loja_id: 15, id: 4, numero: 4, fornecedor_nome: 'Atacado', documento: 'NF 1', valor: 5000, data_competencia: '2026-10-01', categoria_id: 3, origem_tipo: 'nota_entrada' },
      { loja_id: 15, id: 5, numero: 5, fornecedor_nome: 'Banco', documento: null, valor: 50, data_competencia: '2026-10-01', categoria_id: 8, origem_tipo: 'manual' },
      { loja_id: 15, id: 6, numero: 6, fornecedor_nome: 'Loja', documento: null, valor: 3000, data_competencia: '2026-10-01', categoria_id: 12, origem_tipo: 'manual' },
      { loja_id: 15, id: 7, numero: 7, fornecedor_nome: 'Atacado', documento: 'NF 2', valor: 700, data_competencia: '2026-10-01', categoria_id: null, origem_tipo: 'nota_entrada' },
      { loja_id: 15, id: 8, numero: 8, fornecedor_nome: 'Receita Federal', documento: null, valor: 100, data_competencia: '2026-10-01', categoria_id: 11, origem_tipo: 'manual' },
    ],
    lancamentos: [
      { loja_id: 15, id: 10, data: '2026-10-10', tipo: 'saida', valor: 120, descricao: 'Internet', categoria_id: 7, origem_tipo: 'manual' },
      { loja_id: 15, id: 11, data: '2026-10-11', tipo: 'saida', valor: 80, descricao: 'Conserto', categoria_id: 6, origem_tipo: 'manual' },
      // estorno do conserto: entrada de mesmo valor anula a despesa
      { loja_id: 15, id: 12, data: '2026-10-12', tipo: 'entrada', valor: 80, descricao: 'Estorno: Conserto', categoria_id: 6, origem_tipo: 'estorno_manual' },
      { loja_id: 15, id: 13, data: '2026-10-15', tipo: 'entrada', valor: 30.5, descricao: 'Rendimento', categoria_id: 9, origem_tipo: 'manual' },
      { loja_id: 15, id: 14, data: '2026-10-16', tipo: 'saida', valor: 10, descricao: 'Diversos', categoria_id: 10, origem_tipo: 'manual' },
    ],
  }))
  assert.equal(d.temDespesas, true)
  assert.equal(valor(d, 'deducoes'), 1209.4) // 1200,10 de imposto + 9,30 de taxa de cartão
  assert.equal(valor(d, 'receita_liquida'), 30273.27)
  assert.equal(valor(d, 'lucro_bruto'), 22877.35)
  assert.equal(valor(d, 'despesa_pessoal'), 8000)
  assert.equal(valor(d, 'despesa_ocupacao'), 4500)
  assert.equal(valor(d, 'despesa_operacional'), 0) // 80 − 80 do estorno
  assert.equal(valor(d, 'despesa_administrativa'), 120)
  assert.equal(valor(d, 'total_despesas'), 12620)
  assert.equal(valor(d, 'resultado_operacional'), 10257.35)
  assert.equal(valor(d, 'resultado_financeiro'), -19.5) // 30,50 − 50
  assert.equal(valor(d, 'outras'), -10)
  assert.equal(valor(d, 'imposto_resultado'), 100)
  assert.equal(valor(d, 'resultado_liquido'), 10127.85)
  // fora da DRE: compra para estoque (o custo entra pelo CMV do estoque), investimento e conta sem categoria
  assert.equal(d.fora.fora_compras_estoque[`2026-10`], 5000)
  assert.equal(d.fora.fora_investimento[`2026-10`], 3000)
  assert.equal(d.fora.fora_sem_categoria[`2026-10`], 700)
  assert.ok(d.avisos.some((a) => /sem categoria/i.test(a)))
})

test('todo número abre as linhas de origem: a soma das origens é o valor da linha', () => {
  const ent = base({
    taxasCartao: [
      { loja_id: 15, data: '2026-10-05', forma: 'credito', quantidade: 3, bruto: 300, valor: 9.3, fonte: 'titulo', configurar: false },
      { loja_id: 15, data: '2026-10-05', forma: 'debito', quantidade: 1, bruto: 100, valor: 1.1, fonte: 'previa', configurar: false },
    ],
    titulos: [{ loja_id: 15, id: 1, numero: 1, fornecedor_nome: 'Prefeitura', documento: 'DAS', valor: 1200.1, data_competencia: '2026-10-01', categoria_id: 2, origem_tipo: 'manual' }],
    lancamentos: [
      { loja_id: 15, id: 11, data: '2026-10-11', tipo: 'saida', valor: 80, descricao: 'Conserto', categoria_id: 6, origem_tipo: 'manual' },
      { loja_id: 15, id: 12, data: '2026-10-12', tipo: 'entrada', valor: 80, descricao: 'Estorno', categoria_id: 6, origem_tipo: 'estorno_manual' },
    ],
  })
  const d = montarDre(ent)
  const ded = origensDaLinha(ent, 'deducoes', '2026-10')
  assert.equal(ded.length, 3)
  assert.equal(Math.round(ded.reduce((s, o) => s + o.valor, 0) * 100) / 100, valor(d, 'deducoes'))
  assert.ok(ded.some((o) => o.tipo === 'titulo_pagar' && o.href === '/financeiro/contas-pagar/1'))
  assert.ok(ded.some((o) => o.tipo === 'taxa_cartao' && o.estimado))
  const op = origensDaLinha(ent, 'despesa_operacional', '2026-10')
  assert.deepEqual(op.map((o) => o.valor), [80, -80], 'estorno aparece como valor negativo na linha de despesa')
  const rb = origensDaLinha(ent, 'receita_bruta', '2026-10')
  assert.equal(rb[0].tipo, 'vendas')
  assert.match(rb[0].href ?? '', /relatorio-cmv\?.*ini=2026-10-01.*fim=2026-10-31/)
  // mês sem filtro: todas as origens do período
  assert.equal(origensDaLinha(ent, 'deducoes', null).length, 3)
})

test('consolidada: soma as lojas e avisa a loja sem despesas', () => {
  const d = montarDre(base({
    vendas: [{ loja_id: 15, mes: '2026-10', faturamento: 100, cmv: 30 }, { loja_id: 20, mes: '2026-10', faturamento: 50.55, cmv: 10.1 }],
    titulos: [{ loja_id: 20, id: 9, numero: 1, fornecedor_nome: 'X', documento: null, valor: 10, data_competencia: '2026-10-01', categoria_id: 4, origem_tipo: 'manual' }],
    nomesLojas: { 15: 'ODARA', 20: 'Outra' },
  }))
  assert.equal(valor(d, 'receita_bruta'), 150.55)
  assert.equal(valor(d, 'cmv'), 40.1)
  assert.equal(valor(d, 'resultado_operacional'), 100.45)
  assert.ok(d.avisos.some((a) => /ODARA.*sem despesas lançadas/i.test(a)))
})

test('mês sem venda aparece com zero (a venda é dado: zero vendido é zero) e o total soma os meses', () => {
  const d = montarDre(base({ meses: ['2026-09', '2026-10'] }))
  assert.equal(valor(d, 'receita_bruta', '2026-09'), 0)
  assert.equal(d.linhas.find((l) => l.codigo === 'receita_bruta')?.total, 31482.67)
})

test('taxas de cartão: título gerado vale; sem título, a prévia (estimada); forma de cartão sem cadastro vira aviso', () => {
  const m = mesclarTaxasCartao(
    [{ loja_id: 15, data_venda: '2026-10-05', forma: 'credito', quantidade: 2, valor_bruto: 200, valor_taxa: 6, configurar: false }],
    [
      { loja_id: 15, data_venda: '2026-10-05', forma: 'credito', quantidade: 2, valor_bruto: 200, valor_taxa: 7, configurar: false },
      { loja_id: 15, data_venda: '2026-10-06', forma: 'debito', quantidade: 1, valor_bruto: 50, valor_taxa: 0, configurar: true },
      { loja_id: 15, data_venda: '2026-10-06', forma: 'pix', quantidade: 1, valor_bruto: 50, valor_taxa: 0, configurar: true },
    ],
  )
  assert.deepEqual(m.map((t) => [t.data, t.forma, t.valor, t.fonte]), [
    ['2026-10-05', 'credito', 6, 'titulo'], ['2026-10-06', 'debito', 0, 'previa'], ['2026-10-06', 'pix', 0, 'previa'],
  ])
  const d = montarDre(base({ taxasCartao: m }))
  assert.ok(d.avisos.some((a) => /taxa.*débito/i.test(a)), 'débito sem cadastro de taxa é avisado')
  assert.ok(!d.avisos.some((a) => /PIX/.test(a)), 'PIX sem taxa é normal, não avisa')
})

test('linhasVendasPorProduto: origem da receita e do CMV por produto, com a diferença de arredondamento à vista', () => {
  const r = linhasVendasPorProduto([
    { rotulo: 'Moqueca', quantidade: 10, faturamento: 900.005, cmv: 300.004 },
    { rotulo: 'Taxa de serviço', quantidade: 5, faturamento: 90, cmv: 0 },
  ], 'cmv', 300.02)
  assert.deepEqual(r.linhas.map((l) => l.rotulo), ['Moqueca', 'Taxa de serviço'])
  assert.equal(r.soma, 300)
  assert.equal(r.diferenca, 0.02)
})
