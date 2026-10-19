// Smoke do pacote do contador (sem banco): livro de entradas em Excel e PDF, Bloco H em Excel e o ZIP com tudo.
// Uso: npx tsx scripts/smoke-pacote-contador.tsx [saida.zip]   (depois: unzip -t saida.zip)
import { writeFileSync } from 'node:fs'
import { montarLivro } from '../lib/contador/livro-entradas-puro'
import { montarPosicao } from '../lib/relatorios/posicao-estoque-puro'
import { criarZip } from '../lib/contador/zip'
import { pdfLivro, planilhaBlocoH, planilhaLivro } from '../lib/contador/pacote'

async function main() {
  const chave = '29' + '1'.repeat(42)
  const notas = [{ id: 1, numero: '123', serie: '1', modelo: '55', chave, emissao: '2026-09-28', dRec: '02/10/2026', etapa: '60', cancelada: false, fornecedor: 'HORTIFRUTI TESTE', cnpj: '00000000000191', origem: 'sefaz' }]
  const itens = [
    { notaId: 1, cfopNota: '5.102', fo: { itensCabec: { vTotalItem: 100 }, itensICMS: { nBC: 100, nValor: 18 } }, vTotalItem: null },
    { notaId: 1, cfopNota: '5.405', fo: { itensCabec: { vTotalItem: 30 }, itensICMSST: { nValorST: 4.2 } }, vTotalItem: null },
  ]
  const livro = { ...montarLivro(notas, itens, '2026-10'), notas, ini: '2026-10-01', fim: '2026-10-31', erros: [] as string[] }
  const pos = montarPosicao(
    [{ n_cod_prod: 501, codigo_local_estoque: 1, n_saldo: 6, n_cmc: 15, reservado: 0 }, { n_cod_prod: 502, codigo_local_estoque: 1, n_saldo: -1, n_cmc: 3, reservado: 0 }],
    [{ codigo_produto: 501, codigo: '80501', descricao: 'TOMATE', familia: null, tipo: '01', unidade: 'KG', ncm: '07020000', inativo: false },
     { codigo_produto: 502, codigo: '90502', descricao: 'SUCO', familia: null, tipo: '00', unidade: 'UN', ncm: '22029900', inativo: false }],
    new Map([[1, { descricao: 'DEPOSITO', padrao: true }]]),
    { ver: 'sped', zerados: false, inativos: true, tipos: [], familias: [], q: '' })
  const bloco = { ...pos, modo: 'proprio' as const, dataPedida: '2026-09-30', dataFoto: '2026-09-30', erros: [] as string[] }
  const [xls, pdf, bh] = await Promise.all([planilhaLivro(livro, 'Loja Teste', '2026-10'), pdfLivro(livro, 'Loja Teste', '2026-10'), planilhaBlocoH(bloco, 'Loja Teste')])
  const zip = criarZip([
    { nome: 'LEIA-ME.txt', dados: 'teste' }, { nome: 'livro-de-entradas.xlsx', dados: xls }, { nome: 'livro-de-entradas.pdf', dados: pdf },
    { nome: 'inventario-bloco-h-2026-09-30.xlsx', dados: bh }, { nome: `xml-nfe-entrada/NFe${chave}.xml`, dados: '<nfeProc/>' },
  ])
  if (process.argv[2]) writeFileSync(process.argv[2], zip)
  console.log(`livro: ${livro.linhas.length} linhas, total ${livro.total.valorContabil}; bloco H: ${bloco.linhas.length} produto(s); zip ${zip.length} bytes (xlsx ${xls.length}, pdf ${pdf.length}, bloco ${bh.length})`)
}
main().catch((e) => { console.error(e); process.exit(1) })
