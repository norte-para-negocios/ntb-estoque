// F-06: /log só abre para Admin (igual ao item do menu). Teste estático: a guarda tem de vir antes de qualquer leitura.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const raiz = path.join(import.meta.dirname, '..')
const pagina = fs.readFileSync(path.join(raiz, 'app', '(app)', 'log', 'page.tsx'), 'utf8')
const menu = fs.readFileSync(path.join(raiz, 'components', 'shell', 'NavItems.ts'), 'utf8')

test('/log: página dá 404 a quem não é Admin, antes de ler integration_attempts', () => {
  const guarda = pagina.search(/if \(!admin\) notFound\(\)/)
  assert.ok(guarda > 0, 'falta a guarda isAdmin + notFound')
  assert.ok(guarda < pagina.indexOf("from('integration_attempts')"), 'a guarda tem de vir antes da primeira leitura')
})

test('/log: o menu continua só para Admin', () => {
  assert.match(menu, /href: '\/log'[^}]*admin: true/)
})
