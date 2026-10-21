-- REVERTE as migrations 286 e 285 (financeiro, etapa 1). Use só se NADA foi feito à mão em produção.
-- A trava abaixo recusa se houver título, pagamento, lançamento, conta ou evento, ou categoria que não seja da semente padrão
-- (sem `padrao`, inativada, com código ou ligada a categoria contábil). Categoria padrão só RENOMEADA não trava: é só texto.
-- Funciona também se só a 285 (ou nenhuma) foi aplicada. Não mexe nas tabelas antigas contas_pagar / contas_receber /
-- contas_correntes (052–054), que nunca foram tocadas.
-- Uso: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 285_286_reverter.sql
begin;
do $$
declare t text; n bigint;
begin
  foreach t in array array['fin_titulos_pagar', 'fin_pagamentos', 'fin_lancamentos', 'fin_contas_correntes', 'fin_eventos'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        raise exception 'Há dados em % (% linhas): não reverta (nada se apaga no financeiro). Inative em vez de apagar.', t, n;
      end if;
    end if;
  end loop;
  -- categorias: só as da semente e ainda ativas, sem código nem ligação (qualquer criada, inativada ou configurada à mão trava)
  if to_regclass('public.fin_categorias') is not null then
    execute $q$select count(*) from public.fin_categorias where padrao is null or not ativa or codigo is not null or categoria_contabil_id is not null$q$ into n;
    if n > 0 then raise exception 'Há % categoria(s) financeira(s) criada(s) ou alterada(s) à mão: não reverta.', n; end if;
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
drop function if exists public.fin_numero(text, numeric);
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
