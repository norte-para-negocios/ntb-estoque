import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-ignore: import com .ts exigido pelo node --test
import { crc32, criarZip, nomeSeguro } from './zip.ts'

test('o ZIP abre no unzip, CRC confere e o conteúdo volta igual (texto, acento, binário e repetido)', () => {
  const xml = '<?xml version="1.0"?><nfeProc>' + 'x'.repeat(5000) + '</nfeProc>'
  const bin = new Uint8Array([0, 1, 2, 250, 255, 7])
  const zip = criarZip([
    { nome: 'xml/NFe-1.xml', dados: xml },
    { nome: 'LEIA-ME.txt', dados: 'Pacote de setembro — ação' },
    { nome: 'bin.dat', dados: bin },
    { nome: 'LEIA-ME.txt', dados: 'segundo' },
  ])
  const dir = mkdtempSync(join(tmpdir(), 'zip-teste-'))
  const arq = join(dir, 'p.zip')
  writeFileSync(arq, zip)
  const lista = execFileSync('unzip', ['-t', arq]).toString()
  assert.match(lista, /No errors detected/)
  execFileSync('unzip', ['-q', arq, '-d', join(dir, 'out')])
  assert.equal(readFileSync(join(dir, 'out', 'xml', 'NFe-1.xml'), 'utf8'), xml)
  assert.equal(readFileSync(join(dir, 'out', 'LEIA-ME.txt'), 'utf8'), 'Pacote de setembro — ação')
  assert.equal(readFileSync(join(dir, 'out', 'LEIA-ME-2.txt'), 'utf8'), 'segundo')
  assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'out', 'bin.dat'))), bin)
})

test('nomeSeguro tira caminho absoluto, .. e barra invertida', () => {
  assert.equal(nomeSeguro('/etc/passwd'), 'etc/passwd')
  assert.equal(nomeSeguro('../../x.xml'), 'x.xml')
  assert.equal(nomeSeguro('a\\b.txt'), 'a/b.txt')
  assert.equal(nomeSeguro(''), 'arquivo')
})

test('ZIP vazio é válido', () => {
  const z = criarZip([])
  assert.equal(z.length, 22)
  assert.equal(z.readUInt32LE(0), 0x06054b50)
})

test('crc32 confere com o valor de referência', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
})

test('nomes repetidos viram -2, -3 (não -2-3)', () => {
  const z = criarZip([{ nome: 'x.xml', dados: 'a' }, { nome: 'x.xml', dados: 'b' }, { nome: 'x.xml', dados: 'c' }, { nome: 'sem', dados: 'd' }, { nome: 'sem', dados: 'e' }])
  const nomes: string[] = []
  for (let i = z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); i >= 0; i = z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), i + 4)) {
    const n = z.readUInt16LE(i + 28)
    nomes.push(z.subarray(i + 46, i + 46 + n).toString('utf8'))
  }
  assert.deepEqual(nomes, ['x.xml', 'x-2.xml', 'x-3.xml', 'sem', 'sem-2'])
})
