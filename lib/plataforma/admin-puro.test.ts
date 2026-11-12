import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarAssinatura, validarPreco, tabelaAusente, ordenarLojas, PLANOS_VENDAS, lerValorBR } from './admin-puro.ts'

test('validarAssinatura aceita estado conhecido ou null, módulo conhecido, loja inteira positiva', () => {
  assert.equal(validarAssinatura(5, 'cozinha', { estado: 'bloqueado', planoId: null, precoCombinado: null }), null)
  assert.equal(validarAssinatura(5, 'erp', { estado: null, planoId: null, precoCombinado: null }), null)
  assert.match(validarAssinatura(0, 'erp', { estado: 'ativo', planoId: null, precoCombinado: null })!, /Loja/)
  assert.match(validarAssinatura(1.5, 'erp', { estado: 'ativo', planoId: null, precoCombinado: null })!, /Loja/)
  assert.match(validarAssinatura(5, 'xyz' as never, { estado: 'ativo', planoId: null, precoCombinado: null })!, /Módulo/)
  assert.match(validarAssinatura(5, 'erp', { estado: 'pausado' as never, planoId: null, precoCombinado: null })!, /Estado/)
  assert.match(validarAssinatura(5, 'erp', { estado: 'ativo', planoId: null, precoCombinado: -1 })!, /Preço/)
  assert.match(validarAssinatura(5, 'erp', { estado: 'ativo', planoId: null, precoCombinado: Number.NaN })!, /Preço/)
  assert.equal(validarAssinatura(5, 'erp', { estado: 'ativo', planoId: null, precoCombinado: 0 }), null)
})

test('plano só do próprio módulo', () => {
  assert.equal(validarAssinatura(5, 'vendas', { estado: 'ativo', planoId: 'vendas-mesas', precoCombinado: null }), null)
  assert.match(validarAssinatura(5, 'erp', { estado: 'ativo', planoId: 'vendas-mesas', precoCombinado: null })!, /Plano/)
  assert.match(validarAssinatura(5, 'vendas', { estado: 'ativo', planoId: 'nada', precoCombinado: null })!, /Plano/)
  assert.deepEqual(PLANOS_VENDAS.map((p) => p.id), ['vendas-balcao', 'vendas-mesas', 'vendas-mais-10-mesas'])
})

test('validarPreco: null limpa; número >= 0; plano conhecido', () => {
  assert.equal(validarPreco('erp', null), null)
  assert.equal(validarPreco('vendas-balcao', 50), null)
  assert.match(validarPreco('erp', -0.01)!, /Preço/)
  assert.match(validarPreco('erp', Number.POSITIVE_INFINITY)!, /Preço/)
  assert.match(validarPreco('outro', 10)!, /Plano/)
})

test('tabelaAusente reconhece tabela que ainda não existe (migration não aplicada)', () => {
  assert.equal(tabelaAusente({ code: 'PGRST205', message: "Could not find the table 'public.plataforma_assinaturas' in the schema cache" }), true)
  assert.equal(tabelaAusente({ code: '42P01', message: 'relation "public.plataforma_planos" does not exist' }), true)
  assert.equal(tabelaAusente({ code: '23505', message: 'duplicate key' }), false)
  assert.equal(tabelaAusente(null), false)
})

test('ordenarLojas: reais primeiro, depois as de teste; por nome dentro de cada grupo', () => {
  const r = ordenarLojas([
    { id: 9, nome: 'B', is_test: true },
    { id: 3, nome: 'Zeta', is_test: false },
    { id: 2, nome: 'alfa', is_test: false },
    { id: 8, nome: 'A', is_test: true },
  ])
  assert.deepEqual(r.map((l) => l.id), [2, 3, 8, 9])
})

test('lerValorBR: dinheiro digitado no jeito brasileiro', () => {
  const casos: [string, number | null][] = [
    ['', null], ['  ', null], ['70', 70], ['R$ 70', 70], ['r$70,00', 70],
    ['1.500', 1500], ['1.500,50', 1500.5], ['12,9', 12.9], ['12.90', 12.9], ['70.5', 70.5],
    ['1.234.567', 1234567], ['1.234.567,89', 1234567.89], ['1500,5', 1500.5], ['0,99', 0.99],
  ]
  for (const [t, esperado] of casos) assert.equal(lerValorBR(t), esperado, t)
  for (const t of ['abc', '1.50.0', '12.345,6,7', '1,500.50', '12.3456', '-5']) assert.ok(Number.isNaN(lerValorBR(t)), t)
})
