import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Regressão do modo omie: a tela Validade só troca para os lotes em loja 'proprio', ANTES de qualquer leitura das OPs do Omie.
test('Validade: desvio para lotes vem antes da leitura de ordens_producao', () => {
  const fonte = readFileSync('app/(app)/validade/page.tsx', 'utf8')
  const desvio = fonte.indexOf("=== 'proprio') return <ValidadeProprio")
  const omie = fonte.indexOf(".from('ordens_producao')")
  assert.ok(desvio > 0, 'desvio por modo existe')
  assert.ok(omie > desvio, 'leitura do Omie continua depois do desvio')
})

test('Início: alertas por lote só em loja própria; o caminho do Omie segue igual', () => {
  const fonte = readFileSync('app/(app)/home/page.tsx', 'utf8')
  assert.match(fonte, /if \(homeProprio && pode\('Validade'\)\) \{[\s\S]*resumoValidade\([\s\S]*\} else \{[\s\S]*qtdVencidos > 0/)
})

test('Compra manual leva lote/validade pela função com lotes', () => {
  const fonte = readFileSync('lib/actions/compras-proprio.ts', 'utf8')
  assert.match(fonte, /rpc\('lancar_compra_com_lotes'/)
})
