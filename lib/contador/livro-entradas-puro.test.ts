import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore: import com .ts exigido pelo node --test
import { cfopEntradaDoItem, dataEntradaDaNota, montarLivro, ufDaChave } from './livro-entradas-puro.ts'

const CHAVE_BA = '29' + '0'.repeat(42)
const CHAVE_SP = '35' + '0'.repeat(42)
const nota = (o: Record<string, unknown>) => ({
  id: 1, numero: '123', serie: '1', modelo: '55', chave: CHAVE_BA, emissao: '2026-09-28', dRec: '02/10/2026', etapa: '60', cancelada: false,
  fornecedor: 'HORTI', cnpj: '00000000000191', ...o,
})
const item = (notaId: number, cfopNota: string, fo: Record<string, unknown>, vTotal = 0) => ({ notaId, cfopNota, fo, vTotalItem: vTotal })

test('cfopEntradaDoItem: usa o CFOP de entrada; sem ele, converte o do fornecedor', () => {
  assert.equal(cfopEntradaDoItem({ itensAjustes: { cCFOPEntrada: '1.403' } }, '5.405'), '1.403')
  assert.equal(cfopEntradaDoItem({}, '5.102'), '1.102')
  assert.equal(cfopEntradaDoItem({}, '6102'), '2.102')
  assert.equal(cfopEntradaDoItem({}, '7.101'), '3.101')
  assert.equal(cfopEntradaDoItem({}, null), '—')
})

test('dataEntradaDaNota: dRec manda; sem ela, a emissão', () => {
  assert.equal(dataEntradaDaNota('02/10/2026', '2026-09-28'), '2026-10-02')
  assert.equal(dataEntradaDaNota(null, '2026-09-28'), '2026-09-28')
  assert.equal(dataEntradaDaNota('lixo', '2026-09-28'), '2026-09-28')
})

test('ufDaChave', () => {
  assert.equal(ufDaChave(CHAVE_BA), 'BA')
  assert.equal(ufDaChave(CHAVE_SP), 'SP')
  assert.equal(ufDaChave(null), '')
})

test('montarLivro: nota com 2 CFOPs vira 2 linhas; impostos somados por CFOP; fora do mês, cancelada e etapa 40 ficam fora', () => {
  const notas = [
    nota({ id: 1 }),                                                     // entrou 02/10 (emitida em setembro): outubro
    nota({ id: 2, numero: '200', dRec: '15/09/2026', emissao: '2026-09-14' }), // setembro: fora
    nota({ id: 3, numero: '300', cancelada: true }),
    nota({ id: 4, numero: '400', etapa: '40' }),
    nota({ id: 5, numero: '500', chave: CHAVE_SP, dRec: '31/10/2026', emissao: '2026-10-30' }),
  ]
  const itens = [
    item(1, '5.102', { itensCabec: { vTotalItem: 100 }, itensICMS: { nBC: 100, nValor: 18 }, itensPIS: { nValPIS: 1.65 }, itensCOFINS: { nValCOFINS: 7.6 } }),
    item(1, '5.102', { itensCabec: { vTotalItem: 50.5 }, itensICMS: { nBC: 50, nValor: 9 } }),
    item(1, '5.405', { itensCabec: { vTotalItem: 30 }, itensICMSST: { nValorST: 4.2 }, itensIPI: { nValIPI: 1.5 } }),
    item(2, '5.102', { itensCabec: { vTotalItem: 999 } }),
    item(3, '5.102', { itensCabec: { vTotalItem: 999 } }),
    item(4, '5.102', { itensCabec: { vTotalItem: 999 } }),
    item(5, '6.102', {}, 80),                                            // sem full_object: usa v_total_item
  ]
  const r = montarLivro(notas, itens, '2026-10')
  assert.deepEqual(r.linhas.map((l: { numero: string; cfop: string }) => `${l.numero}:${l.cfop}`), ['123:1.102', '123:1.405', '500:2.102'])
  const l1 = r.linhas[0]
  assert.equal(l1.valorContabil, 150.5)
  assert.equal(l1.baseIcms, 150)
  assert.equal(l1.icms, 27)
  assert.equal(l1.pis, 1.65)
  assert.equal(l1.cofins, 7.6)
  assert.equal(l1.dataEntrada, '2026-10-02')
  assert.equal(l1.uf, 'BA')
  assert.equal(r.linhas[1].icmsSt, 4.2)
  assert.equal(r.linhas[1].ipi, 1.5)
  assert.equal(r.linhas[2].valorContabil, 80)
  assert.equal(r.linhas[2].uf, 'SP')
  assert.equal(r.total.valorContabil, 260.5)
  assert.equal(r.total.notas, 2)
  assert.deepEqual(r.totaisCfop.map((t: { cfop: string; valorContabil: number }) => [t.cfop, t.valorContabil]), [['1.102', 150.5], ['1.405', 30], ['2.102', 80]])
})

test('montarLivro: nota sem item entra com o valor da nota e CFOP em branco', () => {
  const r = montarLivro([nota({ id: 9, valorNota: 42 })], [], '2026-10')
  assert.equal(r.linhas.length, 1)
  assert.equal(r.linhas[0].valorContabil, 42)
  assert.equal(r.linhas[0].cfop, '—')
})
