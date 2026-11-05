import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { limparEsquema, ASSINATURA_REVISAR, ASSINATURA_REPROCESSAR, REVISAO_SO_DO_SERVIDOR } from './limpar-esquema-puro.ts'

const funcao = (assinatura: string, corpo: string) => `${assinatura}\n    LANGUAGE plpgsql SECURITY DEFINER\n    AS $$\nbegin\n${corpo}\nend $$;\n\n`
const TABELA = 'CREATE TABLE public.estoque_mov_revisao (\n    id bigint NOT NULL\n);\n\n'
const REVISAR = funcao(ASSINATURA_REVISAR, '  insert into estoque_mov_revisao (movimento_id) values (p_mov);\n  return 1;')
const REPROCESSAR = funcao(ASSINATURA_REPROCESSAR, '  perform _revisar_movimento(1, null, null, 1, 1, 1, 1, false, p_motivo);\n  return null;')

test('limpeza básica: schema public, triggers da outbox e FK para auth.users saem', () => {
  const dump = [
    'CREATE SCHEMA public;',
    "SELECT pg_catalog.set_config('search_path', '', false);",
    'CREATE TRIGGER outbox_trigger AFTER INSERT ON public.produtos FOR EACH ROW EXECUTE FUNCTION public.outbox_capture();',
    'ALTER TABLE ONLY public.profiles',
    '    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;',
    'CREATE TABLE public.produtos (id bigint);',
    '',
  ].join('\n')
  const s = limparEsquema(dump)
  assert.doesNotMatch(s, /CREATE SCHEMA public/)
  assert.doesNotMatch(s, /outbox_trigger/)
  assert.doesNotMatch(s, /auth\.users/)
  assert.match(s, /CREATE TABLE public\.produtos/)
  assert.ok(!s.includes(REVISAO_SO_DO_SERVIDOR.trim()), 'sem a tabela de revisões, nada de no-op')
})

test('com a tabela de revisões: _revisar_movimento e reprocessar_custo viram no-op no fim do esquema', () => {
  const s = limparEsquema(TABELA + REVISAR + REPROCESSAR)
  assert.ok(s.endsWith(REVISAO_SO_DO_SERVIDOR), 'bloco no-op por último (substitui as definições do dump)')
  const bloco = s.slice(s.indexOf(REVISAO_SO_DO_SERVIDOR))
  assert.ok(bloco.includes(ASSINATURA_REVISAR.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')))
  assert.ok(bloco.includes(ASSINATURA_REPROCESSAR.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')))
  assert.doesNotMatch(bloco, /insert\s+into/i, 'o no-op não grava nada')
})

test('assinatura mudou na produção: a geração falha (no-op com assinatura velha criaria outra função)', () => {
  const outra = REVISAR.replace('p_motivo text)', 'p_motivo text, p_extra int)')
  assert.throws(() => limparEsquema(TABELA + outra + REPROCESSAR), /assinatura mudou/)
  assert.throws(() => limparEsquema(TABELA + REVISAR), /assinatura mudou/)
})

test('outra função escrevendo em estoque_mov_revisao: a geração falha', () => {
  const intrusa = funcao('CREATE FUNCTION public.outra() RETURNS void', '  insert into public.estoque_mov_revisao (movimento_id) values (1);')
  assert.throws(() => limparEsquema(TABELA + REVISAR + REPROCESSAR + intrusa), /fora de _revisar_movimento/)
  const update = funcao('CREATE FUNCTION public.outra() RETURNS void', '  update estoque_mov_revisao set motivo = 1;')
  assert.throws(() => limparEsquema(TABELA + REVISAR + REPROCESSAR + update), /fora de _revisar_movimento/)
})

test('esquema do desktop no repo: tem a tabela de revisões e termina com o no-op', () => {
  const sql = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'desktop', 'schema', 'estoque.sql'), 'utf8')
  if (!/^CREATE TABLE public\.estoque_mov_revisao \(/m.test(sql)) return // esquema anterior à 311
  assert.ok(sql.endsWith(REVISAO_SO_DO_SERVIDOR), 'desktop/schema/estoque.sql gerado sem limpar-schema.mjs atual')
})

test('aviso do reprocessamento local: só quando o banco local devolveu o no-op', async () => {
  const { avisoReprocessarLocal, AVISO_REPROCESSAR_LOCAL } = await import('./limpar-esquema-puro.ts')
  assert.equal(avisoReprocessarLocal({ ok: true, reprocessamento: { local: true, avisos: [AVISO_REPROCESSAR_LOCAL] }, avisos: [AVISO_REPROCESSAR_LOCAL] }), AVISO_REPROCESSAR_LOCAL)
  assert.equal(avisoReprocessarLocal({ ok: true, avisos: [AVISO_REPROCESSAR_LOCAL] }), AVISO_REPROCESSAR_LOCAL)
  assert.equal(avisoReprocessarLocal({ ok: true, reprocessamento: { lote: 'x', movimentos_revisados: 3, avisos: [] }, avisos: [] }), null, 'servidor: sem aviso')
  assert.equal(avisoReprocessarLocal({ ok: true, reprocessamento: null }), null)
  assert.equal(avisoReprocessarLocal(null), null)
})
