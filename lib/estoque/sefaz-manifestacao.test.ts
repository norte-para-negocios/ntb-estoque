import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarEventoManifestacao, validarJustificativa, decidirEnvioManifestacao, resultadoManifestacao, lerRetornoManifestacao, MANIFESTACOES, type EstadoManifestacao } from './sefaz-manifestacao.ts'

const CH = '29260999111222000149550220001310551123456781', ODARA = '66764497000122', T0 = new Date('2026-10-19T13:00:00Z')
test('evento 210240 com justificativa sem acento e escapada', () => {
  const { xml, id } = montarEventoManifestacao({ chave: CH, cnpj: ODARA, tpAmb: 1, tipo: '210240', justificativa: 'Mercadoria não foi entregue & devolvida', agora: T0 })
  assert.equal(id, `ID210240${CH}01`)
  assert.ok(xml.includes('<tpEvento>210240</tpEvento>') && xml.includes('<dhEvento>2026-10-19T10:00:00-03:00</dhEvento>'))
  assert.ok(xml.includes('<detEvento versao="1.00"><descEvento>Operacao nao Realizada</descEvento><xJust>Mercadoria nao foi entregue &amp; devolvida</xJust></detEvento>'))
  assert.ok(xml.includes(`<infEvento Id="ID210240${CH}01"><cOrgao>91</cOrgao><tpAmb>1</tpAmb><CNPJ>${ODARA}</CNPJ><chNFe>${CH}</chNFe>`))
})
test('confirmação e desconhecimento sem xJust; justificativa curta recusada', () => {
  assert.ok(!montarEventoManifestacao({ chave: CH, cnpj: ODARA, tpAmb: 1, tipo: '210200', agora: T0 }).xml.includes('xJust'))
  assert.ok(montarEventoManifestacao({ chave: CH, cnpj: ODARA, tpAmb: 1, tipo: '210220', agora: T0 }).xml.includes('<descEvento>Desconhecimento da Operacao</descEvento>'))
  assert.ok(validarJustificativa('210240', 'não veio')); assert.equal(validarJustificativa('210240', 'Mercadoria nao foi entregue'), null); assert.equal(validarJustificativa('210200', null), null)
  assert.ok(validarJustificativa('210240', 'x'.repeat(256)))
  assert.throws(() => montarEventoManifestacao({ chave: CH, cnpj: ODARA, tpAmb: 1, tipo: '210240', justificativa: 'curta', agora: T0 }), /justificativa/i)
  assert.equal(MANIFESTACOES['210200'].rotulo, 'Confirmar a operação')
})
test('decidirEnvioManifestacao: em andamento bloqueia, sem resposta reenvia o mesmo tipo', () => {
  const e = (tp: string, status: EstadoManifestacao['status'], min: number) => ({ tp_evento: tp, status, criado_em: new Date(T0.getTime() - min * 60000).toISOString() })
  assert.deepEqual(decidirEnvioManifestacao([], '210200', T0), { acao: 'enviar' })
  assert.deepEqual(decidirEnvioManifestacao([e('210210', 'registrada', 600)], '210200', T0), { acao: 'enviar' })
  assert.equal(decidirEnvioManifestacao([e('210200', 'enviando', 1)], '210200', T0).acao, 'bloquear')
  assert.deepEqual(decidirEnvioManifestacao([e('210200', 'enviando', 6)], '210200', T0), { acao: 'reenviar' })
  assert.deepEqual(decidirEnvioManifestacao([e('210240', 'incerta', 1)], '210240', T0), { acao: 'reenviar' })
  assert.equal(decidirEnvioManifestacao([e('210240', 'incerta', 1)], '210200', T0).acao, 'bloquear')
  assert.deepEqual(decidirEnvioManifestacao([e('210200', 'registrada', 60)], '210240', T0), { acao: 'bloquear', motivo: 'Esta nota já foi manifestada na SEFAZ: Confirmar a operação.' })
  assert.deepEqual(decidirEnvioManifestacao([e('210220', 'recusada', 60)], '210220', T0), { acao: 'enviar' })
})
test('573 (duplicidade) conta como registrada', () => {
  assert.equal(resultadoManifestacao('573'), 'registrada'); assert.equal(resultadoManifestacao('596'), 'recusada'); assert.equal(resultadoManifestacao(null), 'recusada')
  assert.equal(resultadoManifestacao('135'), 'registrada'); assert.equal(resultadoManifestacao('136'), 'registrada')
})
test('lerRetornoManifestacao: cStat, motivo e protocolo do evento (não o do lote)', () => {
  const ret = '<soap:Envelope><soap:Body><nfeRecepcaoEventoNFResult><retEnvEvento versao="1.00"><idLote>1</idLote><tpAmb>1</tpAmb><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo>' +
    '<retEvento versao="1.00"><infEvento><tpAmb>1</tpAmb><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>' + CH + '</chNFe><tpEvento>210200</tpEvento><nProt>891260000000123</nProt></infEvento></retEvento></retEnvEvento></nfeRecepcaoEventoNFResult></soap:Body></soap:Envelope>'
  assert.deepEqual(lerRetornoManifestacao(ret), { cStat: '135', xMotivo: 'Evento registrado e vinculado a NF-e', protocolo: '891260000000123' })
})
