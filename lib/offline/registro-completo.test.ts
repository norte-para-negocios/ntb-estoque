import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// Toda server action exportada de lib/actions precisa estar em registro-acoes.ts (canal offline do desktop).
// Se falhar: node scripts/inserir-via-desktop.mjs e commitar o que ele gerar.
test('toda export de lib/actions está no registro do desktop', () => {
  const dir = path.join(import.meta.dirname, '..', 'actions')
  const registro = fs.readFileSync(path.join(import.meta.dirname, 'registro-acoes.ts'), 'utf8')
  const faltando: string[] = []
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    if (!/^['"]use server['"]/m.test(src)) continue
    const modulo = f.replace(/\.ts$/, '')
    for (const m of src.matchAll(/^export async function (\w+)/gm)) {
      if (!registro.includes(`'${modulo}#${m[1]}'`) && !registro.includes(`"${modulo}#${m[1]}"`)) faltando.push(`${modulo}#${m[1]}`)
    }
  }
  assert.deepEqual(faltando, [])
})
