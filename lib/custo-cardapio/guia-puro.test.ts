import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  caminhoFoto, escalarNos, formatarTempo, fotoEhDe, hrefGuia, lerContexto, lerEscala, LIMITE_FOTO_BYTES, normalizarBusca, passosDoTexto,
  porcoesCardapio, porcoesEvento, preparacoesNecessarias, tipoDaFoto, validarFoto, validarReceita, type NoQtd,
} from './guia-puro.ts'

test('passosDoTexto: uma linha por passo, tira numeração e linhas vazias', () => {
  assert.deepEqual(passosDoTexto('1. Picar a cebola\n\n2) Refogar   no azeite\r\nPasso 3: Juntar o arroz\n- Servir\n• Decorar'),
    ['Picar a cebola', 'Refogar no azeite', 'Juntar o arroz', 'Servir', 'Decorar'])
  assert.deepEqual(passosDoTexto(null), [])
  assert.deepEqual(passosDoTexto('   \n  '), [])
  // número que faz parte do texto fica
  assert.deepEqual(passosDoTexto('200 g de manteiga derretida'), ['200 g de manteiga derretida'])
  assert.deepEqual(passosDoTexto('3º - Assar por 20 min'), ['Assar por 20 min'])
})

test('validarReceita: normaliza, aceita vazio e recusa fora dos limites', () => {
  const r = validarReceita({ modoPreparo: '  a\n\n\n\nb  ', observacoes: '', tempoPreparoMin: '45', rendimentoTexto: ' 10   porções ' })
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual(r.row, { modo_preparo: 'a\n\nb', observacoes: null, tempo_preparo_min: 45, rendimento_texto: '10 porções' })
  const vazio = validarReceita({ modoPreparo: '', observacoes: '  ', tempoPreparoMin: '', rendimentoTexto: '' })
  assert.ok(vazio.ok && vazio.row.tempo_preparo_min === null && vazio.row.modo_preparo === null)
  assert.equal(validarReceita({ modoPreparo: '', observacoes: '', tempoPreparoMin: '1,5', rendimentoTexto: '' }).ok, false)
  assert.equal(validarReceita({ modoPreparo: '', observacoes: '', tempoPreparoMin: -1, rendimentoTexto: '' }).ok, false)
  assert.equal(validarReceita({ modoPreparo: '', observacoes: '', tempoPreparoMin: 10001, rendimentoTexto: '' }).ok, false)
  assert.equal(validarReceita({ modoPreparo: 'x'.repeat(20001), observacoes: '', tempoPreparoMin: null, rendimentoTexto: '' }).ok, false)
  assert.equal(validarReceita({ modoPreparo: '', observacoes: 'x'.repeat(5001), tempoPreparoMin: null, rendimentoTexto: '' }).ok, false)
  assert.equal(validarReceita({ modoPreparo: '', observacoes: '', tempoPreparoMin: null, rendimentoTexto: 'x'.repeat(201) }).ok, false)
})

test('formatarTempo', () => {
  assert.equal(formatarTempo(45), '45 min')
  assert.equal(formatarTempo(60), '1 h')
  assert.equal(formatarTempo(90), '1 h 30 min')
  assert.equal(formatarTempo(0), null)
  assert.equal(formatarTempo(null), null)
})

test('tipoDaFoto e validarFoto pelo conteúdo', () => {
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])
  const webp = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0))))
  assert.equal(tipoDaFoto(jpg)?.ext, 'jpg')
  assert.equal(tipoDaFoto(png)?.mime, 'image/png')
  assert.equal(tipoDaFoto(webp)?.ext, 'webp')
  assert.equal(tipoDaFoto(new TextEncoder().encode('GIF89a......')), null)
  assert.equal(validarFoto(new Uint8Array()).ok, false)
  assert.equal(validarFoto(new TextEncoder().encode('%PDF-1.4')).ok, false)
  const grande = new Uint8Array(LIMITE_FOTO_BYTES + 1); grande.set(jpg)
  assert.equal(validarFoto(grande).ok, false)
  assert.ok(validarFoto(jpg).ok)
})

test('caminho da foto e checagem de dono', () => {
  const c = caminhoFoto(5, 123, 1700000000000, 'jpg')
  assert.equal(c, '5/123-1700000000000.jpg')
  assert.ok(fotoEhDe(c, 5, 123))
  assert.equal(fotoEhDe(c, 15, 123), false)
  assert.equal(fotoEhDe(c, 5, 12), false)
  assert.equal(fotoEhDe('5/123-1.jpg/../../x', 5, 123), false)
  assert.equal(fotoEhDe(null, 5, 123), false)
})

test('porções: evento com folga e cardápio', () => {
  assert.equal(porcoesEvento(100, 1.5, 10), 165)
  assert.equal(porcoesEvento(80, 1, 0), 80)
  assert.equal(porcoesEvento(-1, 1, 0), 0)
  assert.equal(porcoesCardapio(2.5), 2.5)
  assert.equal(porcoesCardapio(null), 1)
  assert.equal(porcoesCardapio('0'), 1)
})

const no = (codigo: number, quantidade: number, filhos: NoQtd[] = []): NoQtd => ({ codigo, quantidade, temFicha: filhos.length > 0, filhos })

test('escalarNos multiplica a árvore inteira sem mexer na original', () => {
  const a = [no(1, 0.2, [no(2, 0.05), no(3, 0.1)]), no(4, 2)]
  const b = escalarNos(a, 3)
  assert.equal(b[0].quantidade, 0.6)
  assert.equal(b[0].filhos[0].quantidade, 0.15)
  assert.equal(b[1].quantidade, 6)
  assert.equal(a[0].quantidade, 0.2)
  assert.equal(escalarNos(a, 1), a)
  assert.equal(escalarNos(a, NaN), a)
})

test('preparacoesNecessarias soma as preparações de todas as árvores, inclusive aninhadas', () => {
  const molho = (q: number) => no(10, q, [no(11, q / 2), no(20, q / 4, [no(21, 1)])])
  const m = preparacoesNecessarias([[molho(0.4), no(5, 1)], [molho(0.6)]])
  assert.deepEqual([...m.entries()], [[10, 1], [20, 0.25]])
})

test('lerEscala, lerContexto e normalizarBusca', () => {
  assert.equal(lerEscala('2,5'), 2.5)
  assert.equal(lerEscala('0'), 1)
  assert.equal(lerEscala('abc'), 1)
  assert.deepEqual(lerContexto('e12'), { tipo: 'evento', id: 12 })
  assert.deepEqual(lerContexto('c3'), { tipo: 'cardapio', id: 3 })
  assert.equal(lerContexto('x3'), null)
  assert.equal(lerContexto('e0'), null)
  assert.equal(lerContexto(undefined), null)
  assert.equal(normalizarBusca('  Feijão TROPEIRO '), 'feijao tropeiro')
})

test('hrefGuia mantém o contexto', () => {
  assert.equal(hrefGuia({}), '/cozinha/guia')
  assert.equal(hrefGuia({ ctx: 'e3', p: 10, b: 0.1 + 0.2, passados: true }), '/cozinha/guia?ctx=e3&p=10&b=0.3&passados=1')
  assert.equal(hrefGuia({ p: 5, b: 0 }), '/cozinha/guia?p=5')
})
