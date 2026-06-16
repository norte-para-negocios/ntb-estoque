-- Filtro de familia na tela de produtos cortava familias: as opcoes eram
-- montadas lendo uma linha por produto e a consulta batia no teto de 1000
-- linhas do PostgREST, escondendo familias de produtos alem da linha 1000.
-- Esta function faz o DISTINCT no Postgres (sempre poucas dezenas de familias)
-- e o indice acelera tanto a montagem quanto o filtro .eq('descricao_familia').
-- SECURITY INVOKER: roda com as permissoes do usuario. (A tabela produtos nao
-- tem RLS hoje; o isolamento por loja vem do filtro p_loja_id, mesmo padrao do
-- resto do app. Habilitar RLS em produtos e um tema separado, para o dono.)

create index if not exists idx_produtos_loja_familia
  on produtos (loja_id, descricao_familia);

create or replace function familias_da_loja(p_loja_id bigint)
returns table (descricao_familia varchar)
language sql
security invoker
stable
as $$
  select distinct p.descricao_familia
    from produtos p
   where p.loja_id = p_loja_id
     and p.descricao_familia is not null
     and btrim(p.descricao_familia) <> ''
   order by p.descricao_familia
$$;

-- So autenticados: a tela /produto exige login. Revoga o EXECUTE de PUBLIC e de
-- anon (este foi concedido por engano numa versao anterior) e concede so a
-- authenticated.
revoke execute on function familias_da_loja(bigint) from public;
revoke execute on function familias_da_loja(bigint) from anon;
grant execute on function familias_da_loja(bigint) to authenticated;
