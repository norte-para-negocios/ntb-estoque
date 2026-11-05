// Fase 1 (03/11/2026): nos adaptadores que fazem o ledger do estoque próprio andar, toda leitura do Supabase checa `error`.
// Erro de leitura que vira lista vazia já baixou prato sem consumir insumo (auditoria 03, achado 5.1). Este teste falha se
// algum desses arquivos desestruturar `data` de um `await` sem pegar `error` na mesma desestruturação.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aqui = dirname(fileURLToPath(import.meta.url))
const ARQUIVOS = [
  'venda-proprio.ts', 'sefaz-sync.ts', 'catalogo-sync.ts', 'op-proprio.ts', 'transferencia-proprio.ts',
  // Fase 3 (05/11/2026): o modo da loja decide o caminho (próprio x Omie) e as telas de estoque próprio gravam no ledger.
  'ledger.ts', 'lotes.ts', '../actions/estoque-proprio.ts', '../actions/inventario-proprio.ts', '../actions/validade-proprio.ts',
]

/** Desestruturações `{ ... } = await` (ou `[{ ... }, { ... }] = await Promise.all`) que trazem `data` e não trazem `error`. */
export function leiturasSemErro(fonte: string): { linha: number; texto: string }[] {
  const achados: { linha: number; texto: string }[] = []
  const semErro = (corpo: string) => {
    const campos = corpo.split(',').map((c) => c.trim().split(/\s*:\s*/)[0])
    return campos.includes('data') && !campos.includes('error')
  }
  const anotar = (indice: number) => {
    const linha = fonte.slice(0, indice).split('\n').length
    achados.push({ linha, texto: fonte.split('\n')[linha - 1].trim() })
  }
  for (const m of fonte.matchAll(/\{([^{}]*)\}\s*=\s*await\b/g)) if (semErro(m[1])) anotar(m.index!)
  for (const m of fonte.matchAll(/\[([^\[\]]*)\]\s*=\s*await\b/g)) {
    if ([...m[1].matchAll(/\{([^{}]*)\}/g)].some((g) => semErro(g[1]))) anotar(m.index!)
  }
  return achados
}

test('detector: pega data sem error e aceita data com error', () => {
  assert.equal(leiturasSemErro('const { data } = await sb.from("x")').length, 1)
  assert.equal(leiturasSemErro('let { data: nsu } = await sb.from("x")').length, 1)
  assert.equal(leiturasSemErro('const { data: a, count } = await sb.from("x")').length, 1)
  assert.equal(leiturasSemErro('const { data: a, error: e } = await sb.from("x")').length, 0)
  assert.equal(leiturasSemErro('const { data, error } = await sb.rpc("x")').length, 0)
  assert.equal(leiturasSemErro('const { error } = await sb.from("x").update({})').length, 0)
  assert.equal(leiturasSemErro('const [{ data: a, error: e }, { data: b }] = await Promise.all([])').length, 1)
  assert.equal(leiturasSemErro('const [{ data: a, error: e }, { data: b, error: f }] = await Promise.all([])').length, 0)
})

for (const arq of ARQUIVOS) {
  test(`${arq}: nenhuma leitura ignora error`, () => {
    const achados = leiturasSemErro(readFileSync(join(aqui, arq), 'utf8'))
    assert.deepEqual(achados, [], `leituras sem error em ${arq}:\n${achados.map((a) => `  ${a.linha}: ${a.texto}`).join('\n')}`)
  })
}
