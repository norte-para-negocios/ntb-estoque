import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error: import com .ts exigido pelo node --test
import { _padroes128, chaveEmGrupos, code128C, dadosDanfe, docFormatado } from './danfe-puro.ts'
// @ts-expect-error: idem
import { montarNfe } from './nfe-puro.ts'
// @ts-expect-error: idem
import { montarProcNFe } from './sefaz-puro.ts'
// @ts-expect-error: idem
import { dadosDevolucao } from './exemplos.ts'

test('tabela CODE-128: 106 símbolos de 11 módulos, todos diferentes; parada de 13', () => {
  assert.equal(_padroes128.P128.length, 106)
  for (const p of _padroes128.P128) assert.equal(p.split('').reduce((a: number, x: string) => a + Number(x), 0), 11, p)
  assert.equal(new Set(_padroes128.P128).size, 106)
  assert.equal(_padroes128.STOP.split('').reduce((a: number, x: string) => a + Number(x), 0), 13)
})

test('CODE-128C da chave: início C, 22 pares, dígito de controle e parada', () => {
  const chave = '29261011222333000181559200000000071481516230'
  const l = code128C(chave)
  // (1 início + 22 dados + 1 controle) × 6 larguras + 7 da parada
  assert.equal(l.length, 24 * 6 + 7)
  assert.equal(l.reduce((a: number, x: number) => a + x, 0), 24 * 11 + 13)
  assert.deepEqual(l.slice(0, 6), [2, 1, 1, 2, 3, 2]) // Start C
  // exemplo clássico: "1234" → 105 + 12·1 + 34·2 = 185 → 185 % 103 = 82
  const k = code128C('1234')
  assert.deepEqual(k.slice(18, 24), _padroes128.P128[82].split('').map(Number))
  assert.throws(() => code128C('123'))
})

test('dados do DANFE saem do procNFe (devolução com referência e IPI devolvido)', () => {
  const { xml, chave } = montarNfe(dadosDevolucao(2))
  const prot = `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${chave}</chNFe><dhRecbto>2026-10-20T10:15:05-03:00</dhRecbto><nProt>129260000000001</nProt><cStat>100</cStat></infProt></protNFe>`
  const d = dadosDanfe(montarProcNFe(xml, prot))
  assert.equal(d.chave, chave)
  assert.equal(d.protocolo, '129260000000001')
  assert.equal(d.finNFe, '4')
  assert.equal(d.itens.length, 2)
  assert.equal(d.itens[0].cst, '0900')
  assert.equal(d.totais.vIPIDevol, 30)
  assert.equal(d.refs.length, 1)
  assert.equal(chaveEmGrupos('12345678'), '1234 5678')
  assert.equal(docFormatado('11222333000181'), '11.222.333/0001-81')
})
