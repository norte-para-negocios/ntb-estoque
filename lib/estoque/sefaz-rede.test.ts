import { test } from 'node:test'
import assert from 'node:assert/strict'
import { certificadoFolha } from './sefaz-rede.ts'

test('assinatura do evento usa só o certificado da loja, não a cadeia (senão a SEFAZ devolve 225)', () => {
  const folha = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----'
  const ac = '-----BEGIN CERTIFICATE-----\nBBBB\n-----END CERTIFICATE-----'
  assert.equal(certificadoFolha(`${folha}\n${ac}\n${ac}`), folha)
  assert.equal(certificadoFolha(folha), folha)
})

test('consulta pela chave (consChNFe) depois da ciência', async () => {
  const { montarPedidoDistChave } = await import('./sefaz-distdfe.ts')
  const x = montarPedidoDistChave('66.764.497/0001-22', 1, '29261015103070000576550010001658951343816704')
  assert.match(x, /<tpAmb>1<\/tpAmb><cUFAutor>29<\/cUFAutor><CNPJ>66764497000122<\/CNPJ><consChNFe><chNFe>29261015103070000576550010001658951343816704<\/chNFe><\/consChNFe>/)
  assert.throws(() => montarPedidoDistChave('66764497000122', 1, '123'), /Chave/)
})
