import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estadoEfetivo, resumoDoDia, comecePorAqui, ordenarGrupos, filtrarGrupo, decidirRetomadaOP, type Problema, type RegistroEstado, type EstadoEfetivo } from './central-puro.ts'

const P = (o: Partial<Problema>): Problema => ({ chave: 'pa:produto:1', grupo: 'pa', alvo: { tipo: 'produto', id: 1 }, titulo: 'Batata', tag: 'PA', causa: 'x', valor: 10, valorRotulo: 'no saldo', lado: '', ladoErro: false, acoes: [], assinatura: 's1', depende: [], busca: 'batata', d: {}, ...o })
const R = (o: Partial<RegistroEstado>): RegistroEstado => ({ chave: 'pa:produto:1', estado: 'resolvido', motivo: null, mensagem: null, acao: null, ate: null, assinatura: 's1', user_nome: 'Ana', atualizado_em: '2026-10-13T12:00:00Z', ...o })
const dia = (iso: string) => iso.slice(0, 10)
const H = '2026-10-13'

test('estado efetivo', () => {
  assert.equal(estadoEfetivo(undefined, P({}), H, dia).estado, 'aberto')
  assert.equal(estadoEfetivo(R({ estado: 'ramon' }), P({}), H, dia).estado, 'ramon')
  assert.equal(estadoEfetivo(R({ estado: 'ignorado', ate: '2026-10-12' }), P({}), H, dia).estado, 'aberto')
  assert.equal(estadoEfetivo(R({ estado: 'ignorado', ate: '2026-10-13' }), P({}), H, dia).estado, 'ignorado')
  const mud = estadoEfetivo(R({ estado: 'ignorado', assinatura: 'velha' }), P({}), H, dia)
  assert.equal(mud.estado, 'aberto'); assert.equal(mud.reaberto, '2026-10-13')
  assert.equal(estadoEfetivo(R({ estado: 'resolvido', atualizado_em: '2026-10-12T20:00:00Z' }), P({}), H, dia).estado, 'resolvido')
  const vol = estadoEfetivo(R({ estado: 'resolvido', atualizado_em: '2026-10-11T20:00:00Z' }), P({}), H, dia)
  assert.equal(vol.estado, 'aberto'); assert.equal(vol.reaberto, '2026-10-11')
  assert.equal(estadoEfetivo(R({ estado: 'aberto' }), P({}), H, dia).estado, 'aberto')
})

const e = (estado: EstadoEfetivo['estado']): EstadoEfetivo => ({ estado, reaberto: null, reg: null })

test('resumo do dia, comece por aqui e ordem dos grupos', () => {
  const ps = [
    { p: P({ chave: 'a', valor: 100 }), e: e('aberto') }, { p: P({ chave: 'b', valor: 300, grupo: 'custo' }), e: e('aberto') },
    { p: P({ chave: 'c', valor: 50 }), e: e('resolvido') }, { p: P({ chave: 'd', valor: 5, grupo: 'taxa' }), e: e('aberto') },
    { p: P({ chave: 'f', valor: 1000, grupo: 'op' }), e: e('ramon') }, { p: P({ chave: 'g', valor: 7, grupo: 'pi' }), e: e('ignorado') },
  ]
  const r = resumoDoDia(ps, 2)
  assert.deepEqual([r.total, r.resolvidos, r.ramon, r.ignorados, r.abertos, r.emAberto], [8, 3, 1, 1, 3, 405])
  assert.deepEqual(comecePorAqui(ps).map((p) => p.chave), ['b', 'a', 'd'])
  assert.deepEqual(ordenarGrupos(ps), ['custo', 'pa', 'op', 'pi', 'taxa'])
})

test('filtro do grupo: busca sem acento, ordem e contagem', () => {
  const ps = [
    { p: P({ chave: 'a', titulo: 'Açaí', busca: 'acai 900', valor: 1, d: { saldo: -5 } }), e: e('aberto') },
    { p: P({ chave: 'b', titulo: 'Batata', busca: 'batata', valor: 9, d: { saldo: -1 } }), e: e('aberto') },
    { p: P({ chave: 'c', titulo: 'Coco', busca: 'coco', valor: 3 }), e: e('resolvido') },
    { p: P({ chave: 'd', titulo: 'Dendê', busca: 'dende', valor: 3 }), e: e('ramon') },
  ]
  assert.deepEqual(filtrarGrupo(ps, 'pa', { q: 'Açai', ordem: 'valor', filtro: 'aberto' }).lista.map((x) => x.p.chave), ['a'])
  assert.deepEqual(filtrarGrupo(ps, 'pa', { q: '', ordem: 'saldo', filtro: 'aberto' }).lista.map((x) => x.p.chave), ['a', 'b'])
  assert.deepEqual(filtrarGrupo(ps, 'pa', { q: '', ordem: 'nome', filtro: 'todos' }).lista.map((x) => x.p.chave), ['a', 'b', 'c', 'd'])
  assert.deepEqual(filtrarGrupo(ps, 'pa', { q: '', ordem: 'valor', filtro: 'aberto' }).contagem, { aberto: 2, ramon: 1, feito: 1, todos: 4 })
})

test('retomada da OP lançada pela Central', () => {
  const agora = Date.parse('2026-10-13T12:00:00Z')
  assert.equal(decidirRetomadaOP(null, agora), 'novo')
  assert.equal(decidirRetomadaOP({ status: 'concluida', atualizadoEm: '2026-10-13T11:59:00Z' }, agora), 'feito')
  assert.equal(decidirRetomadaOP({ status: 'incluindo', atualizadoEm: '2026-10-13T11:58:00Z' }, agora), 'em_andamento')
  assert.equal(decidirRetomadaOP({ status: 'incluindo', atualizadoEm: '2026-10-13T11:40:00Z' }, agora), 'retomar')
  assert.equal(decidirRetomadaOP({ status: 'erro', atualizadoEm: '2026-10-13T11:59:00Z' }, agora), 'retomar')
})

test('C2: contagem resolvida não volta enquanto a contagem for a mesma (corrigir de novo duplicaria)', () => {
  const c = P({ chave: 'contagem:produto:30:1', grupo: 'contagem', assinatura: '2026-08-31:4658' })
  assert.equal(estadoEfetivo(R({ chave: c.chave, estado: 'resolvido', assinatura: '2026-08-31:4658', atualizado_em: '2026-10-09T12:00:00Z' }), c, H, dia).estado, 'resolvido')
  assert.equal(estadoEfetivo(R({ chave: c.chave, estado: 'resolvido', assinatura: '2026-08-31:4658', atualizado_em: '2026-10-09T12:00:00Z' }), { ...c, assinatura: '2026-10-12:900' }, H, dia).estado, 'aberto')
})
