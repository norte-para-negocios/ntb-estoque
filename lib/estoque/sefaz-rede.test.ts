import { test } from 'node:test'
import assert from 'node:assert/strict'
import { certificadoFolha } from './sefaz-rede.ts'

test('assinatura do evento usa só o certificado da loja, não a cadeia (senão a SEFAZ devolve 225)', () => {
  const folha = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----'
  const ac = '-----BEGIN CERTIFICATE-----\nBBBB\n-----END CERTIFICATE-----'
  assert.equal(certificadoFolha(`${folha}\n${ac}\n${ac}`), folha)
  assert.equal(certificadoFolha(folha), folha)
})
