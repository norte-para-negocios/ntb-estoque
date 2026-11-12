// Foto das ações guardadas que PASSAM com o módulo suspenso ('consulta'). Lê lib/actions/*.ts, extrai cada
// guardaModulo('<arquivo>#<acao>') e confere que o conjunto que passa é exatamente a lista revisada abaixo.
// Ação nova que passe em suspenso quebra este teste: só entra na lista se for leitura de verdade; se escreve,
// acrescente o verbo em VERBOS_ESCRITA ou o nome em ESCRITAS_EXTRA (lib/plataforma/acoes-modulo.ts).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
// @ts-expect-error: o node --test (type stripping) exige a extensão .ts; o tsc do Next não a aceita
import { barraAcao } from './acoes-modulo.ts'
// @ts-expect-error: idem
import { politicaDe } from '../offline/politica.ts'

// Revisadas uma a uma (12/11/2026): nenhuma grava dado de negócio.
const PASSAM_EM_CONSULTA = [
  'catalogo-proprio#carregarProdutoCatalogo',
  'catalogo-proprio#listarGrupos',
  'compras-proprio#buscarProdutosCompra',
  'compras-proprio#previaXml',
  'detalhe-movimento#buscarDetalheInventario',
  'detalhe-movimento#buscarDetalheNotaFiscal',
  'detalhe-movimento#buscarDetalheOP',
  'detalhe-movimento#buscarDetalheTransferencia',
  'estrutura#verEstrutura',
  // grava só a linha de rascunho da prévia (importacoes_planilha); a confirmação é barrada
  'importacao#previaImportacao',
  'importar-pedidos#previaImportacaoPedidos',
  'inventario-proprio#buscarProdutosParaContagem',
  'movimentacoes-proprio#detalheMovimentoProprio',
  // conferência antes de emitir: só lê
  'nfe-saida#conferirNfeSaida',
  'nota-fiscal-proprio#buscarNotaPorChaveNF',
  'nota-fiscal-proprio#buscarProdutosNF',
  'ordem-producao#saldoAtualProdutos',
  'periodo-fechado#pendenciasDoMes',
  'produto#buscarFamilias',
  'produto#sugerirProximoCodigo',
  'produtos-search#buscarProdutoPorCodigo',
  'produtos-search#buscarProdutos',
  'sintegra#consultarCnpj',
]

function guardadas(): string[] {
  const dir = path.join(import.meta.dirname, '..', 'actions')
  const nomes: string[] = []
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort()) {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/guardaModulo\('([^']+)'\)/g)) nomes.push(m[1])
  }
  return nomes
}

test('há ações guardadas', () => {
  assert.ok(guardadas().length > 100)
})

test('em suspenso só passam as leituras revisadas', () => {
  const passam = guardadas().filter((n) => !barraAcao('consulta', politicaDe(n), n)).sort()
  assert.deepEqual(passam, [...PASSAM_EM_CONSULTA].sort())
})
