-- 242 — Fase C2: importar pedidos de compra por planilha [I5] (estoque próprio). Só uma função nova.
-- A planilha é lida e validada linha a linha no servidor (lib/compras/importar-pedidos-puro.ts); aqui grava TUDO OU NADA
-- (um erro em qualquer pedido desfaz todos) e é idempotente pela chave (imp:<sha256 do arquivo>): o mesmo arquivo de novo
-- devolve os pedidos da primeira vez, com duplicado = true. Os pedidos nascem rascunho, origem 'planilha' (240).
-- Depende da 240 (pc_salvar com comprador e origem 'planilha').
-- Aplicar (manual, com backup e OK do dono), depois da 240:
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 242_importar_pedidos_compra.sql

begin;

-- p_pedidos: [{ ...campos do pc_salvar (fornecedor_id?, fornecedor_nome, fornecedor_cnpj?, previsao_entrega?, frete?,
--               parcelas?, numero_fornecedor?, obs?, itens:[...]) }]
create or replace function public.pc_importar(p_loja bigint, p_chave text, p_pedidos jsonb, p_user text default null, p_nome text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_peds jsonb; x jsonb; r jsonb; v_i int := 0; v_out jsonb := '[]'::jsonb;
begin
  perform _pc_loja_propria(p_loja);
  if coalesce(p_chave, '') !~ '^imp:[0-9a-f]{64}$' then raise exception 'Chave da importação inválida' using errcode = '22023'; end if;
  if jsonb_typeof(p_pedidos) is distinct from 'array' or jsonb_array_length(p_pedidos) = 0 then
    raise exception 'A planilha não tem pedidos para importar' using errcode = '22023';
  end if;
  if jsonb_array_length(p_pedidos) > 100 then raise exception 'No máximo 100 pedidos por planilha' using errcode = '22023'; end if;

  -- trava antes de conferir a chave: o mesmo arquivo enviado duas vezes ao mesmo tempo = o 2º espera e devolve o do 1º
  perform pg_advisory_xact_lock(hashtext('pedido_compra_importar'), p_loja::int);
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'numero', numero, 'fornecedor', fornecedor_nome) order by id), '[]'::jsonb)
    into v_peds from pedidos_compra where loja_id = p_loja and left(chave_idempotencia, length(p_chave) + 1) = p_chave || ':';
  if jsonb_array_length(v_peds) > 0 then return jsonb_build_object('ok', true, 'duplicado', true, 'pedidos', v_peds); end if;

  for x in select * from jsonb_array_elements(p_pedidos) loop
    v_i := v_i + 1;
    if jsonb_typeof(x) is distinct from 'object' then raise exception 'Pedido % inválido', v_i using errcode = '22023'; end if;
    r := pc_salvar(p_loja, (x - 'id') || jsonb_build_object('chave_idempotencia', p_chave || ':' || v_i, 'origem', 'planilha'), p_user, p_nome);
    v_out := v_out || jsonb_build_object('id', (r->>'id')::bigint, 'numero', (r->>'numero')::int, 'fornecedor', x->>'fornecedor_nome');
  end loop;
  return jsonb_build_object('ok', true, 'duplicado', false, 'pedidos', v_out);
end $$;

revoke all on function public.pc_importar(bigint, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.pc_importar(bigint, text, jsonb, text, text) to service_role;

commit;
