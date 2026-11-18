// F-13: o servidor e a 1ª renderização do navegador têm de desenhar igual, mesmo com "reduzir movimento" ligado.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { useMovimentoReduzido, lerServidor } from './movimento-reduzido.ts'

function Sonda() {
  return React.createElement('i', null, String(useMovimentoReduzido()))
}

test('servidor desenha como "movimento normal" mesmo que o sistema peça para reduzir', () => {
  ;(globalThis as { window?: unknown }).window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) }
  try {
    assert.equal(renderToString(React.createElement(Sonda)), '<i>false</i>')
  } finally {
    delete (globalThis as { window?: unknown }).window
  }
  assert.equal(lerServidor(), false)
})

test('CentralView não usa mais useReducedMotion do motion (nulo no servidor, valor real no navegador)', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, 'CentralView.tsx'), 'utf8')
  assert.doesNotMatch(src, /useReducedMotion/)
  assert.match(src, /useMovimentoReduzido/)
})
