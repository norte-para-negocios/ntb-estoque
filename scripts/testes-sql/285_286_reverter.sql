-- REVERTE as migrations 286 e 285 (financeiro, etapa 1). Use só se NADA foi lançado em produção
-- (a trava abaixo recusa se houver título, pagamento, lançamento ou conta). Não mexe nas tabelas antigas
-- contas_pagar / contas_receber / contas_correntes (052–054), que nunca foram tocadas.
-- Uso: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 285_286_reverter.sql
begin;
do $$ begin
  if exists (select 1 from fin_titulos_pagar) or exists (select 1 from fin_pagamentos) or exists (select 1 from fin_lancamentos)
     or exists (select 1 from fin_contas_correntes) then
    raise exception 'Há dados financeiros lançados: não reverta (nada se apaga no financeiro). Inative as contas/categorias em vez disso.';
  end if;
end $$;

drop function if exists public.fin_titulo_pagar_detalhe(bigint, bigint, date);
drop function if exists public.fin_titulos_pagar_listar(bigint, jsonb, int, int, date);
drop function if exists public.fin_pagamento_estornar(bigint, bigint, text, text, text);
drop function if exists public.fin_pagamento_registrar(bigint, bigint, jsonb, text, text, text);
drop function if exists public.fin_titulo_pagar_cancelar(bigint, bigint, text, text, text);
drop function if exists public.fin_titulo_pagar_salvar(bigint, bigint, jsonb, text, text, text);
drop function if exists public.fin_status_titulo(numeric, numeric);
drop function if exists public.fin_situacao_titulo(text, date, date);
drop table if exists public.fin_pagamentos;
drop table if exists public.fin_titulos_pagar;

drop function if exists public.fin_categorias_semear(bigint);
drop function if exists public.fin_categoria_salvar(bigint, bigint, jsonb, text, text);
drop function if exists public.fin_extrato(bigint, bigint, date, date);
drop function if exists public.fin_contas_saldo(bigint);
drop function if exists public.fin_conta_salvar(bigint, bigint, jsonb, text, text);
drop function if exists public.fin_registrar_evento(bigint, text, bigint, text, jsonb, text, text);
drop function if exists public.fin_exigir_loja_propria(bigint);
drop function if exists public.fin_hoje();
drop table if exists public.fin_eventos;
drop table if exists public.fin_lancamentos;
drop table if exists public.fin_categorias;
drop table if exists public.fin_contas_correntes;
drop function if exists public.trg_fin_pagamentos_guarda();
drop function if exists public.trg_fin_imutavel();

-- permissões do catálogo: só remove se ninguém foi vinculado
delete from permissoes where nome in ('Financeiro - Contas a pagar', 'Financeiro - Contas a pagar - Pagar', 'Financeiro - Contas correntes', 'Financeiro - Categorias')
  and id not in (select permissao_id from cargo_permissao where permissao_id is not null)
  and id not in (select permissao_id from permissao_user where permissao_id is not null);

notify pgrst, 'reload schema';
commit;
