import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONFIG_PADRAO, bloqueioPagamento, decidirAprovacao, nivelDoUsuario, nivelExigido, aprovacaoAoMudarValor, validarConfig,
} from './aprovacao-puro.ts'

const ligada = { ...CONFIG_PADRAO, ativa: true, ateCent: 1000_00, altoAcimaCent: 5000_00 }

test('padrão do dono: desligada, até R$ 1.000 sem aprovação, acima de R$ 5.000 admin/dono, autor pode aprovar, 45 dias', () => {
  assert.deepEqual(CONFIG_PADRAO, { ativa: false, ateCent: 1000_00, altoAcimaCent: 5000_00, autorPodeAprovar: true, recorrentesDias: 45 })
})

test('nivelExigido: desligada = 0; até X = 0; acima de X = 1 (gerente); acima de Y = 2 (admin/dono)', () => {
  assert.equal(nivelExigido(CONFIG_PADRAO, 999_999_00), 0)
  assert.equal(nivelExigido(ligada, 1000_00), 0)
  assert.equal(nivelExigido(ligada, 1000_01), 1)
  assert.equal(nivelExigido(ligada, 5000_00), 1)
  assert.equal(nivelExigido(ligada, 5000_01), 2)
  // X = 0: toda conta passa por aprovação
  assert.equal(nivelExigido({ ...ligada, ateCent: 0 }, 1), 1)
  // X = Y: não existe faixa do gerente
  assert.equal(nivelExigido({ ...ligada, altoAcimaCent: 1000_00 }, 1000_01), 2)
})

test('validarConfig: Y não pode ficar abaixo de X; valores e dias no intervalo', () => {
  assert.equal(validarConfig(ligada), null)
  assert.match(validarConfig({ ...ligada, altoAcimaCent: 999_00 }) ?? '', /não pode ser menor/)
  assert.match(validarConfig({ ...ligada, ateCent: -1 }) ?? '', /negativ/)
  assert.match(validarConfig({ ...ligada, recorrentesDias: 0 }) ?? '', /dias/)
  assert.match(validarConfig({ ...ligada, recorrentesDias: 367 }) ?? '', /dias/)
  assert.match(validarConfig({ ...ligada, ateCent: Number.NaN }) ?? '', /inválid/)
})

test('nivelDoUsuario: alto valor vale 2, aprovar vale 1, nada vale 0', () => {
  assert.equal(nivelDoUsuario(false, false), 0)
  assert.equal(nivelDoUsuario(true, false), 1)
  assert.equal(nivelDoUsuario(false, true), 2)
  assert.equal(nivelDoUsuario(true, true), 2)
})

test('decidirAprovacao: só conta pendente, nível suficiente, motivo na reprovação, autor conforme a config', () => {
  const t = { aprovacao: 'pendente' as const, nivel: 2, criadoPor: 'u1', cancelada: false }
  assert.equal(decidirAprovacao(t, { nivel: 2, userId: 'u2' }, 'aprovar', '', true), null)
  assert.match(decidirAprovacao(t, { nivel: 1, userId: 'u2' }, 'aprovar', '', true) ?? '', /admin|dono/i)
  assert.match(decidirAprovacao({ ...t, nivel: 1 }, { nivel: 0, userId: 'u2' }, 'aprovar', '', true) ?? '', /permissão/)
  assert.match(decidirAprovacao(t, { nivel: 2, userId: 'u2' }, 'reprovar', ' x ', true) ?? '', /motivo/)
  assert.equal(decidirAprovacao(t, { nivel: 2, userId: 'u2' }, 'reprovar', 'valor errado', true), null)
  assert.match(decidirAprovacao(t, { nivel: 2, userId: 'u1' }, 'aprovar', '', false) ?? '', /Quem lançou/)
  assert.equal(decidirAprovacao(t, { nivel: 2, userId: 'u1' }, 'aprovar', '', true), null)
  assert.match(decidirAprovacao({ ...t, aprovacao: 'nao_exige' }, { nivel: 2, userId: 'u2' }, 'aprovar', '', true) ?? '', /não está aguardando/)
  assert.match(decidirAprovacao({ ...t, cancelada: true }, { nivel: 2, userId: 'u2' }, 'aprovar', '', true) ?? '', /cancelada/)
})

test('aprovacaoAoMudarValor: pendente recalcula; aprovada só volta se subir de faixa; reprovada não muda de valor', () => {
  assert.deepEqual(aprovacaoAoMudarValor({ aprovacao: 'nao_exige', nivel: 0, nivelAprovado: null }, 1), { aprovacao: 'pendente', nivel: 1 })
  assert.deepEqual(aprovacaoAoMudarValor({ aprovacao: 'nao_exige', nivel: 0, nivelAprovado: null }, 0), { aprovacao: 'nao_exige', nivel: 0 })
  assert.deepEqual(aprovacaoAoMudarValor({ aprovacao: 'pendente', nivel: 2, nivelAprovado: null }, 0), { aprovacao: 'nao_exige', nivel: 0 })
  assert.deepEqual(aprovacaoAoMudarValor({ aprovacao: 'pendente', nivel: 1, nivelAprovado: null }, 2), { aprovacao: 'pendente', nivel: 2 })
  assert.deepEqual(aprovacaoAoMudarValor({ aprovacao: 'aprovado', nivel: 1, nivelAprovado: 1 }, 1), { aprovacao: 'aprovado', nivel: 1 })
  assert.deepEqual(aprovacaoAoMudarValor({ aprovacao: 'aprovado', nivel: 1, nivelAprovado: 1 }, 0), { aprovacao: 'aprovado', nivel: 1 })
  assert.deepEqual(aprovacaoAoMudarValor({ aprovacao: 'aprovado', nivel: 1, nivelAprovado: 1 }, 2), { aprovacao: 'pendente', nivel: 2 })
  assert.deepEqual(aprovacaoAoMudarValor({ aprovacao: 'reprovado', nivel: 1, nivelAprovado: null }, 1), { erro: 'Conta reprovada: o valor não muda. Cancele e lance de novo.' })
})

test('bloqueioPagamento: aguardando, reprovada e valor a confirmar bloqueiam; o resto passa', () => {
  assert.equal(bloqueioPagamento({ aprovacao: 'nao_exige', valorAConfirmar: false }), null)
  assert.equal(bloqueioPagamento({ aprovacao: 'aprovado', valorAConfirmar: false }), null)
  assert.match(bloqueioPagamento({ aprovacao: 'pendente', valorAConfirmar: false }) ?? '', /aguardando aprovação/)
  assert.match(bloqueioPagamento({ aprovacao: 'reprovado', valorAConfirmar: false }) ?? '', /reprovada/)
  assert.match(bloqueioPagamento({ aprovacao: 'aprovado', valorAConfirmar: true }) ?? '', /Confirme o valor/)
})
