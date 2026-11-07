import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avaliarProntidao, type Prontidao } from './prontidao-puro.ts'

const pronta: Prontidao = {
  foto: '2026-11-07',
  cadastro: { produtos: 600, sem_unidade: 0, ncm_invalido: 0, sem_familia: 0, familias: 20, locais: 3, fornecedores: 80 },
  fichas: { producao: 100, lidas: 100 },
  saldo: { linhas: 400, negativos: 0, custo_zero: 0, custo_absurdo: 0, valor: 50000 },
  kardex: { desde: '2026-01-01', linhas: 9000, comparados: 400, batem: 400, diferem: 0, sem_kardex: 0 },
  pendencias: { ops_abertas: 0, notas_pendentes: 0 },
}

test('loja sem pendência = pronta, tudo ok', () => {
  const r = avaliarProntidao(pronta, '2026-11-07')
  assert.equal(r.pronta, true)
  assert.deepEqual(r.resumo, { ok: 9, atencao: 0, bloqueia: 0 })
})

test('loja 5 de 07/11: negativos, custo absurdo e sem fornecedores bloqueiam; kardex, NCM, fichas e pendências pedem atenção', () => {
  const r = avaliarProntidao({
    foto: '2026-11-07',
    cadastro: { produtos: 2148, sem_unidade: 0, ncm_invalido: 922, sem_familia: 0, familias: 49, locais: 11, fornecedores: 0 },
    fichas: { producao: 896, lidas: 889 },
    saldo: { linhas: 903, negativos: 133, custo_zero: 0, custo_absurdo: 18, valor: 1266188.13 },
    kardex: { desde: '2026-01-01', linhas: 958284, comparados: 1333, batem: 666, diferem: 547, sem_kardex: 120 },
    pendencias: { ops_abertas: 246, notas_pendentes: 27 },
  }, '2026-11-07')
  assert.equal(r.pronta, false)
  const e = Object.fromEntries(r.itens.map((i) => [i.chave, i.estado]))
  assert.deepEqual(e, { foto: 'ok', cadastro: 'ok', ncm: 'atencao', fornecedores: 'bloqueia', fichas: 'atencao', negativos: 'bloqueia', custo: 'bloqueia', kardex: 'atencao', pendencias: 'atencao' })
  assert.match(r.itens.find((i) => i.chave === 'kardex')!.detalhe, /666 de 1\.333 produto×local batem \(50%\)/)
})

test('sem kardex copiado e posição velha', () => {
  const r = avaliarProntidao({ ...pronta, foto: '2026-10-13', kardex: { desde: null, linhas: 0, comparados: 0, batem: 0, diferem: 0, sem_kardex: 0 } }, '2026-11-07')
  const e = Object.fromEntries(r.itens.map((i) => [i.chave, i.estado]))
  assert.equal(e.kardex, 'bloqueia'); assert.equal(e.foto, 'atencao')
})

test('par com saldo só no kardex conta como atenção', () => {
  const r = avaliarProntidao({ ...pronta, kardex: { ...pronta.kardex, so_kardex: 5 } }, '2026-11-07')
  const k = r.itens.find((i) => i.chave === 'kardex')!
  assert.equal(k.estado, 'atencao'); assert.match(k.detalhe, /5 com saldo só no kardex/)
})

test('mexeu no dia da foto aparece à parte (inconclusivo)', () => {
  const r = avaliarProntidao({ ...pronta, kardex: { ...pronta.kardex, mexeu_no_dia: 12 } }, '2026-11-07')
  const k = r.itens.find((i) => i.chave === 'kardex')!
  assert.equal(k.estado, 'ok'); assert.match(k.detalhe, /12 mexeram no dia da foto/)
})
