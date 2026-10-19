import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  anexosPermitidos, caminhoAnexo, origemAceita, cabecalhoDownload, limparNome, tipoPorConteudo, validarAnexo,
  LIMITE_ANEXO_BYTES, MAX_ANEXOS_POR_REGISTRO,
} from './anexos-puro.ts'

const bytes = (s: string | number[]) => (typeof s === 'string' ? new TextEncoder().encode(s) : new Uint8Array(s))
const PDF = bytes('%PDF-1.7\n%âãÏÓ\n1 0 obj')
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const JPG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46])
const WEBP = bytes([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50])
const ZIP = bytes([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0])
const EXE = bytes([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0])

test('tipoPorConteudo reconhece pelo conteúdo, não pelo nome', () => {
  assert.equal(tipoPorConteudo(PDF, 'boleto.pdf')?.mime, 'application/pdf')
  assert.equal(tipoPorConteudo(PNG, 'foto.png')?.mime, 'image/png')
  assert.equal(tipoPorConteudo(JPG, 'foto.JPEG')?.mime, 'image/jpeg')
  assert.equal(tipoPorConteudo(WEBP, 'foto.webp')?.mime, 'image/webp')
  assert.equal(tipoPorConteudo(ZIP, 'planilha.xlsx')?.mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  assert.equal(tipoPorConteudo(ZIP, 'contrato.docx')?.ext, 'docx')
  assert.equal(tipoPorConteudo(bytes('<?xml version="1.0"?><nfeProc/>'), 'nota.xml')?.mime, 'application/xml')
  assert.equal(tipoPorConteudo(bytes('codigo;descricao\n1;Tomate'), 'lista.csv')?.mime, 'text/csv')
  assert.equal(tipoPorConteudo(bytes('anotação'), 'obs.txt')?.mime, 'text/plain')
})

test('tipoPorConteudo recusa executável renomeado, zip qualquer e extensão que não confere', () => {
  assert.equal(tipoPorConteudo(EXE, 'nota.pdf'), null)
  assert.equal(tipoPorConteudo(ZIP, 'pacote.zip'), null)
  assert.equal(tipoPorConteudo(PNG, 'nota.pdf'), null)
  assert.equal(tipoPorConteudo(bytes([0x41, 0, 0x42]), 'texto.txt'), null) // binário com byte nulo
  assert.equal(tipoPorConteudo(PDF, 'sem-extensao'), null)
})

test('validarAnexo: limite de tamanho, quantidade por registro e vazio', () => {
  assert.deepEqual(validarAnexo({ nome: 'a.pdf', tamanho: PDF.length, bytes: PDF, existentes: 0 }).ok, true)
  const grande = validarAnexo({ nome: 'a.pdf', tamanho: LIMITE_ANEXO_BYTES + 1, bytes: PDF, existentes: 0 })
  assert.equal(grande.ok, false)
  if (!grande.ok) assert.match(grande.erro, /8 MB/)
  const cheio = validarAnexo({ nome: 'a.pdf', tamanho: 10, bytes: PDF, existentes: MAX_ANEXOS_POR_REGISTRO })
  assert.equal(cheio.ok, false)
  assert.equal(validarAnexo({ nome: 'a.pdf', tamanho: 0, bytes: new Uint8Array(), existentes: 0 }).ok, false)
  const exe = validarAnexo({ nome: 'virus.pdf', tamanho: EXE.length, bytes: EXE, existentes: 0 })
  assert.equal(exe.ok, false)
})

test('limparNome tira caminho e caracteres de controle, mantém acento e extensão', () => {
  assert.equal(limparNome('../../etc/passwd'), 'passwd')
  assert.equal(limparNome('C:\\Users\\ana\\Nota fiscal nº 12.pdf'), 'Nota fiscal nº 12.pdf')
  assert.equal(limparNome('a\u0000b<script>.pdf'), 'ab_script_.pdf')
  assert.equal(limparNome('   '), 'arquivo')
  assert.equal(limparNome(`${'x'.repeat(300)}.pdf`).length, 120)
  assert.ok(limparNome(`${'x'.repeat(300)}.pdf`).endsWith('.pdf'))
})

test('caminhoAnexo nunca usa o nome do usuário (só ascii) e começa pela pasta da loja', () => {
  assert.equal(caminhoAnexo(15, 'nota_entrada', 321, '0f0e', 'pdf'), 'loja-15/nota_entrada/321/0f0e.pdf')
})

test('cabecalhoDownload: attachment com nome ascii e UTF-8', () => {
  assert.equal(cabecalhoDownload('Nota nº 1.pdf', false), `attachment; filename="Nota n_ 1.pdf"; filename*=UTF-8''Nota%20n%C2%BA%201.pdf`)
  assert.match(cabecalhoDownload('a.pdf', true), /^inline;/)
})

test('origemAceita: só a própria origem', () => {
  assert.equal(origemAceita('https://app-estoque.norteparanegocios.com.br', 'app-estoque.norteparanegocios.com.br'), true)
  assert.equal(origemAceita('https://evil.example', 'app-estoque.norteparanegocios.com.br'), false)
  assert.equal(origemAceita('null', 'x'), false)
  assert.equal(origemAceita(null, 'x'), true)
})

test('anexos só no estoque próprio nesta fase', () => {
  assert.equal(anexosPermitidos('proprio'), true)
  assert.equal(anexosPermitidos('omie'), false)
  assert.equal(anexosPermitidos(null), false)
})
