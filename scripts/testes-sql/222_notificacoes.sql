-- Teste da migration 222 (notificações). Banco LOCAL g1 com fase_g_setup.sql + 222. Nunca em produção.
-- Uso: docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d g1 < scripts/testes-sql/222_notificacoes.sql
begin;
do $$ declare r jsonb; v_id bigint; v_at timestamptz; begin
  -- 1. cria
  r := notificacoes_sincronizar(9001, array['estoque_minimo','nota_parada'],
    '[{"tipo":"estoque_minimo","chave":"estoque_minimo","gravidade":"warn","titulo":"3 produtos abaixo","mensagem":"m","link":"/reposicao","nivel":3}]');
  if (r->>'novas')::int <> 1 then raise exception '1: %', r; end if;
  select id, atualizada_em into v_id, v_at from notificacoes where loja_id = 9001 and chave = 'estoque_minimo';
  -- 2. mesmo nível / nível menor: não reabre (atualizada_em igual), texto atualiza
  perform pg_sleep(0.01);
  r := notificacoes_sincronizar(9001, array['estoque_minimo'],
    '[{"tipo":"estoque_minimo","chave":"estoque_minimo","gravidade":"warn","titulo":"2 produtos abaixo","link":"/reposicao","nivel":2}]');
  if (select atualizada_em from notificacoes where id = v_id) <> v_at then raise exception '2: reabriu com nível menor'; end if;
  if (select titulo from notificacoes where id = v_id) <> '2 produtos abaixo' then raise exception '2: texto'; end if;
  -- 3. nível maior: reabre
  r := notificacoes_sincronizar(9001, array['estoque_minimo'],
    '[{"tipo":"estoque_minimo","chave":"estoque_minimo","gravidade":"warn","titulo":"5","link":"/reposicao","nivel":5}]');
  if (r->>'reabertas')::int <> 1 then raise exception '3: %', r; end if;
  -- 4. tipo avaliado sem item: resolve; tipo NÃO avaliado: fica como está
  r := notificacoes_sincronizar(9001, array['nota_parada'], '[]');
  if (select resolvida_em from notificacoes where id = v_id) is not null then raise exception '4: resolveu tipo não avaliado'; end if;
  r := notificacoes_sincronizar(9001, array['estoque_minimo'], '[]');
  if (r->>'resolvidas')::int <> 1 or (select resolvida_em from notificacoes where id = v_id) is null then raise exception '4: não resolveu %', r; end if;
  -- 5. item de tipo fora de p_tipos e link para outro site: recusados
  begin
    perform notificacoes_sincronizar(9001, array['nota_parada'], '[{"tipo":"estoque_minimo","chave":"x","gravidade":"warn","titulo":"t","nivel":1}]');
    raise exception '5: aceitou tipo fora';
  exception when sqlstate '22023' then null; end;
  begin
    perform notificacoes_sincronizar(9001, array['nota_parada'], '[{"tipo":"nota_parada","chave":"nota_parada","gravidade":"warn","titulo":"t","link":"//evil.example","nivel":1}]');
    raise exception '5: aceitou link externo';
  exception when check_violation then null; end;
  -- 6. outra loja
  perform notificacoes_sincronizar(9002, array['bloqueio_omie'], '[{"tipo":"bloqueio_omie","chave":"bloqueio_omie","gravidade":"err","titulo":"bloqueio","link":"/log","nivel":1}]');
  perform notificacoes_sincronizar(9001, array['nota_parada'], '[{"tipo":"nota_parada","chave":"nota_parada","gravidade":"warn","titulo":"n","link":"/nota-fiscal","nivel":1}]');
  insert into notificacoes_leituras (notificacao_id, user_id) select id, '00000000-0000-4000-8000-000000009001' from notificacoes where loja_id = 9001 and chave = 'nota_parada';
  insert into notificacoes_leituras (notificacao_id, user_id) select id, '00000000-0000-4000-8000-000000009002' from notificacoes where loja_id = 9002;
end $$;

-- 7. RLS: Ana vê só as da loja 9001 e só as próprias leituras; não chama a função nem grava
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000009001"}', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from notificacoes where loja_id <> 9001) then raise exception '7: viu notificação de outra loja'; end if;
  if (select count(*) from notificacoes_leituras) <> 1 then raise exception '7: leituras %', (select count(*) from notificacoes_leituras); end if;
  begin perform notificacoes_sincronizar(9001, array['x'], '[]'); raise exception '7: authenticated chamou a função'; exception when insufficient_privilege then null; end;
  begin insert into notificacoes_leituras (notificacao_id, user_id) values (1, '00000000-0000-4000-8000-000000009001'); raise exception '7: gravou leitura'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'OK 222' as resultado;
rollback;
