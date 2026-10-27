// Regressão do modo Omie na Fase B (entrada de NF completa no estoque próprio): lê o código-fonte e falha se algum caminho
// das lojas Omie (2–7) mudar. Helpers copiados de nf-despacho.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { custoEstoqueItemOmie, entradaCustoDoItem } from '../compras/custo-estoque-item.ts'

const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const semComentarios = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
function corpoDe(src: string, nome: string): string {
  const i = src.indexOf(`export async function ${nome}(`)
  assert.ok(i >= 0, `função ${nome} não encontrada`)
  const prox = src.indexOf('\nexport async function ', i + 10)
  return src.slice(i, prox < 0 ? undefined : prox)
}

test('ações novas da nota recusam loja que não é própria antes de tudo', () => {
  const src = ler('lib/actions/nota-fiscal-proprio.ts')
  // contexto() começa por modoDaLoja(lojaId) !== 'proprio'
  assert.ok(/async function contexto[\s\S]*?modoDaLoja\(lojaId\)\) !== 'proprio'/.test(src))
  for (const fn of ['configurarItemNF', 'marcarConferidaNF', 'salvarObservacaoNF', 'manifestarNotaSefaz', 'importarCteNF', 'informarFreteNF', 'desvincularCteNF', 'buscarNotaPorChaveNF']) {
    const corpo = corpoDe(src, fn)
    assert.ok(/await contexto\(/.test(corpo), `${fn} sem contexto() (despacho por modo)`)
    const iCtx = corpo.indexOf('await contexto(')
    assert.ok(!/createServiceClient\(|\.rpc\(/.test(corpo.slice(0, iCtx)), `${fn} toca no banco antes do despacho por modo`)
  }
})
test('peças novas nunca importam nem chamam o Omie', () => {
  for (const f of ['lib/estoque/nf-item-regras.ts', 'lib/estoque/nf-memoria.ts', 'lib/estoque/nfe-validacao.ts', 'lib/estoque/nfe-assinatura.ts', 'lib/estoque/sefaz-manifestacao.ts', 'lib/estoque/sefaz-manifestacao-tipos.ts', 'lib/estoque/cte-xml.ts', 'lib/estoque/nf-etapas.ts', 'lib/estoque/nf-historico.ts', 'lib/estoque/nf-entrada.ts', 'lib/estoque/sefaz-busca-chave.ts'])
    assert.ok(!/@\/lib\/omie\/|omieRequest|Recebimento\(/.test(semComentarios(ler(f))), f)
})
test('manifestarNF do Omie continua chamando concluirRecebimento depois do despacho por modo', () => {
  const corpo = corpoDe(ler('lib/actions/nota-fiscal.ts'), 'manifestarNF')
  assert.ok(corpo.includes('concluirRecebimento(nf.loja, Number(nf.n_id_receb))') && corpo.includes('modoDaLoja('))
})
test('ItensNotaFiscal: colunas novas só leem full_object.itensAjustes (sem consulta, sem edição)', () => {
  const src = ler('components/nota-fiscal/ItensNotaFiscal.tsx')
  assert.ok(src.includes('cCFOPEntrada') && src.includes('cNaoGerarMovEstoque') && !/from\(['"]compras_proprio/.test(src))
  assert.ok(!/configurarItemNF|nota-fiscal-proprio/.test(src))
})
test('etapas e histórico novos só aparecem em loja própria', () => {
  assert.ok(ler('app/(app)/nota-fiscal/etapas/page.tsx').includes("redirect('/nota-fiscal')"))
  assert.ok(/proprio \? \[[\s\S]*HistoricoProcessamentoNF[\s\S]*HistoricoStatusNF/.test(ler('app/(app)/nota-fiscal/[id]/page.tsx')))
})
test('tela da nota: manifestação, CT-e e observações só dentro do ramo da loja própria; DetalhesFiscais novo só com semOmie', () => {
  const page = ler('app/(app)/nota-fiscal/[id]/page.tsx')
  // As seções recolhidas da tela (27/10/2026) são montadas numa lista só: ramo da loja própria até o '] : [' do Omie.
  const iProprio = page.indexOf('const secoes: SecaoNota[] = proprio ? [')
  const iOmie = page.indexOf('] : [\n', iProprio)
  assert.ok(iProprio > 0 && iOmie > iProprio, 'lista de seções por modo não encontrada')
  for (const comp of ['<ManifestacaoNF', '<FreteCteNF', '<ObservacaoNF', '<HistoricoProcessamentoNF']) {
    const i = page.indexOf(comp)
    assert.ok(i > iProprio && i < iOmie, `${comp} fora do ramo da loja própria`)
  }
  assert.ok(page.includes('podeManifestar={podeManifestar && !proprio}'))
  const det = ler('components/nota-fiscal/DetalhesFiscaisNF.tsx')
  assert.ok(/semOmie && totais\?\.vTotalNFe/.test(det) && /\{semOmie && \(\s*<>/.test(det))
})
test('sync do Omie e webhook não usam nada da Fase B', () => {
  for (const f of ['lib/omie/nota-fiscal.ts', 'app/api/webhook/route.ts', 'lib/omie/sync-all.ts'])
    assert.ok(!/nf-item-regras|configurar_item_compra|projetar_itens_compra_na_nota|sefaz-manifestacao|cte-xml/.test(ler(f)), f)
})
test('custo de item do Omie (sem bloco sefaz) igual ao da Fase A, inclusive com Frete/Seguro = S', () => {
  const N = { cICMSCusto: 'N', cICMSSTCusto: 'N', cIPICusto: 'N', cPISCusto: 'N', cCOFINSCusto: 'N', cOutrosDespCusto: 'N', cFreteCusto: 'N', cSeguroCusto: 'N', nAliqCredPISCusto: 0, nAliqCredCOFINSCusto: 0 }
  // H2O 90015 da NF 131055 (kardex 24 × 4,164167) e ÁGUA C/ GÁS 90001 (144 × 1,214167)
  for (const [fo, q, p, esperado] of [
    [{ itensCabec: { vTotalItem: 109.88, vDesconto: 0 }, itensIPI: { nValIPI: 1.58 }, itensCustoEstoque: N }, 2, 49.971587, 99.94],
    [{ itensCabec: { vTotalItem: 189.23 }, itensCustoEstoque: { ...N, cFreteCusto: 'S', cSeguroCusto: 'S' } }, 12, 14.570054, 174.84],
  ] as const) {
    assert.equal(custoEstoqueItemOmie(entradaCustoDoItem(fo, q, p)).valorEstoque, esperado)
  }
})
