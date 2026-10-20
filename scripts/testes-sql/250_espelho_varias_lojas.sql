-- Teste da migration 250 (D5). Cópia local: banco `d5` = `create database d5 template g1` no ntb-teste-sql, com a 250.
-- Nunca em produção. Uso:
--   docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d d5 < supabase/migrations/250_espelho_varias_lojas.sql
--   docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d d5 < scripts/testes-sql/250_espelho_varias_lojas.sql
begin;
do $$
declare v bigint; n int;
begin
  -- coluna nova nasce false em todas as lojas (comportamento atual: webhook e OPs fantasmas parados)
  select count(*) into n from lojas where omie_op_tempo_real;
  assert n = 0, format('omie_op_tempo_real deveria nascer false em todas, %s true', n);

  insert into lojas (nome, cnpj, modo_estoque, espelho_completo) values ('TESTE 250', '00000000000250', 'omie', false) returning id into v;
  -- OP 1: concluida=false, aberta_omie=null (loja recém-ligada); OP 2: concluida=false, aberta_omie=true; OP 3: concluida, aberta_omie=true
  insert into ordens_producao (loja_id, identificacao_n_cod_op, identificacao_n_cod_produto, identificacao_n_qtde, identificacao_d_dt_previsao, concluida, aberta_omie)
  values (v, 9001, 501, 1, '2026-10-20', false, null), (v, 9002, 502, 2, '2026-10-20', false, true), (v, 9003, 503, 3, '2026-10-20', true, true);

  -- sem espelho: concluida = false (OPs 1 e 2)
  select count(*) into n from _sugestao_ops_abertas(v, '2026-10-31');
  assert n = 2, format('sem espelho: esperado 2, veio %s', n);

  -- espelho ligado mas a lista de abertas ainda não foi lida: continua concluida = false (não some tudo)
  update lojas set espelho_completo = true where id = v;
  select count(*) into n from _sugestao_ops_abertas(v, '2026-10-31');
  assert n = 2, format('espelho sem leitura: esperado 2, veio %s', n);

  -- estado de ops-abertas sem lido_em (só erro): ainda não vale
  insert into espelho_sync_estado (loja_id, frente, estado) values (v, 'ops-abertas', '{"parouPor":"erro do Omie: x"}');
  select count(*) into n from _sugestao_ops_abertas(v, '2026-10-31');
  assert n = 2, format('estado sem lido_em: esperado 2, veio %s', n);

  -- lista cortada pelo prazo do ciclo grava lido_em = null: ainda não vale
  update espelho_sync_estado set estado = '{"lido_em":null,"lista_completa":false}' where loja_id = v and frente = 'ops-abertas';
  select count(*) into n from _sugestao_ops_abertas(v, '2026-10-31') where produto = 501;
  assert n = 1, 'lido_em null: deveria seguir concluida = false (OP 1 dentro)';

  -- depois da 1ª lista completa: aberta_omie (OPs 2 e 3)
  update espelho_sync_estado set estado = '{"lido_em":"2026-10-20T10:00:00Z","lista_completa":true}' where loja_id = v and frente = 'ops-abertas';
  select count(*) into n from _sugestao_ops_abertas(v, '2026-10-31');
  assert n = 2, format('espelho lido: esperado 2, veio %s', n);
  select count(*) into n from _sugestao_ops_abertas(v, '2026-10-31') where produto = 503;
  assert n = 1, 'espelho lido: a OP 3 (aberta no Omie) deveria entrar';
  select count(*) into n from _sugestao_ops_abertas(v, '2026-10-31') where produto = 501;
  assert n = 0, 'espelho lido: a OP 1 (não veio na lista do Omie) não deveria entrar';

  -- linhas da guarda (D5) em espelho_sync_estado não atrapalham a leitura das frentes
  insert into espelho_sync_estado (loja_id, frente, estado) values (v, 'guarda-loja', '{"pausado_ate":"2026-10-20T11:00:00Z"}'), (v, 'guarda-kardex', '{"falhas":2}');
  select count(*) into n from espelho_sync_estado where loja_id = v and frente = 'kardex';
  assert n = 0, 'guarda não cria frente kardex';
  raise notice '250: ok';
end $$;
rollback;
