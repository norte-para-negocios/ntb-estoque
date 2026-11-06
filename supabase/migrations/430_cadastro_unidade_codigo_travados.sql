-- Fase 6 (cadastro único), lote 1: duas travas do cadastro de produto nas lojas de estoque próprio.
-- Lojas omie (2–13) não são afetadas: os dois gatilhos saem cedo quando lojas.modo_estoque <> 'proprio'.
--
-- 1) Unidade imutável depois do 1º movimento: trocar KG por UN num produto com saldo e custo médio
--    reinterpreta todo o histórico (saldo e custo passam a valer outra coisa). Preencher unidade vazia continua livre.
-- 2) Código nunca reaproveitado: todo código que já existiu na loja fica reservado em produto_codigos_usados
--    (lápide). Outro produto não pode nascer com ele, mesmo depois do original apagado. O mesmo produto
--    (mesmo codigo_produto) pode voltar com o próprio código. proximo_codigo_produto pula códigos reservados.
--
-- Reverter: drop trigger produtos_unidade_travada on produtos; drop trigger produtos_codigo_lapide on produtos;
--           drop function trg_produtos_unidade_travada(); drop function trg_produtos_codigo_lapide();
--           drop table produto_codigos_usados; e recriar proximo_codigo_produto da 132.

create table if not exists public.produto_codigos_usados (
  loja_id bigint not null,
  codigo text not null,
  codigo_produto bigint not null,
  criado_em timestamptz not null default now(),
  primary key (loja_id, codigo)
);
alter table public.produto_codigos_usados enable row level security;
revoke all on public.produto_codigos_usados from anon, authenticated;
grant all on public.produto_codigos_usados to service_role;
comment on table public.produto_codigos_usados is
  'Fase 6: códigos de produto já usados por loja de estoque próprio. Nunca apagar: é o que impede reaproveitar um código.';

-- Os códigos de hoje das lojas próprias
insert into public.produto_codigos_usados (loja_id, codigo, codigo_produto)
select p.loja_id, p.codigo, p.codigo_produto
  from public.produtos p join public.lojas l on l.id = p.loja_id
 where l.modo_estoque = 'proprio' and nullif(btrim(p.codigo), '') is not null
on conflict (loja_id, codigo) do nothing;

create or replace function public.trg_produtos_codigo_lapide() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_modo text; v_dono bigint;
begin
  select modo_estoque into v_modo from lojas where id = new.loja_id;
  if v_modo is distinct from 'proprio' or nullif(btrim(new.codigo), '') is null then return new; end if;
  select codigo_produto into v_dono from produto_codigos_usados where loja_id = new.loja_id and codigo = new.codigo;
  if v_dono is not null and v_dono <> new.codigo_produto then
    raise exception 'O código % já foi usado por outro produto desta loja e não pode ser reaproveitado', new.codigo
      using errcode = '23505';
  end if;
  insert into produto_codigos_usados (loja_id, codigo, codigo_produto) values (new.loja_id, new.codigo, new.codigo_produto)
  on conflict (loja_id, codigo) do nothing;
  return new;
end $$;
drop trigger if exists produtos_codigo_lapide on public.produtos;
-- roda depois de produtos_codigo_proprio (ordem alfabética dos gatilhos BEFORE): a checagem de código vazio/duplicado vem antes
create trigger produtos_codigo_lapide before insert or update of codigo on public.produtos
  for each row execute function public.trg_produtos_codigo_lapide();

create or replace function public.trg_produtos_unidade_travada() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_modo text;
begin
  if nullif(btrim(old.unidade), '') is null or new.unidade is not distinct from old.unidade then return new; end if;
  select modo_estoque into v_modo from lojas where id = new.loja_id;
  if v_modo is distinct from 'proprio' then return new; end if;
  if exists (select 1 from estoque_movimentos where loja_id = new.loja_id and codigo_produto = new.codigo_produto) then
    raise exception 'A unidade de % não pode mudar (de % para %): o produto já tem movimento de estoque. Crie um produto novo com a unidade certa.',
      coalesce(new.descricao, new.codigo), old.unidade, new.unidade using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists produtos_unidade_travada on public.produtos;
create trigger produtos_unidade_travada before update of unidade on public.produtos
  for each row execute function public.trg_produtos_unidade_travada();

-- Próximo código: além de não existir em produtos, não pode estar reservado
create or replace function public.proximo_codigo_produto(p_loja bigint, p_tipo_item text) returns text
language plpgsql security definer set search_path = public as $$
declare v_pref text := prefixo_codigo_por_tipo(p_tipo_item); v_n int; v_cod text;
begin
  loop
    insert into estoque_codigo_seq (loja_id, prefixo, ultimo) values (p_loja, v_pref, 1)
      on conflict (loja_id, prefixo) do update set ultimo = estoque_codigo_seq.ultimo + 1
      returning ultimo into v_n;
    v_cod := v_pref || lpad(v_n::text, 3, '0');
    exit when not exists (select 1 from produtos where loja_id = p_loja and codigo = v_cod)
          and not exists (select 1 from produto_codigos_usados where loja_id = p_loja and codigo = v_cod);
  end loop;
  return v_cod;
end $$;
