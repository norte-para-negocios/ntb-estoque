import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { lerRetornoDist, montarPedidoDistNsu, proximaConsulta, ESPERA_SEM_DOCUMENTO_MS } from './sefaz-distdfe.ts'

const docz = (nsu: string, schema: string, conteudo: string) => `<docZip NSU="${nsu}" schema="${schema}">${gzipSync(Buffer.from(conteudo)).toString('base64')}</docZip>`
const RET = `<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cStat>138</cStat><xMotivo>Documento(s) localizado(s)</xMotivo><ultNSU>000000000000747</ultNSU><maxNSU>000000000000800</maxNSU><loteDistDFeInt>${docz('000000000000746', 'procNFe_v4.00.xsd', '<nfeProc><NFe/></nfeProc>')}${docz('000000000000747', 'resNFe_v1.01.xsd', '<resNFe/>')}</loteDistDFeInt></retDistDFeInt>`

test('monta o pedido por NSU com zeros à esquerda e valida o CNPJ', () => {
  const x = montarPedidoDistNsu('11.222.333/0001-44', 1, '747')
  assert.match(x, /<ultNSU>000000000000747<\/ultNSU>/)
  assert.match(x, /<CNPJ>11222333000144<\/CNPJ>/)
  assert.throws(() => montarPedidoDistNsu('123', 1, '0'), /CNPJ/)
})

test('lê a resposta, descompacta os docZip e separa nota completa de resumo', () => {
  const r = lerRetornoDist(RET)
  assert.equal(r.cStat, '138'); assert.equal(r.ultNsu, '000000000000747'); assert.equal(r.docs.length, 2)
  assert.equal(r.docs[0].xml, '<nfeProc><NFe/></nfeProc>'); assert.equal(r.docs[0].completo, true)
  assert.equal(r.docs[1].completo, false)
})

test('continua enquanto há NSU a buscar; espera 1 hora quando não há novidade ou consumo indevido', () => {
  assert.deepEqual(proximaConsulta(lerRetornoDist(RET), 1000), { continuarJa: true, esperarAte: null })
  const fim = lerRetornoDist(RET.replace('000000000000800', '000000000000747'))
  assert.equal(proximaConsulta(fim, 1000).esperarAte, 1000 + ESPERA_SEM_DOCUMENTO_MS)
  const semDoc = lerRetornoDist('<retDistDFeInt><cStat>137</cStat><xMotivo>Nenhum documento localizado</xMotivo><ultNSU>0</ultNSU><maxNSU>0</maxNSU></retDistDFeInt>')
  assert.equal(proximaConsulta(semDoc, 5).continuarJa, false)
  const abuso = lerRetornoDist('<retDistDFeInt><cStat>656</cStat><xMotivo>Consumo Indevido</xMotivo><ultNSU>0</ultNSU><maxNSU>0</maxNSU></retDistDFeInt>')
  assert.equal(proximaConsulta(abuso, 5).esperarAte, 5 + ESPERA_SEM_DOCUMENTO_MS)
})
