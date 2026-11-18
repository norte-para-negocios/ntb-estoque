import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerTabelaFalhas, causaDe, consolidar, formatarListaFinal, escolherRodada, caminhoDoPrint, type FalhaRastreada } from './consolidador.ts'

const base = (o: Partial<FalhaRastreada>): FalhaRastreada => ({
  gravidade: 2, loja: 'Sertão', cargo: 'dono', tela: '/x', passo: 'abrir /x', esperado: 'e', mostrado: 'm', print: 'prints/x.png',
  robo: 'passeio', ticket: '02', rodada: 'r6', pastaSaida: 'robo', ...o,
})

const MD_PADRAO = `# Falhas do robô

Logins: 3

| Gravidade | Loja | Cargo | Tela | Passo | Esperado | Mostrado | Print |
|---|---|---|---|---|---|---|---|
| 1 conta errada | ODARA | dono | /relatorio-cmv | CMV do mês 2026-11 | R$ 14.213,53 | R$ 14.154,62 \\| decomposição: a \\| b ⏎ linha 2 | prints/15-cmv.png |
| 2 trava/erro | Loja 19 | gerente | /movimentacoes | abrir /movimentacoes | console sem erros | Encountered two children with the same key | prints/19-g.png |
`

const MD_PERMISSOES = `# Furos de permissão

| Gravidade | Loja | Cargo | Onde | Passo | Esperado | Mostrado | Print |
|---|---|---|---|---|---|---|---|
| 1 | Loja 19 | estoquista | /log | abrir /log direto pelo endereço | bloqueada | abriu (abriu) | prints/19-estoquista-log.png |
`

test('lerTabelaFalhas: lê a tabela padrão, desfaz o escape de barra e pula cabeçalho e separador', () => {
  const r = lerTabelaFalhas(MD_PADRAO)
  assert.equal(r.length, 2)
  assert.equal(r[0].gravidade, 1)
  assert.equal(r[0].loja, 'ODARA')
  assert.equal(r[0].tela, '/relatorio-cmv')
  assert.equal(r[0].mostrado, 'R$ 14.154,62 | decomposição: a | b ⏎ linha 2')
  assert.equal(r[0].print, 'prints/15-cmv.png')
  assert.equal(r[1].gravidade, 2)
})

test('lerTabelaFalhas: aceita o formato do robô de permissões (gravidade só "1", coluna Onde)', () => {
  const r = lerTabelaFalhas(MD_PERMISSOES)
  assert.equal(r.length, 1)
  assert.equal(r[0].gravidade, 1)
  assert.equal(r[0].tela, '/log')
  assert.equal(r[0].cargo, 'estoquista')
})

test('lerTabelaFalhas: sem falhas devolve lista vazia', () => {
  assert.deepEqual(lerTabelaFalhas('# Falhas\n\nNenhuma falha encontrada.\n'), [])
})

test('causaDe: reconhece as causas conhecidas e usa o mesmo id em lojas diferentes', () => {
  assert.equal(causaDe(base({ tela: '/central/fiscal', mostrado: 'A tree hydrated but some attributes of the server rendered HTML' })).id, 'hidratacao-central')
  assert.equal(causaDe(base({ loja: 'ODARA', tela: '/central', mostrado: 'A tree hydrated but ...' })).id, 'hidratacao-central')
  assert.equal(causaDe(base({ tela: '/movimentacoes', mostrado: 'Encountered two children with the same key, `%s`.' })).id, 'chave-repetida-movimentacoes')
  assert.equal(causaDe(base({ tela: 'GET /api/offline/snapshot?tabela=contas_pagar', gravidade: 1 })).id, 'offline-snapshot')
  assert.equal(causaDe(base({ tela: '/log', gravidade: 1 })).id, 'log-aberto')
  assert.equal(causaDe(base({ tela: '/relatorio-faturamento?periodo=ano_passado' })).id, 'faturamento-cancelados-historico')
  assert.equal(causaDe(base({ tela: '/relatorio-faturamento?ver=diario' })).id, 'frio-paginacao')
  assert.equal(causaDe(base({ tela: '/relatorio-faturamento?ver=diario (API do frio, GET /fat_cupons)' })).id, 'frio-paginacao')
  assert.equal(causaDe(base({ tela: '/relatorio-cmv', passo: 'CMV do mês 2026-11 (Custo real)' })).id, 'cmv-sem-baixa')
  assert.equal(causaDe(base({ tela: '/relatorio-lucro', passo: 'custo (CMV) do mês 2026-11' })).id, 'cmv-sem-baixa')
  assert.equal(causaDe(base({ tela: '/financeiro/contas-pagar', passo: 'títulos a pagar gerados pela nota RB190 (banco)' })).id, 'nota-digitada-sem-titulo')
  assert.equal(causaDe(base({ tela: '/estoque', passo: 'conferir saldo do item 1 x | origem da diferença: Omie (Omie informa -1)' })).id, 'saldo-omie')
  assert.equal(causaDe(base({ tela: '/estoque', passo: 'conferir saldo do item 2 y | origem da diferença: ERP (Omie informa 15)' })).id, 'saldo-inativo')
})

test('causaDe: causa desconhecida agrupa pelo texto sem números nem loja', () => {
  const a = causaDe(base({ loja: 'ODARA', tela: '/foo?x=1', mostrado: 'Erro 500 no item 12' }))
  const b = causaDe(base({ loja: 'Sertão', tela: '/foo?x=2', mostrado: 'Erro 500 no item 99' }))
  assert.equal(a.id, b.id)
  assert.match(a.id, /^outro:/)
  assert.match(a.correcao, /investigar/i)
  assert.notEqual(a.id, causaDe(base({ tela: '/bar', mostrado: 'Erro 500 no item 12' })).id)
})

test('consolidar: mesma causa em várias lojas e cargos vira um item só, com a lista de onde aparece', () => {
  const fs: FalhaRastreada[] = []
  for (const loja of ['Loja 19', 'ODARA', 'Sertão']) for (const tela of ['/central', '/central/fiscal']) {
    fs.push(base({ loja, tela, mostrado: 'A tree hydrated but some attributes' }))
  }
  fs.push(base({ loja: 'Loja 19', cargo: 'gerente', tela: '/movimentacoes', mostrado: 'Encountered two children with the same key' }))
  const itens = consolidar(fs)
  assert.equal(itens.length, 2)
  const h = itens.find((i) => i.causa === 'hidratacao-central')!
  assert.equal(h.ocorrencias, 6)
  assert.deepEqual(h.lojas, ['Loja 19', 'ODARA', 'Sertão'])
  assert.deepEqual(h.telas, ['/central', '/central/fiscal'])
  assert.deepEqual(h.porLoja['ODARA'], ['dono'])
  assert.ok(h.exemplos.length <= 3)
})

test('consolidar: ordena por gravidade, a gravidade do item é a mais alta dos membros, e numera F-01...', () => {
  const itens = consolidar([
    base({ gravidade: 3, tela: '/visual', mostrado: 'texto cortado' }),
    base({ gravidade: 2, tela: '/movimentacoes', mostrado: 'Encountered two children with the same key' }),
    base({ gravidade: 1, tela: '/relatorio-faturamento?ver=diario', mostrado: 'x' }),
    base({ gravidade: 2, tela: '/relatorio-faturamento?ver=diario', mostrado: 'y' }),
  ])
  assert.deepEqual(itens.map((i) => i.codigo), ['F-01', 'F-02', 'F-03'])
  assert.deepEqual(itens.map((i) => i.gravidade), [1, 2, 3])
  assert.equal(itens[0].causa, 'frio-paginacao')
  assert.equal(itens[0].ocorrencias, 2)
})

test('consolidar: ordem estável com entrada embaralhada', () => {
  const fs = [
    base({ loja: 'ODARA', tela: '/foo', mostrado: 'a' }),
    base({ gravidade: 1, tela: '/log' }),
    base({ tela: '/movimentacoes', mostrado: 'Encountered two children with the same key' }),
    base({ gravidade: 3, tela: '/zzz', mostrado: 'b' }),
  ]
  const a = consolidar(fs).map((i) => `${i.codigo}${i.causa}`)
  const b = consolidar([...fs].reverse()).map((i) => `${i.codigo}${i.causa}`)
  assert.deepEqual(a, b)
})

test('caminhoDoPrint: prefixa a pasta da rodada; deixa passar o que não é arquivo', () => {
  assert.equal(caminhoDoPrint(base({ print: 'prints/15-cmv.png', pastaSaida: 'robo-cmv', rodada: 'r5' })), 'robo-cmv/r5/prints/15-cmv.png')
  assert.equal(caminhoDoPrint(base({ print: '(sem tela: resposta HTTP)' })), '(sem tela: resposta HTTP)')
  assert.equal(caminhoDoPrint(base({ print: 'sem print (achado nas notas do ticket 05)', pastaSaida: '' })), 'sem print (achado nas notas do ticket 05)')
})

test('escolherRodada: a pasta mais nova com falhas.md; ignora pasta sem falhas.md', () => {
  const r = escolherRodada([
    { nome: 'dbg1', mtimeMs: 100, temFalhas: true },
    { nome: 'final2', mtimeMs: 300, temFalhas: true },
    { nome: 'vazia', mtimeMs: 900, temFalhas: false },
    { nome: 'final1', mtimeMs: 200, temFalhas: true },
  ])
  assert.equal(r, 'final2')
  assert.equal(escolherRodada([]), null)
})

test('formatarListaFinal: sem duplicata, por gravidade, com os campos pedidos e as seções de ressalva', () => {
  const itens = consolidar([
    base({ gravidade: 1, loja: 'ODARA', tela: '/relatorio-cmv', passo: 'CMV do mês 2026-11', esperado: 'R$ 14.213,53', mostrado: 'R$ 14.154,62', print: 'prints/15-cmv.png', robo: 'cmv', ticket: '08', rodada: 'r5', pastaSaida: 'robo-cmv' }),
    base({ gravidade: 2, loja: 'Loja 19', cargo: 'gerente', tela: '/movimentacoes', mostrado: 'Encountered two children with the same key' }),
    base({ gravidade: 2, loja: 'Loja 19', cargo: 'dono', tela: '/movimentacoes', mostrado: 'Encountered two children with the same key' }),
  ])
  const md = formatarListaFinal(itens, {
    data: '2026-11-18',
    rodadas: [{ robo: 'cmv', ticket: '08', rodada: 'r5', falhas: 1, pasta: 'robo-cmv/r5' }, { robo: 'venda', ticket: '05', rodada: 'r4', falhas: 0, pasta: 'robo-venda/r4' }],
    ressalvas: [{ ticket: '08', titulo: 'CMV', status: 'resolvido com ressalva', ressalvas: ['A lista de produtos mostra 500 linhas'], naoProvado: ['Sertão não tem ficha técnica na cópia'] }],
  })
  assert.match(md, /^# Lista final de falhas do ERP/m)
  assert.match(md, /## Gravidade 1/)
  assert.match(md, /## Gravidade 2/)
  assert.match(md, /### F-01 /)
  assert.match(md, /### F-02 /)
  assert.doesNotMatch(md, /### F-03 /)
  for (const campo of ['Loja:', 'Cargo:', 'Tela:', 'Passo:', 'Esperado:', 'Mostrado:', 'Print:', 'Correção sugerida:']) assert.ok(md.includes(campo), campo)
  assert.ok(md.includes('robo-cmv/r5/prints/15-cmv.png'))
  assert.match(md, /Loja 19: dono, gerente|Loja 19 \(dono, gerente\)/)
  assert.match(md, /Não foi provado/)
  assert.ok(md.includes('Sertão não tem ficha técnica na cópia'))
  assert.ok(md.includes('A lista de produtos mostra 500 linhas'))
  assert.match(md, /robô venda.*0 falhas/s)
  assert.match(md, /nenhuma correção foi feita/i)
})

test('formatarListaFinal: mesma entrada gera o mesmo texto', () => {
  const itens = consolidar([base({ gravidade: 1, tela: '/log' })])
  const ctx = { data: '2026-11-18', rodadas: [], ressalvas: [] }
  assert.equal(formatarListaFinal(itens, ctx), formatarListaFinal(consolidar([base({ gravidade: 1, tela: '/log' })]), ctx))
})

test('formatarListaFinal: lista vazia diz que não achou falha', () => {
  const md = formatarListaFinal([], { data: '2026-11-18', rodadas: [], ressalvas: [] })
  assert.match(md, /Nenhuma falha/)
})
