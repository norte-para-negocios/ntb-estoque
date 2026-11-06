import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerEntradaDreLoja, lerEntradaFluxo, vendasPorProduto, type Db } from './relatorios-consultas.ts'

type Resp = { data: unknown; error: { code?: string; message: string } | null }
// Cliente falso: cada tabela/RPC responde o que o teste mandar; guarda os filtros pedidos.
function falso(respostas: Record<string, Resp>, chamadas: string[] = []): Db {
  const cadeia = (nome: string) => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'gte', 'lte', 'in', 'order']) c[m] = (...a: unknown[]) => { chamadas.push(`${nome}.${m}(${JSON.stringify(a)})`); return c }
    const r = () => Promise.resolve(respostas[nome] ?? { data: [], error: null })
    c.range = r
    c.then = (ok: (x: Resp) => unknown, ko?: (e: unknown) => unknown) => r().then(ok, ko)
    return c
  }
  return { from: (t: string) => cadeia(t), rpc: (f: string, args: unknown) => { chamadas.push(`rpc ${f} ${JSON.stringify(args)}`); return cadeia(f) } } as unknown as Db
}
const ok = (data: unknown): Resp => ({ data, error: null })

test('DRE: vendas e CMV vêm do lucro_proprio (mesma fonte do /relatorio-cmv) e mês sem venda vira zero', async () => {
  const chamadas: string[] = []
  const r = await lerEntradaDreLoja(falso({
    lucro_proprio: ok([{ rotulo: '2026-10', faturamento: '31482.67', cmv: '7395.92', itens_sem_baixa: 0, itens_sem_custo: 56 }]),
    fin_receber_vendas_previa: ok([{ data_venda: '2026-10-05', forma: 'credito', quantidade: 2, valor_bruto: '31482.67', valor_taxa: '0', configurar: true }]),
  }, chamadas), 15, ['2026-09', '2026-10'])
  assert.ok(chamadas.some((c) => c.startsWith('rpc lucro_proprio') && c.includes('"p_dim":"mes"') && c.includes('"p_ini":"2026-09-01"') && c.includes('"p_fim":"2026-10-31"')))
  assert.ok(chamadas.some((c) => c === 'fin_titulos_pagar.neq(["status","cancelado"])'), 'conta cancelada fora')
  assert.ok(chamadas.some((c) => c === 'fin_lancamentos.in(["origem_tipo",["manual","estorno_manual"]])'), 'só avulsos na DRE (pagamento é caixa)')
  assert.deepEqual(r.entrada.vendas.map((v) => [v.mes, v.faturamento, v.cmv]).sort(), [['2026-09', 0, 0], ['2026-10', 31482.67, 7395.92]])
  assert.ok(r.avisos.some((a) => /56 com insumo sem custo/.test(a)))
  assert.equal(r.entrada.taxasCartao[0].fonte, 'previa')
})

test('DRE: erro real de banco é lançado (nunca vira zero); 380 ausente vira aviso', async () => {
  await assert.rejects(lerEntradaDreLoja(falso({ lucro_proprio: { data: null, error: { code: '57014', message: 'timeout' } } }), 15, ['2026-10']), /lucro_proprio/)
  await assert.rejects(lerEntradaDreLoja(falso({ fin_titulos_pagar: { data: null, error: { code: '500', message: 'x' } } }), 15, ['2026-10']), /contas a pagar/)
  const r = await lerEntradaDreLoja(falso({
    fin_receber_vendas_previa: { data: null, error: { code: 'PGRST202', message: 'nao existe' } },
    fin_titulos_receber: { data: null, error: { code: '42P01', message: 'nao existe' } },
  }), 15, ['2026-10'])
  assert.ok(r.avisos.some((a) => /380/.test(a)))
})

test('DRE: pagamentos das vendas (fonte da 380) diferentes da receita viram aviso com a diferença', async () => {
  const r = await lerEntradaDreLoja(falso({
    lucro_proprio: ok([{ rotulo: '2026-10', faturamento: '100', cmv: '30' }]),
    fin_receber_vendas_previa: ok([{ data_venda: '2026-10-05', forma: 'pix', quantidade: 1, valor_bruto: '110', valor_taxa: '0', configurar: true }]),
  }), 15, ['2026-10'])
  assert.ok(r.avisos.some((a) => /10,00 a mais/.test(a)))
})

test('vendasPorProduto pagina a RPC por produto', async () => {
  const r = await vendasPorProduto(falso({ lucro_proprio: ok([{ rotulo: 'Moqueca', quantidade: '2', faturamento: '180', cmv: '60' }]) }), 15, '2026-10')
  assert.deepEqual(r, [{ rotulo: 'Moqueca', quantidade: 2, faturamento: 180, cmv: 60 }])
})

test('Fluxo: lê contas com saldo, extrato desde o início, a pagar em aberto e recebíveis em aberto', async () => {
  const chamadas: string[] = []
  const r = await lerEntradaFluxo(falso({
    fin_contas_saldo: ok([{ id: 1, nome: 'Caixa', ativa: true, saldo_inicial: '0', saldo_atual: '50.5', lancamentos: 1 }]),
    fin_recorrentes_listar: ok([]),
  }, chamadas), 15, '2026-11-01', '2026-11-30', '2026-11-05', 'semana')
  assert.deepEqual(r.entrada.contas, [{ id: 1, nome: 'Caixa', saldo_atual: 50.5 }])
  assert.ok(chamadas.includes('fin_titulos_pagar.in(["status",["aberto","parcial"]])'))
  assert.ok(chamadas.includes('fin_lancamentos.gte(["data","2026-11-01"])'))
  await assert.rejects(lerEntradaFluxo(falso({ fin_lancamentos: { data: null, error: { code: '500', message: 'x' } }, fin_recorrentes_listar: ok([]) }),
    15, '2026-11-01', '2026-11-30', '2026-11-05', 'semana'), /extrato/)
})
