import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerConfigCompras, linkWhatsapp, montarWhatsapp, separarWhatsapp, validarConfigCompras, whatsappLegivel } from './config-puro.ts'

test('lerConfigCompras: padrão e valores fora da regra', () => {
  assert.deepEqual(lerConfigCompras(null), { coberturaDias: 7, whatsappCompras: null, diaContagem: null })
  assert.deepEqual(lerConfigCompras({ cobertura_dias: 14, whatsapp_compras: '5571999999999', dia_contagem: 1 }), { coberturaDias: 14, whatsappCompras: '5571999999999', diaContagem: 1 })
  assert.deepEqual(lerConfigCompras({ cobertura_dias: 0, whatsapp_compras: '123', dia_contagem: 9 }), { coberturaDias: 7, whatsappCompras: null, diaContagem: null })
})

test('montarWhatsapp: junta o código do país, não duplica o 55 e aceita máscara', () => {
  assert.equal(montarWhatsapp('55', '(71) 99999-9999'), '5571999999999')
  assert.equal(montarWhatsapp('55', '5571999999999'), '5571999999999')
  assert.equal(montarWhatsapp('', '71 99999-9999'), '5571999999999')
  // DDD 55 (RS) sem o código do país não é confundido com ele
  assert.equal(montarWhatsapp('55', '55 99999-9999'), '5555999999999')
  assert.equal(montarWhatsapp('1', '415 555 1234'), '14155551234')
  assert.equal(montarWhatsapp('55', '  '), null)
})

test('separarWhatsapp devolve o que montarWhatsapp montou', () => {
  const s = separarWhatsapp('5571999999999')
  assert.deepEqual(s, { ddi: '55', numero: '71999999999' })
  assert.equal(montarWhatsapp(s.ddi, s.numero), '5571999999999')
  assert.deepEqual(separarWhatsapp(null), { ddi: '55', numero: '' })
})

test('validarConfigCompras: cobertura 1–90 inteira, WhatsApp 10–15 dígitos, dia 0–6 ou vazio', () => {
  assert.deepEqual(validarConfigCompras({ coberturaDias: 7, whatsappCompras: '5571999999999', diaContagem: 0 }), [])
  assert.deepEqual(validarConfigCompras({ coberturaDias: 90, whatsappCompras: null, diaContagem: null }), [])
  assert.equal(validarConfigCompras({ coberturaDias: 91, whatsappCompras: null, diaContagem: null }).length, 1)
  assert.equal(validarConfigCompras({ coberturaDias: 2.5, whatsappCompras: null, diaContagem: null }).length, 1)
  assert.equal(validarConfigCompras({ coberturaDias: 7, whatsappCompras: '+5571999999999', diaContagem: null }).length, 1)
  assert.equal(validarConfigCompras({ coberturaDias: 7, whatsappCompras: '123456789', diaContagem: null }).length, 1)
  assert.equal(validarConfigCompras({ coberturaDias: 7, whatsappCompras: null, diaContagem: 7 }).length, 1)
})

test('link e número legível', () => {
  assert.equal(linkWhatsapp('5571999999999', 'Olá & tchau'), 'https://wa.me/5571999999999?text=Ol%C3%A1%20%26%20tchau')
  assert.equal(linkWhatsapp(null, 'x'), 'https://wa.me/?text=x')
  assert.equal(whatsappLegivel('5571999999999'), '+55 71 99999-9999')
  assert.equal(whatsappLegivel('14155551234'), '+14155551234')
})
