-- Tela de saude do banco (super admin): tamanho atual, maiores tabelas,
-- ritmo de crescimento e projecao ate o limite do free tier (500 MB).
-- security definer pois pg_database_size/pg_total_relation_size exigem
-- privilegio de catalogo que o role 'authenticated' nao tem por padrao;
-- o gate de quem pode CHAMAR a funcao fica no app (isSuperAdmin()).

create or replace function saude_banco()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  resultado jsonb;
begin
  select jsonb_build_object(
    'total_mb', round((pg_database_size(current_database()) / 1048576.0)::numeric, 1),
    'tabelas', (
      select jsonb_agg(jsonb_build_object(
        'nome', t.relname,
        'mb', round((t.relsize / 1048576.0)::numeric, 1),
        'linhas', t.reltuples::bigint
      ) order by t.relsize desc)
      from (
        select c.relname, c.reltuples, pg_total_relation_size(c.oid) as relsize
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by pg_total_relation_size(c.oid) desc
        limit 12
      ) t
    ),
    'novas_linhas_7d', jsonb_build_object(
      'movimentos', (select count(*) from movimentos where created_at >= now() - interval '7 days'),
      'ordens_producao', (select count(*) from ordens_producao where created_at >= now() - interval '7 days'),
      'nota_fiscal_items', (select count(*) from nota_fiscal_items where created_at >= now() - interval '7 days')
    )
  ) into resultado;
  return resultado;
end;
$$;

revoke execute on function saude_banco() from public;
revoke execute on function saude_banco() from anon;
grant  execute on function saude_banco() to authenticated, service_role;
