import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarHistoricoNF } from './nf-historico.ts'

const vazio = { documentos: [], eventos: [], manifestacoes: [], canceladaEm: null }

test('histórico da nota: SEFAZ, conferência, estoque e manifestação em ordem', () => {
  const h = montarHistoricoNF({
    documentos: [{ tipo: 'resNFe', recebido_em: '2026-10-19T12:00:00Z', ciencia_em: '2026-10-19T12:05:00Z', ciencia_cstat: '135', busca_chave_em: null, erro: null, ignorado: null },
                 { tipo: 'procNFe', recebido_em: '2026-10-19T12:20:00Z', ciencia_em: null, ciencia_cstat: null, busca_chave_em: null, erro: null, ignorado: null }],
    eventos: [{ tipo: 'item_configurado', linha: 3, detalhe: { de: { codigo_local_estoque: 2746972551 }, para: { codigo_local_estoque: 2746972605 } }, autor: 'Ramon', criado_em: '2026-10-19T13:00:00Z' },
              { tipo: 'conferida', linha: null, detalhe: {}, autor: 'Ramon', criado_em: '2026-10-19T13:05:00Z' },
              { tipo: 'lancada', linha: null, detalhe: { lancados: 3, ignorados: 0, pendentes: 0 }, autor: 'Ramon', criado_em: '2026-10-19T13:06:00Z' }],
    manifestacoes: [{ tp_evento: '210200', status: 'registrada', cstat: '135', protocolo: '891260000000123', autor: 'Ramon', criado_em: '2026-10-19T13:10:00Z', respondido_em: '2026-10-19T13:10:02Z' }],
    canceladaEm: null,
  })
  assert.deepEqual(h.map((e) => e.texto), [
    'Resumo da nota recebido da SEFAZ', 'Ciência da operação registrada na SEFAZ (135)', 'XML completo recebido da SEFAZ',
    'Item 3 alterado', 'Conferida', 'Entrada no estoque: 3 itens', 'Confirmação da operação registrada na SEFAZ (135, protocolo 891260000000123)'])
  assert.equal(h[4].autor, 'Ramon'); assert.equal(h[6].tom, 'ok')
})
test('item alterado diz o que mudou; nomes dos locais quando conhecidos', () => {
  const h = montarHistoricoNF({ ...vazio, nomesLocais: { 2746972551: '01 - BAR', 2746972605: '02 - COZINHA' },
    eventos: [{ tipo: 'item_configurado', linha: 3, detalhe: { de: { codigo_local_estoque: 2746972551, custo_flags: 'NNNNNNNN' }, para: { codigo_local_estoque: 2746972605, custo_flags: 'SSSSSSSS' } }, autor: null, criado_em: '2026-10-19T13:00:00Z' }] })
  assert.equal(h[0].detalhe, 'local: 01 - BAR → 02 - COZINHA; marcações de custo: NNNNNNNN → SSSSSSSS')
})
test('recusa, envio sem resposta, documento ignorado e nota cancelada', () => {
  const h = montarHistoricoNF({
    documentos: [{ tipo: 'procNFe', recebido_em: '2026-10-19T12:00:00Z', ciencia_em: null, ciencia_cstat: null, busca_chave_em: null, erro: null, ignorado: 'Nota de homologação (teste): não entra no estoque.' }],
    eventos: [{ tipo: 'estornada', linha: null, detalhe: { estornados: 1 }, autor: 'Ana', criado_em: '2026-10-19T14:00:00Z' }],
    manifestacoes: [{ tp_evento: '210240', status: 'incerta', cstat: null, protocolo: null, autor: 'Ana', criado_em: '2026-10-19T13:00:00Z', respondido_em: null },
                    { tp_evento: '210220', status: 'recusada', cstat: '596', protocolo: null, autor: 'Ana', criado_em: '2026-10-19T13:30:00Z', respondido_em: '2026-10-19T13:30:01Z' }],
    canceladaEm: '2026-10-19T15:00:00Z',
  })
  assert.deepEqual(h.map((e) => [e.texto, e.tom]), [
    ['Documento ignorado: Nota de homologação (teste): não entra no estoque.', 'warn'],
    ['Operação não realizada sem resposta da SEFAZ (repita o envio)', 'warn'],
    ['Desconhecimento da operação recusado pela SEFAZ (596)', 'err'],
    ['Entrada desfeita: 1 item', 'warn'],
    ['Nota cancelada na SEFAZ', 'err']])
})
