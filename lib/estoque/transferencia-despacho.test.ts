// Regressão do modo (06/10/2026), em nível de código-fonte: loja 'omie' segue o caminho de sempre e loja 'proprio' nunca chega a
// nenhuma chamada do Omie nas ações de Transferência e de Locais de Estoque. Confere a ORDEM no texto de cada função.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

function corpoDe(src: string, nome: string): string {
  const i = src.indexOf(`export async function ${nome}(`)
  assert.ok(i >= 0, `função ${nome} não encontrada`)
  const prox = src.indexOf('\nexport async function ', i + 10)
  return src.slice(i, prox < 0 ? undefined : prox)
}

const CHAMADAS_OMIE = ['processarMovimento(', 'excluirAjusteEstoque(', 'omieRequest(', 'getPosicaoProduto(']

const acoes = [
  'enviarMovimento',
  'removeMovimento',
  'finishTransferencia',
  'forceSyncTransferencia',
  'excluirTransferencia',
  'editQuantidadeMovimento',
]

for (const nome of acoes) {
  test(`${nome}: o modo é checado antes de qualquer chamada ao Omie`, () => {
    const corpo = corpoDe(ler('lib/actions/transferencia.ts'), nome)
    const iModo = corpo.indexOf("modoDaLoja(lojaId)) === 'proprio'")
    assert.ok(iModo >= 0, 'sem despacho por modo')
    for (const chamada of CHAMADAS_OMIE) {
      const i = corpo.indexOf(chamada)
      assert.ok(i < 0 || iModo < i, `o Omie (${chamada}) é chamado antes do despacho por modo`)
    }
  })
}

test('o ramo proprio de cada ação devolve antes de ler a loja do Omie', () => {
  const src = ler('lib/actions/transferencia.ts')
  for (const nome of ['finishTransferencia', 'forceSyncTransferencia', 'excluirTransferencia']) {
    const corpo = corpoDe(src, nome)
    assert.ok(corpo.indexOf("modoDaLoja(lojaId)) === 'proprio'") < corpo.indexOf('omie_app_key'), `${nome} lê a chave do Omie antes do modo`)
  }
})

test('o módulo de transferência do modo proprio nunca importa o Omie', () => {
  const src = ler('lib/estoque/transferencia-proprio.ts').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(src, /from ['"][^'"]*omie[^'"]*['"]/i)
  assert.doesNotMatch(src, /omieRequest/)
})

test('a tela de Estoque transfere pelo mesmo fluxo da tela de Transferências (documento + par no ledger)', () => {
  const src = ler('lib/actions/estoque-proprio.ts')
  const corpo = corpoDe(src, 'transferirEntreLocais')
  assert.match(corpo, /transferenciaRapida\(/)
  assert.doesNotMatch(corpo, /\btransferir\(\{/, 'não deve chamar o ledger direto, sem documento')
})

test('o RPC de lançamento da transferência é atômico e idempotente por versão (migration 138)', () => {
  const sql = ler('supabase/migrations/138_transferencia_proprio.sql')
  assert.match(sql, /create or replace function public\.lancar_transferencia_item/)
  assert.match(sql, /'trf:' \|\| p_movimento \|\| ':v'/)
  assert.match(sql, /trf_desfazer_lancamento\(p_loja, mv\.ledger_ref/)
  assert.match(sql, /case when m\.tipo = 'TRF' then 'TRF' else 'EST' end/, 'estorno de perna de transferência não vira EST (custo inalterado)')
})

test('Locais de Estoque: excluir local com movimento é recusado só no modo proprio', () => {
  const corpo = corpoDe(ler('lib/actions/local-estoque.ts'), 'excluirLocalEstoque')
  assert.match(corpo, /modoDaLoja\(lojaId\)\) === 'proprio'/)
  assert.match(corpo, /localTemMovimento\(/)
})

test('Locais de Estoque: criar e editar despacham por modo antes do Omie e aceitam os campos completos', () => {
  const src = ler('lib/actions/local-estoque.ts')
  for (const [nome, omie] of [['criarLocalEstoque', 'incluirLocalEstoque('], ['editarLocalEstoque', 'alterarLocalEstoque(']] as const) {
    const corpo = corpoDe(src, nome)
    assert.ok(corpo.indexOf('modoDaLoja(') < corpo.indexOf(omie))
  }
  const drv = ler('lib/estoque/proprio-driver.ts')
  for (const campo of ['disp_venda', 'disp_consumo_op', 'disp_ordem_producao', 'disp_remessa', 'tipo', 'padrao', 'inativo']) {
    assert.match(drv, new RegExp(campo), `driver sem ${campo}`)
  }
})
