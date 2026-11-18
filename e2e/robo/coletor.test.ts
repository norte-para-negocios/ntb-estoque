import fs from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { coletar } from './coletor.ts'

// Prova que o coletor enxerga os defeitos de verdade (página sintética, sem tocar no ERP).
test('coletor acha texto cortado, estouro horizontal e inventaria botões sem clicar', { skip: !fs.existsSync(chromium.executablePath()) && 'Chromium do Playwright não instalado (npx playwright install chromium)' }, async () => {
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 800, height: 600 } })
  await p.setContent(`<main>
    <h1>Tela de teste</h1>
    <div id="cortado" style="width:80px;overflow:hidden;white-space:nowrap">Texto bem comprido que não cabe aqui dentro</div>
    <div style="width:80px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Texto comprido com reticências propositais</div>
    <div style="width:2000px;height:5px;background:red"></div>
    <button onclick="document.title='CLICOU'">Excluir tudo</button><button>Buscar 12</button>
    <a href="/x">Ver</a></main>`)
  const r = await p.evaluate(coletar)
  assert.equal(r.totalCortados, 1)
  assert.match(r.cortados[0], /Texto bem comprido/)
  assert.equal(r.estouro, true)
  assert.deepEqual(r.acoes.map((a) => `${a.tipo}:${a.texto}`).sort(), ['botão:Buscar #', 'botão:Excluir tudo', 'link:Ver'])
  assert.equal(await p.title(), '') // o coletor não clicou em nada
  await b.close()
})
