import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardapiosQueUsam, eventosQueUsam } from './relacoes-puro.ts'

const usos = new Map([[10, 0.2], [20, 0.05]]) // prato 10 usa 0,2 kg; preparação 20 usa 0,05 kg

test('cardápios: só os que têm prato que usa, quantidade pelas porções, ativos primeiro', () => {
  const r = cardapiosQueUsam(usos, [{ id: 1, nome: 'Salão', ativo: true }, { id: 2, nome: 'Antigo', ativo: false }, { id: 3, nome: 'Bar', ativo: true }],
    [{ cardapioId: 1, codigo: 10, porcoes: 2 }, { cardapioId: 1, codigo: 99, porcoes: 1 }, { cardapioId: 2, codigo: 20, porcoes: 1 }, { cardapioId: 3, codigo: 99, porcoes: 1 }])
  assert.deepEqual(r.map((c) => [c.id, c.quantidade]), [[1, 0.4], [2, 0.05]])
})

test('eventos: convidados × porções por convidado × uso × folga, por data', () => {
  const r = eventosQueUsam(usos, [
    { id: 7, nome: 'Casamento', data: '2026-12-01', status: 'confirmado', convidados: 100, folgaPct: 10 },
    { id: 8, nome: 'Aniversário', data: '2026-11-20', status: 'orcamento', convidados: 20, folgaPct: 0 },
    { id: 9, nome: 'Sem o insumo', data: '2026-11-15', status: 'orcamento', convidados: 20, folgaPct: 0 },
  ], [{ eventoId: 7, codigo: 10, porcoesPorConvidado: 1 }, { eventoId: 7, codigo: 20, porcoesPorConvidado: 0.5 }, { eventoId: 8, codigo: 10, porcoesPorConvidado: 1 }, { eventoId: 9, codigo: 99, porcoesPorConvidado: 1 }])
  assert.deepEqual(r.map((e) => [e.id, e.quantidade]), [[8, 4], [7, 24.75]])
})
