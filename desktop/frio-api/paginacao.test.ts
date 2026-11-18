import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Guarda do F-02: todo endpoint do frio-api paginado por LIMIT/OFFSET precisa de
// ORDER BY terminando numa chave única (senão o Postgres repete/pula linhas
// entre páginas). Lê o server.js do repo (cópia da produção).
const fonte = readFileSync(new URL('./server.js', import.meta.url), 'utf8')

// rota -> trecho final obrigatório do order by (chave única da tabela)
const ESPERADO: Record<string, string> = {
  '/notas_fiscais': 'order by d_emissao_nfe desc, id desc',
  '/nota_fiscal_items': 'order by i.id',
  '/ordens_producao': 'order by id desc',
  '/movimentos': 'order by data desc, id desc',
  '/movimentos_historico': 'order by data desc, cod_prod desc, ctid desc',
  '/fat_cupons': 'order by data desc, n_id_cupom desc',
  '/fat_cupom_itens': 'order by i.n_id_cupom, i.id_item',
  '/fat_cupom_pagamentos': 'order by p.n_id_cupom, p.sequencia',
}

function corpoDaRota(rota: string): string {
  const ini = fonte.indexOf(`app.get('${rota}',`)
  assert.ok(ini >= 0, `rota ${rota} não encontrada`)
  const prox = fonte.indexOf('\napp.', ini + 5)
  return fonte.slice(ini, prox < 0 ? undefined : prox)
}

for (const [rota, orderBy] of Object.entries(ESPERADO)) {
  test(`${rota} pagina com desempate único`, () => {
    const corpo = corpoDaRota(rota)
    assert.ok(/offset \$\{off\}/.test(corpo), 'esperava paginação por offset')
    assert.ok(corpo.includes(`${orderBy}\n`) || corpo.includes(`${orderBy} limit`), `order by esperado: ${orderBy}`)
  })
}

test('nenhum LIMIT/OFFSET do arquivo fica sem order by único conhecido', () => {
  const comOffset = [...fonte.matchAll(/app\.get\('([^']+)'[\s\S]*?(?=\napp\.)/g)]
    .filter((m) => /offset \$\{off\}/.test(m[0])).map((m) => m[1])
  assert.deepEqual(comOffset.sort(), Object.keys(ESPERADO).sort())
})
