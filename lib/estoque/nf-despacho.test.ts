// Regressão (06/10/2026): Notas Fiscais em loja de estoque próprio nunca chega no Omie, e o modo 'omie' segue o caminho de sempre.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const semComentarios = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
function corpoDe(src: string, nome: string): string {
  const i = src.indexOf(`export async function ${nome}(`)
  assert.ok(i >= 0, `função ${nome} não encontrada`)
  const prox = src.indexOf('\nexport async function ', i + 10)
  return src.slice(i, prox < 0 ? undefined : prox)
}

for (const [fn, omie] of [['manifestarNF', 'concluirRecebimento('], ['reverterManifestacaoNF', 'reverterRecebimento('], ['excluirRecebimentoNF', 'excluirRecebimento(']] as const) {
  test(`${fn}: o modo próprio é despachado antes de qualquer chamada ao Omie`, () => {
    const corpo = corpoDe(ler('lib/actions/nota-fiscal.ts'), fn)
    const iModo = corpo.indexOf("modoDaLoja(")
    assert.ok(iModo >= 0, 'sem despacho por modo')
    assert.ok(corpo.indexOf(omie) < 0 || iModo < corpo.indexOf(omie), 'o Omie é chamado antes do despacho')
  })
}

test('sync manual de notas: loja própria usa a SEFAZ e só o modo omie chega no syncNotasFiscais', () => {
  const src = ler('app/api/sync/notas-fiscais/route.ts')
  const iProprio = src.indexOf("=== 'proprio'"), iOmie = src.indexOf('syncNotasFiscais(loja')
  assert.ok(iProprio >= 0 && iProprio < iOmie)
})

test('as peças da SEFAZ e da nota em loja própria nunca importam o Omie', () => {
  for (const f of ['lib/estoque/sefaz-sync.ts', 'lib/estoque/sefaz-rede.ts', 'lib/estoque/sefaz-certificado.ts', 'lib/estoque/nf-sefaz.ts', 'lib/estoque/nf-frio.ts', 'lib/actions/nota-fiscal-proprio.ts']) {
    const src = semComentarios(ler(f))
    assert.ok(!/from ['"]@\/lib\/omie\//.test(src.replace(/@\/lib\/omie\/sync-all/g, '')), `${f} importa o Omie`)
    assert.ok(!/omieRequest|IncluirAjuste|ListarRecebimentos/.test(src), `${f} chama o Omie`)
  }
})

test('o cron do Omie de notas continua usando só lojas com chave do Omie (loja própria não tem chave)', () => {
  const src = ler('lib/omie/sync-all.ts')
  assert.ok(src.includes(".not('omie_app_key', 'is', null)"))
})

test('a consulta à SEFAZ só fala com hosts fazenda.gov.br e nunca emite nem cancela', () => {
  const src = semComentarios(ler('lib/estoque/sefaz-rede.ts'))
  assert.ok(src.includes('fazenda\\.gov\\.br'))
  assert.ok(!/NFeAutorizacao|NFeRetAutorizacao|110111/.test(src))
})
