// Limpeza do pg_dump --schema-only da produção para o Postgres local do app desktop (usada por
// desktop/scripts/limpar-schema.mjs). Pura: recebe o texto do dump e devolve o texto a gravar.
//  - tira CREATE SCHEMA public (já existe), SET de sessão do dump e search_path vazio
//  - tira os triggers da outbox (a outbox é só do servidor)
//  - tira a FK de profiles -> auth.users (o desktop não tem as contas do GoTrue)
//  - revisões de custo (311–317) são SÓ do servidor: no banco local _revisar_movimento e reprocessar_custo viram no-op
//    (ver REVISAO_SO_DO_SERVIDOR abaixo)

// Assinaturas exatas como o pg_dump escreve. Mudou a assinatura na produção? A geração falha aqui de propósito:
// um `create or replace` com assinatura velha criaria OUTRA função e a de verdade continuaria gravando revisões no desktop.
export const ASSINATURA_REVISAR =
  'CREATE FUNCTION public._revisar_movimento(p_mov bigint, p_lote uuid, p_data date, p_custo numeric, p_cmc numeric, p_saldo numeric, p_saldo_total numeric, p_estimado boolean, p_motivo text) RETURNS bigint'
export const ASSINATURA_REPROCESSAR =
  'CREATE FUNCTION public.reprocessar_custo(p_loja bigint, p_produtos bigint[], p_desde date, p_motivo text) RETURNS jsonb'

export const AVISO_REPROCESSAR_LOCAL = 'Sem internet: o custo médio desta operação é refeito pelo servidor quando o app sincronizar.'

// Por que no-op (migration 318): estoque_mov_revisao DESCE do servidor (offline_tabelas, regra pai por estoque_movimentos).
// A ação feita sem internet é reexecutada no servidor (/api/offline/acao), que grava as revisões de verdade e elas chegam
// pelo pull. Se o banco local também gravasse, a revisão local (id provisório, faixa alta) venceria a do servidor na visão
// estoque_movimentos_efetivo (última revisão = maior id) até a reconciliação, e o pareamento da fila divergiria.
export const REVISAO_SO_DO_SERVIDOR = `
--
-- Desktop (gerado por desktop/scripts/limpar-schema.mjs, migration 318): revisões de custo são só do servidor.
-- O banco local nunca grava em estoque_mov_revisao; as revisões chegam pelo pull. Sem internet, compra/estorno/OP
-- lançam o movimento normalmente (custo ao vivo do registrar_movimento) e o servidor refaz a cadeia ao reexecutar a ação.
--

CREATE OR REPLACE FUNCTION public._revisar_movimento(p_mov bigint, p_lote uuid, p_data date, p_custo numeric, p_cmc numeric, p_saldo numeric, p_saldo_total numeric, p_estimado boolean, p_motivo text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return null;
end $$;

CREATE OR REPLACE FUNCTION public.reprocessar_custo(p_loja bigint, p_produtos bigint[], p_desde date, p_motivo text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return jsonb_build_object('lote', null, 'produtos', 0, 'movimentos_revisados', 0, 'desde_efetivo', p_desde,
                            'cascata', '[]'::jsonb, 'local', true,
                            'avisos', jsonb_build_array('${AVISO_REPROCESSAR_LOCAL}'));
end $$;
`

/** Garante que a única escrita em estoque_mov_revisao do dump é a de _revisar_movimento (que vira no-op). */
function conferirEscritaUnica(sql: string): void {
  const ini = sql.indexOf(ASSINATURA_REVISAR)
  const fim = sql.indexOf('end $$;', ini)
  const escritas = [...sql.matchAll(/\b(insert\s+into|update|delete\s+from|copy|merge\s+into)\s+(public\.)?estoque_mov_revisao\b/gi)]
  if (!escritas.length) throw new Error('não achei a escrita de _revisar_movimento em estoque_mov_revisao')
  for (const m of escritas) {
    const i = m.index ?? -1
    if (i < ini || i > fim) {
      throw new Error(`escrita em estoque_mov_revisao fora de _revisar_movimento (posição ${i}): o desktop gravaria revisão local`)
    }
  }
}

export function limparEsquema(entrada: string): string {
  let sql = entrada
  const remover = [
    /^CREATE SCHEMA public;\n/m,
    /^COMMENT ON SCHEMA public IS .*\n/m,
    /^SELECT pg_catalog\.set_config\('search_path', '', false\);\n/m,
    /^SET transaction_timeout = 0;\n/m,
  ]
  for (const r of remover) sql = sql.replace(r, '')
  // Meta-comandos do psql (\\restrict/\\unrestrict do pg_dump 17.6+) não rodam via driver.
  sql = sql.replace(/^\\(un)?restrict .*\n/gm, '')

  // Blocos "CREATE TRIGGER outbox_trigger ... ;" (uma linha cada no dump)
  sql = sql.replace(/^CREATE TRIGGER outbox_trigger .*\n/gm, '')
  // FK para auth.users (ALTER TABLE ONLY ... ADD CONSTRAINT ... REFERENCES auth.users(...))
  sql = sql.replace(/^ALTER TABLE ONLY public\.\w+\n\s+ADD CONSTRAINT \w+ FOREIGN KEY \(\w+\) REFERENCES auth\.users\(id\)[^;]*;\n/gm, '')

  if (/REFERENCES auth\./.test(sql)) throw new Error('sobrou referência a auth.* em FK')

  // Revisões de custo: só se o dump tem a tabela (o dump do frio não tem).
  if (/^CREATE TABLE public\.estoque_mov_revisao \(/m.test(sql)) {
    for (const a of [ASSINATURA_REVISAR, ASSINATURA_REPROCESSAR]) {
      if (!sql.includes(a)) throw new Error(`assinatura mudou na produção, revise o no-op do desktop: ${a}`)
    }
    conferirEscritaUnica(sql)
    sql = sql.trimEnd() + '\n' + REVISAO_SO_DO_SERVIDOR
  }
  return sql
}

/** Aviso a mostrar depois de lançar/estornar no banco local do desktop (reprocessar_custo no-op devolveu `local`).
 *  No servidor o retorno nunca tem `local`, então fora do desktop offline devolve null. */
export function avisoReprocessarLocal(retorno: unknown): string | null {
  if (!retorno || typeof retorno !== 'object') return null
  const r = retorno as { reprocessamento?: { local?: unknown } | null; avisos?: unknown }
  if (r.reprocessamento?.local === true) return AVISO_REPROCESSAR_LOCAL
  if (Array.isArray(r.avisos) && r.avisos.includes(AVISO_REPROCESSAR_LOCAL)) return AVISO_REPROCESSAR_LOCAL
  return null
}
