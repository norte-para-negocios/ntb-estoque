import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TOPICOS_WEBHOOK_PROTEGIDOS, MODELOS_LOG_PROTEGIDOS } from './prune-regras.ts'

test('protege os rastros que têm leitor vivo', () => {
  assert.ok(TOPICOS_WEBHOOK_PROTEGIDOS.includes('RecebimentoProduto.%'))
  for (const m of ['ImportarNFCe%', 'IncluirNfce%', 'ExcluirCupom%', 'OrdemProducao']) assert.ok((MODELOS_LOG_PROTEGIDOS as readonly string[]).includes(m), m)
})

test('toda exclusão do prune passa pelos protegidos (helper em lotes)', () => {
  const src = readFileSync(new URL('../../app/api/cron/prune/route.ts', import.meta.url), 'utf8')
  assert.match(src, /TOPICOS_WEBHOOK_PROTEGIDOS/)
  assert.match(src, /MODELOS_LOG_PROTEGIDOS/)
  // nunca toca nas tabelas de negócio
  for (const t of ['notas_fiscais', 'ordens_producao', 'movimentos', 'estoque_movimentos']) assert.ok(!src.includes(`'${t}'`), t)
})
