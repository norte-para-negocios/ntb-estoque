import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mandaAutor, metodoEscreve } from './autor-puro.ts'

test('metodoEscreve: só escrita leva o autor', () => {
  assert.equal(metodoEscreve(undefined), false)
  assert.equal(metodoEscreve('get'), false)
  assert.equal(metodoEscreve('HEAD'), false)
  assert.equal(metodoEscreve('OPTIONS'), false)
  for (const m of ['POST', 'patch', 'PUT', 'DELETE']) assert.equal(metodoEscreve(m), true)
})

test('mandaAutor: escrita de sync (cliente semAutor ou dentro de semAutor()) nunca leva autor, mesmo com sessão', () => {
  assert.equal(mandaAutor({ metodo: 'POST', clienteSemAutor: false, contextoSemAutor: false }), true)
  assert.equal(mandaAutor({ metodo: 'POST', clienteSemAutor: true, contextoSemAutor: false }), false)
  assert.equal(mandaAutor({ metodo: 'PATCH', clienteSemAutor: false, contextoSemAutor: true }), false)
  assert.equal(mandaAutor({ metodo: 'GET', clienteSemAutor: false, contextoSemAutor: false }), false)
})

// Regressão da revisão da Fase G (I1): o que vem do Omie não pode ser gravado em nome de quem clicou "Atualizar".
const raiz = new URL('../../', import.meta.url).pathname
function arquivos(dir: string, filtro: (f: string) => boolean): string[] {
  return readdirSync(join(raiz, dir)).flatMap((n) => {
    const p = join(dir, n)
    return statSync(join(raiz, p)).isDirectory() ? arquivos(p, filtro) : filtro(n) ? [p] : []
  })
}
const semComentario = (src: string) => src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')

test('lib/omie/*: todo createServiceClient é semAutor', () => {
  for (const f of arquivos('lib/omie', (n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
    const src = semComentario(readFileSync(join(raiz, f), 'utf8'))
    assert.doesNotMatch(src, /createServiceClient\(\s*\)/, `${f} usa createServiceClient() com autor`)
  }
})

test('rotas /api/sync/*: handlers exportados dentro de rotaSemAutor', () => {
  for (const f of arquivos('app/api/sync', (n) => n === 'route.ts')) {
    const src = semComentario(readFileSync(join(raiz, f), 'utf8'))
    assert.doesNotMatch(src, /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/, `${f}: handler fora do rotaSemAutor`)
    assert.match(src, /rotaSemAutor\(/, `${f}: sem rotaSemAutor`)
  }
})

test('reprocessarSync roda o sync dentro de semAutor', () => {
  const src = readFileSync(join(raiz, 'lib/actions/sync-status.ts'), 'utf8')
  assert.match(src, /semAutor\(\(\) => fn\(/)
})

test('sincronizar catálogo do Vendas e buscar na SEFAZ pela tela rodam dentro de semAutor', () => {
  assert.match(readFileSync(join(raiz, 'lib/actions/catalogo-proprio.ts'), 'utf8'), /semAutor\(\(\) => rodarSyncCatalogo\(\)\)/)
  assert.match(readFileSync(join(raiz, 'lib/actions/nota-fiscal-proprio.ts'), 'utf8'), /semAutor\(\(\) => sincronizarSefaz\(/)
})
