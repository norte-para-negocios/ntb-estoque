-- 340 — Financeiro, Fase 4 passo 1: CONTA A PAGAR GERADA PELA NOTA DE ENTRADA (uma por duplicata do XML) e estornada
-- quando a entrada da nota é desfeita, a nota é excluída ou é cancelada na SEFAZ.
-- Plano: docs/superpowers/plans/2026-11-03-norte-erp-plano-mestre.md (Fase 4, item 1). Depende da 285/286 (fin_*), 182
-- (fornecedor_da_nota_sefaz) e 185 (compras_proprio.estornos). SÓ ADITIVA, só loja de estoque próprio.
--
-- Como funciona
-- * Gatilho AFTER UPDATE OF status em compras_proprio (todo caminho passa por aí: "Confirmar entrada", lançamento automático
--   da SEFAZ, "Desfazer entrada", excluir a nota, cancelamento na SEFAZ). Nenhuma função existente foi alterada.
--     - status vira 'lancada' ou 'parcial'  → fin_titulos_da_nota_gerar (idempotente).
--     - status sai de 'lancada'/'parcial' para 'pendente' (desfeita) ou 'cancelada' → fin_titulos_da_nota_estornar.
-- * Geração: uma conta por duplicata (full_object.parcelas.parcelasLista = cobr/dup: nDup, dVenc, vDup, gravado pela
--   gravar_nota_sefaz), na ordem do XML; duplicata sem valor é ignorada; sem vencimento vence na emissão. Sem duplicata:
--   UMA conta no total da nota vencendo na emissão (à vista: decidido pelo dono em 05/11, ver 360). Fornecedor = cadastro pelo CNPJ da nota
--   (fornecedor_da_nota_sefaz acha ou cria). Categoria = a categoria financeira ligada à categoria contábil da nota (quando
--   todos os itens têm a mesma), senão a padrão 'Compra de mercadoria para revenda' (cmv_revenda), senão 'Matéria-prima e
--   insumos' (cmv_insumos). Competência = mês da emissão. Nota em que nenhum item gera conta a pagar (gera_conta_pagar) não gera.
-- * Idempotência: chave 'nota_entrada:<nota>:<rodada>:<parcela>' (rodada = compras_proprio.estornos, que sobe a cada
--   "Desfazer entrada") e o índice único fin_titulos_pagar_origem (uma parcela ativa por nota). Confirmar de novo não duplica;
--   desfazer e confirmar gera a rodada nova só das parcelas que não têm conta ativa (a paga que ficou é reaproveitada).
--   Conta cancelada à mão na mesma rodada não volta sozinha.
-- * Estorno: cancela as contas SEM pagamento da nota (fin_titulo_pagar_cancelar não é usado porque recusa título pago: aqui
--   o pago fica de propósito). Conta com pagamento NÃO é tocada: fica ativa, gera evento 'nota_desfeita_com_pagamento' e a
--   tela avisa (decisão humana). Nada se apaga.
-- * Falha na geração (ex.: nota sem CNPJ) NUNCA impede a entrada no estoque: o gatilho grava o motivo em fin_eventos
--   (entidade 'nota_entrada', tipo 'titulos_falha') e a tela da nota (só desenvolvedor) mostra o motivo e "Gerar agora".
--   Falha no estorno SOBE o erro (desfazer não termina deixando conta a pagar órfã).
-- * Loja Omie: compras_proprio só existe em loja própria; ainda assim o gatilho ignora loja que não é 'proprio'.
-- * Notas já lançadas antes desta migration NÃO ganham conta (sem carga retroativa: decisão do dono).
-- * CHAVE POR LOJA lojas.fin_cp_da_nota_ativo (padrão false): só loja com a chave ligada gera E estorna. Até o dono liberar,
--   só a loja-laboratório 19 (is_test) fica ligada; a ODARA e as lojas reais não geram nada. Ligar depois:
--   update lojas set fin_cp_da_nota_ativo = true where id = <loja>;
--
-- Aplicar (manual, com backup e OK do dono; numa transação):
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 340_conta_pagar_da_nota.sql
-- Teste: scripts/testes-sql/340_conta_pagar_da_nota.sql (BEGIN … ROLLBACK). Depois: desktop/scripts/gerar-schema.sh.

begin;
set lock_timeout = '5s';

alter table public.lojas add column if not exists fin_cp_da_nota_ativo boolean not null default false;
comment on column public.lojas.fin_cp_da_nota_ativo is 'Fase 4: a nota de entrada gera/estorna conta a pagar (migration 340). Desligado até o dono liberar.';
update public.lojas set fin_cp_da_nota_ativo = true where id = 19 and is_test and modo_estoque = 'proprio';

create or replace function public.fin_cp_da_nota_ligado(p_loja bigint) returns boolean
language sql stable set search_path = public as $$
  select coalesce((select fin_cp_da_nota_ativo and modo_estoque = 'proprio' from lojas where id = p_loja), false)
$$;

-- ------------------------------------------------------------------------------------------------- plano das parcelas
create or replace function public.fin_data_duplicata(p text) returns date
language plpgsql immutable as $$
declare t text := btrim(coalesce(p, '')); v_iso text;
begin
  if t ~ '^\d{2}/\d{2}/\d{4}$' then v_iso := substr(t, 7, 4) || '-' || substr(t, 4, 2) || '-' || substr(t, 1, 2);
  elsif t ~ '^\d{4}-\d{2}-\d{2}' then v_iso := substr(t, 1, 10);
  else return null;
  end if;
  begin
    if to_char(v_iso::date, 'YYYY-MM-DD') <> v_iso then return null; end if;
    return v_iso::date;
  exception when others then return null;
  end;
end $$;

-- Espelho de lib/financeiro/titulos-da-nota-puro.ts (planoParcelasDaNota).
create or replace function public.fin_parcelas_da_nota(p_full_object jsonb, p_valor_total numeric, p_emissao date, p_hoje date default null)
returns table (parcela int, total_parcelas int, vencimento date, valor numeric, regra text)
language plpgsql stable as $$
#variable_conflict use_column
declare v_base date := coalesce(p_emissao, p_hoje, fin_hoje());
begin
  return query
  with d as (
    select e.ord, coalesce(fin_data_duplicata(e.p->>'dVencimento'), v_base) as venc,
           round((case when (e.p->>'vParcela') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then (e.p->>'vParcela')::numeric end), 2) as valor
    from jsonb_array_elements(case when jsonb_typeof(p_full_object->'parcelas'->'parcelasLista') = 'array'
                                   then p_full_object->'parcelas'->'parcelasLista' else '[]'::jsonb end) with ordinality as e(p, ord)
  ), v as (select * from d where valor > 0)
  select (row_number() over (order by v.ord))::int, (select count(*) from v)::int, v.venc, v.valor, 'duplicatas'::text
  from v order by v.ord;
  if not found and coalesce(round(p_valor_total, 2), 0) > 0 then
    return query select 1, 1, v_base, round(p_valor_total, 2), 'sem_duplicata'::text;
  end if;
end $$;

-- ------------------------------------------------------------------------------------------------------------- gerar
create or replace function public.fin_titulos_da_nota_gerar(p_loja bigint, p_nota bigint, p_user text default null,
  p_user_nome text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c compras_proprio%rowtype; n notas_fiscais%rowtype; f fornecedores%rowtype; v_cod bigint; v_cat bigint; v_cc bigint;
  x record; v_chave text; v_numero int; v_doc text; v_gerados int := 0; v_ja int := 0; v_regra text; v_soma numeric := 0;
  v_ids bigint[] := '{}'; t fin_titulos_pagar%rowtype; v_emissao date;
begin
  perform fin_exigir_loja_propria(p_loja);
  if not fin_cp_da_nota_ligado(p_loja) then
    return jsonb_build_object('ok', true, 'gerados', 0, 'ja_existiam', 0, 'motivo', 'A conta a pagar pela nota ainda não está ligada nesta loja');
  end if;
  select * into c from compras_proprio where loja_id = p_loja and nota_fiscal_id = p_nota for update;
  if not found then raise exception 'Esta nota não tem entrada no estoque' using errcode = '22023'; end if;
  if c.status not in ('lancada', 'parcial') then
    return jsonb_build_object('ok', true, 'gerados', 0, 'ja_existiam', 0, 'motivo', 'A entrada da nota não está confirmada');
  end if;
  select * into n from notas_fiscais where id = p_nota and loja_id = p_loja and deleted_at is null;
  if not found then raise exception 'Nota não encontrada' using errcode = '22023'; end if;
  if coalesce(n.full_object->'infoCadastro'->>'cCancelada', 'N') = 'S' then
    return jsonb_build_object('ok', true, 'gerados', 0, 'ja_existiam', 0, 'motivo', 'Nota cancelada na SEFAZ');
  end if;
  if exists (select 1 from compras_proprio_itens where compra_id = c.id)
     and not exists (select 1 from compras_proprio_itens where compra_id = c.id and gera_conta_pagar) then
    return jsonb_build_object('ok', true, 'gerados', 0, 'ja_existiam', 0, 'motivo', 'Nenhum item da nota gera conta a pagar');
  end if;

  -- fornecedor pelo CNPJ da nota (acha ou cria, mesma regra da gravação da nota da SEFAZ)
  v_cod := fornecedor_da_nota_sefaz(p_loja, coalesce(n.c_cnpj_cpf, c.fornecedor_cnpj), coalesce(n.c_razao_social, c.fornecedor_nome), n.c_nome, n.c_inscricao);
  if v_cod is null then raise exception 'Nota sem CNPJ/CPF do fornecedor: não dá para gerar a conta a pagar' using errcode = '22023'; end if;
  select * into f from fornecedores where loja_id = p_loja and codigo_omie = v_cod order by id limit 1;
  if not found then raise exception 'Fornecedor da nota não encontrado no cadastro' using errcode = '22023'; end if;

  -- categoria: a ligada à categoria contábil única da nota; senão a padrão de compra
  select min(i.categoria_contabil_id) into v_cc from nota_fiscal_items i where i.nota_fiscal_id = p_nota and i.loja_id = p_loja
    having count(distinct i.categoria_contabil_id) = 1 and count(*) = count(i.categoria_contabil_id);
  if v_cc is not null then
    select id into v_cat from fin_categorias where loja_id = p_loja and categoria_contabil_id = v_cc and tipo = 'despesa' and ativa order by id limit 1;
  end if;
  if v_cat is null then
    select id into v_cat from fin_categorias where loja_id = p_loja and tipo = 'despesa' and ativa and padrao in ('cmv_revenda', 'cmv_insumos')
      order by case padrao when 'cmv_revenda' then 1 else 2 end limit 1;
  end if;

  v_emissao := coalesce(n.d_emissao_nfe, c.emissao);
  v_doc := 'NF ' || coalesce(nullif(ltrim(coalesce(n.c_numero_nfe, c.numero, ''), '0'), ''), p_nota::text);
  perform pg_advisory_xact_lock(7286, p_loja::int); -- mesma trava da numeração de fin_titulo_pagar_salvar
  for x in select * from fin_parcelas_da_nota(n.full_object, coalesce(n.n_valor_nfe, c.valor_total), v_emissao) loop
    v_regra := x.regra; v_soma := v_soma + x.valor;
    v_chave := 'nota_entrada:' || p_nota || ':' || coalesce(c.estornos, 0) || ':' || x.parcela;
    if exists (select 1 from fin_titulos_pagar where loja_id = p_loja and chave_idempotencia = v_chave)
       or exists (select 1 from fin_titulos_pagar where loja_id = p_loja and origem_tipo = 'nota_entrada' and origem_id = p_nota
                  and parcela = x.parcela and status <> 'cancelado') then
      v_ja := v_ja + 1;
      continue;
    end if;
    select coalesce(max(numero), 0) + 1 into v_numero from fin_titulos_pagar where loja_id = p_loja;
    insert into fin_titulos_pagar (loja_id, numero, fornecedor_id, fornecedor_nome, documento, parcela, total_parcelas, valor, data_emissao,
        data_vencimento, data_competencia, categoria_id, observacao, origem_tipo, origem_id, chave_idempotencia, assinatura, criado_por, criado_por_nome)
    values (p_loja, v_numero, f.id, coalesce(nullif(f.nome_fantasia, ''), f.razao_social), v_doc, x.parcela, x.total_parcelas, x.valor, v_emissao,
        x.vencimento, date_trunc('month', coalesce(v_emissao, x.vencimento))::date, v_cat,
        case when x.regra = 'sem_duplicata' then 'Gerada pela nota de entrada (sem duplicata no XML: vence na emissão)' else 'Gerada pela nota de entrada' end,
        'nota_entrada', p_nota, v_chave, md5(concat_ws('|', 'nota_entrada', p_nota, x.parcela, x.valor, x.vencimento)), p_user, p_user_nome)
    returning * into t;
    v_ids := v_ids || t.id; v_gerados := v_gerados + 1;
    perform fin_registrar_evento(p_loja, 'titulo_pagar', t.id, 'incluido',
      jsonb_build_object('numero', t.numero, 'valor', t.valor, 'vencimento', t.data_vencimento, 'fornecedor', t.fornecedor_nome,
        'origem', 'nota_entrada', 'nota_id', p_nota, 'parcela', t.parcela, 'regra', x.regra), p_user, p_user_nome);
  end loop;

  if v_gerados > 0 then
    perform fin_registrar_evento(p_loja, 'nota_entrada', p_nota, 'titulos_gerados', jsonb_build_object('titulos', to_jsonb(v_ids),
      'regra', v_regra, 'rodada', coalesce(c.estornos, 0), 'diferenca_total', v_soma - coalesce(n.n_valor_nfe, c.valor_total)), p_user, p_user_nome);
  end if;
  return jsonb_build_object('ok', true, 'gerados', v_gerados, 'ja_existiam', v_ja, 'regra', coalesce(v_regra, 'sem_valor'), 'titulos', to_jsonb(v_ids),
    'motivo', case when v_regra is null then 'Nota sem valor e sem duplicata' end);
end $$;

-- ----------------------------------------------------------------------------------------------------------- estornar
create or replace function public.fin_titulos_da_nota_estornar(p_loja bigint, p_nota bigint, p_motivo text default null,
  p_user text default null, p_user_nome text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t fin_titulos_pagar%rowtype; v_canc int := 0; v_pagos int := 0; v_nums int[] := '{}'; v_motivo text;
begin
  perform fin_exigir_loja_propria(p_loja);
  if not fin_cp_da_nota_ligado(p_loja) then
    return jsonb_build_object('ok', true, 'cancelados', 0, 'com_pagamento', 0, 'numeros_com_pagamento', '[]'::jsonb, 'desligado', true);
  end if;
  v_motivo := coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'Entrada da nota desfeita');
  for t in select * from fin_titulos_pagar where loja_id = p_loja and origem_tipo = 'nota_entrada' and origem_id = p_nota
             and status <> 'cancelado' order by parcela, id for update loop
    if t.valor_quitado > 0 then
      v_pagos := v_pagos + 1; v_nums := v_nums || t.numero;
      perform fin_registrar_evento(p_loja, 'titulo_pagar', t.id, 'nota_desfeita_com_pagamento',
        jsonb_build_object('nota_id', p_nota, 'motivo', v_motivo, 'valor_quitado', t.valor_quitado), p_user, p_user_nome);
    else
      update fin_titulos_pagar set status = 'cancelado', cancelado_em = now(), cancelado_por = p_user, cancelado_por_nome = p_user_nome,
          motivo_cancelamento = v_motivo, updated_at = now() where id = t.id;
      perform fin_registrar_evento(p_loja, 'titulo_pagar', t.id, 'cancelado', jsonb_build_object('motivo', v_motivo, 'nota_id', p_nota),
        p_user, p_user_nome);
      v_canc := v_canc + 1;
    end if;
  end loop;
  if v_canc + v_pagos > 0 then
    perform fin_registrar_evento(p_loja, 'nota_entrada', p_nota, 'titulos_estornados',
      jsonb_build_object('cancelados', v_canc, 'com_pagamento', v_pagos, 'numeros_com_pagamento', to_jsonb(v_nums), 'motivo', v_motivo), p_user, p_user_nome);
  end if;
  return jsonb_build_object('ok', true, 'cancelados', v_canc, 'com_pagamento', v_pagos, 'numeros_com_pagamento', to_jsonb(v_nums));
end $$;

-- ------------------------------------------------------------------------------------------------------------ gatilho
create or replace function public.trg_compra_conta_pagar() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_erro text;
begin
  if new.nota_fiscal_id is null or not fin_cp_da_nota_ligado(new.loja_id) then
    return null;
  end if;
  if new.status in ('lancada', 'parcial') then
    begin
      perform fin_titulos_da_nota_gerar(new.loja_id, new.nota_fiscal_id, null, 'Entrada da nota fiscal');
    exception when others then
      -- a entrada no estoque nunca para por causa do financeiro: o motivo fica registrado e aparece na tela da nota
      get stacked diagnostics v_erro = message_text;
      perform fin_registrar_evento(new.loja_id, 'nota_entrada', new.nota_fiscal_id, 'titulos_falha',
        jsonb_build_object('erro', left(v_erro, 300), 'status', new.status), null, 'Entrada da nota fiscal');
    end;
  elsif old.status in ('lancada', 'parcial') and new.status in ('pendente', 'cancelada') then
    perform fin_titulos_da_nota_estornar(new.loja_id, new.nota_fiscal_id,
      case when new.status = 'cancelada' then 'Nota cancelada ou excluída' else 'Entrada da nota desfeita' end, null, 'Entrada da nota fiscal');
  end if;
  return null;
end $$;

drop trigger if exists compras_proprio_conta_pagar on public.compras_proprio;
create trigger compras_proprio_conta_pagar after update of status on public.compras_proprio
  for each row when (old.status is distinct from new.status) execute function public.trg_compra_conta_pagar();

-- ---------------------------------------------------------------------------------------------------------------- grants
do $$ declare f text; begin
  foreach f in array array[
    'fin_cp_da_nota_ligado(bigint)', 'fin_data_duplicata(text)', 'fin_parcelas_da_nota(jsonb,numeric,date,date)',
    'fin_titulos_da_nota_gerar(bigint,bigint,text,text)', 'fin_titulos_da_nota_estornar(bigint,bigint,text,text,text)',
    'trg_compra_conta_pagar()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
