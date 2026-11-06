-- 390 — Financeiro, Fase 4 passo 5: plano de contas ligado à DRE no padrão de restaurante.
-- Plano: docs/superpowers/plans/2026-11-03-norte-erp-plano-mestre.md (Fase 4, item 5). Depende da 285 (fin_categorias).
--
-- O vínculo categoria → linha da DRE já existe (fin_categorias.grupo_dre, 285). Faltava, para o padrão de restaurante:
--  1) a linha OCUPAÇÃO (aluguel, condomínio, energia, água, gás), separada das despesas operacionais:
--     grupo novo 'despesa_ocupacao' (CHECK, fin_categoria_salvar e categorias padrão);
--  2) TAXA DE CARTÃO nas DEDUÇÕES (não em despesas financeiras): categoria padrão nova 'ded_taxas_cartao'
--     ("Taxas de cartão (maquininha)", deduções). A antiga 'fin_taxas' ("Taxas de cartão e bancárias", financeiras)
--     passa a se chamar "Tarifas bancárias" (só se o nome ainda é o original e não há outra com esse nome).
-- Reclassifica só as categorias PADRÃO que ainda estão como a semente deixou (aluguel e energia em 'despesa_operacional');
-- o que alguém já mudou à mão fica como está. Cada mudança vira evento em fin_eventos (quem: "Migration 390").
-- A DRE e o fluxo de caixa em si são leitura no servidor (lib/financeiro/dre-puro.ts, fluxo-caixa-puro.ts): sem tabela nova.
-- Teste em produção, em ROLLBACK, loja 19: bash scripts/testes-sql/390_rodar.sh (espera "390 DRE OCUPACAO OK").

begin;

alter table public.fin_categorias drop constraint if exists fin_categorias_grupo_dre_check;
alter table public.fin_categorias add constraint fin_categorias_grupo_dre_check check (grupo_dre in (
  'receita_bruta', 'deducoes', 'cmv', 'despesa_operacional', 'despesa_pessoal', 'despesa_ocupacao',
  'despesa_administrativa', 'despesa_financeira', 'receita_financeira', 'imposto_resultado', 'investimento', 'outras'));

-- Igual à 285, só com 'despesa_ocupacao' na lista de linhas válidas.
create or replace function public.fin_categoria_salvar(p_loja bigint, p_id bigint, p_dados jsonb, p_user text default null,
  p_user_nome text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k fin_categorias%rowtype; v_nome text; v_tipo text; v_grupo text; v_cc bigint;
begin
  perform fin_exigir_loja_propria(p_loja);
  v_nome := btrim(coalesce(p_dados->>'nome', ''));
  if length(v_nome) < 2 then raise exception 'Informe o nome da categoria' using errcode = '22023'; end if;
  v_tipo := coalesce(nullif(p_dados->>'tipo', ''), 'despesa');
  if v_tipo not in ('despesa', 'receita') then raise exception 'Tipo de categoria inválido' using errcode = '22023'; end if;
  v_grupo := coalesce(nullif(p_dados->>'grupo_dre', ''), 'outras');
  if v_grupo not in ('receita_bruta', 'deducoes', 'cmv', 'despesa_operacional', 'despesa_pessoal', 'despesa_ocupacao',
      'despesa_administrativa', 'despesa_financeira', 'receita_financeira', 'imposto_resultado', 'investimento', 'outras') then
    raise exception 'Linha da DRE inválida' using errcode = '22023';
  end if;
  v_cc := nullif(p_dados->>'categoria_contabil_id', '')::bigint;
  if v_cc is not null and not exists (select 1 from categorias_contabeis where id = v_cc and loja_id = p_loja) then
    raise exception 'Categoria contábil não é desta loja' using errcode = '22023';
  end if;
  if exists (select 1 from fin_categorias where loja_id = p_loja and lower(nome) = lower(v_nome) and id is distinct from p_id) then
    raise exception 'Já existe uma categoria com esse nome' using errcode = '22023';
  end if;
  if p_id is null then
    insert into fin_categorias (loja_id, codigo, nome, tipo, grupo_dre, categoria_contabil_id)
    values (p_loja, nullif(btrim(coalesce(p_dados->>'codigo', '')), ''), v_nome, v_tipo, v_grupo, v_cc) returning * into k;
    perform fin_registrar_evento(p_loja, 'categoria', k.id, 'criada', jsonb_build_object('nome', k.nome, 'grupo_dre', k.grupo_dre), p_user, p_user_nome);
    return jsonb_build_object('ok', true, 'id', k.id, 'criada', true);
  end if;
  select * into k from fin_categorias where id = p_id and loja_id = p_loja for update;
  if not found then raise exception 'Categoria não encontrada' using errcode = '22023'; end if;
  if v_tipo <> k.tipo and (exists (select 1 from fin_lancamentos where categoria_id = k.id)
      or (to_regclass('public.fin_titulos_pagar') is not null and exists (select 1 from fin_titulos_pagar where categoria_id = k.id))) then
    raise exception 'A categoria já é usada em títulos ou lançamentos: o tipo (despesa/receita) não muda' using errcode = '22023';
  end if;
  update fin_categorias set codigo = nullif(btrim(coalesce(p_dados->>'codigo', '')), ''), nome = v_nome, tipo = v_tipo, grupo_dre = v_grupo,
      categoria_contabil_id = v_cc, ativa = coalesce((p_dados->>'ativa')::boolean, k.ativa), updated_at = now()
    where id = k.id returning * into k;
  perform fin_registrar_evento(p_loja, 'categoria', k.id, 'editada', jsonb_build_object('nome', k.nome, 'grupo_dre', k.grupo_dre, 'ativa', k.ativa), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'id', k.id, 'criada', false);
end $$;

-- Semente (idempotente) no padrão de restaurante. Loja que fica própria depois usa o botão "Criar categorias padrão".
create or replace function public.fin_categorias_semear(p_loja bigint) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform fin_exigir_loja_propria(p_loja);
  with ins as (
    insert into fin_categorias (loja_id, padrao, nome, tipo, grupo_dre)
    select p_loja, v.padrao, v.nome, v.tipo, v.grupo from (values
      ('cmv_revenda', 'Compra de mercadoria para revenda', 'despesa', 'cmv'),
      ('cmv_insumos', 'Matéria-prima e insumos', 'despesa', 'cmv'),
      ('cmv_embalagens', 'Embalagens', 'despesa', 'cmv'),
      ('pessoal_folha', 'Folha de pagamento e encargos', 'despesa', 'despesa_pessoal'),
      ('oper_aluguel', 'Aluguel e condomínio', 'despesa', 'despesa_ocupacao'),
      ('oper_energia', 'Energia, água e gás', 'despesa', 'despesa_ocupacao'),
      ('oper_manutencao', 'Manutenção e reparos', 'despesa', 'despesa_operacional'),
      ('oper_marketing', 'Marketing e publicidade', 'despesa', 'despesa_operacional'),
      ('adm_telefone', 'Telefone e internet', 'despesa', 'despesa_administrativa'),
      ('adm_servicos', 'Serviços contábeis e jurídicos', 'despesa', 'despesa_administrativa'),
      ('adm_material', 'Material de limpeza e escritório', 'despesa', 'despesa_administrativa'),
      ('fin_taxas', 'Tarifas bancárias', 'despesa', 'despesa_financeira'),
      ('fin_juros', 'Juros e multas pagos', 'despesa', 'despesa_financeira'),
      ('ded_impostos', 'Impostos sobre vendas', 'despesa', 'deducoes'),
      ('ded_taxas_cartao', 'Taxas de cartão (maquininha)', 'despesa', 'deducoes'),
      ('outras_despesas', 'Outras despesas', 'despesa', 'outras'),
      ('rec_vendas', 'Venda de mercadorias e pratos', 'receita', 'receita_bruta'),
      ('rec_outras', 'Outras receitas', 'receita', 'outras')
    ) as v(padrao, nome, tipo, grupo)
    on conflict do nothing returning 1
  ) select count(*) into n from ins;
  return n;
end $$;
revoke all on function public.fin_categorias_semear(bigint) from public, anon, authenticated;
revoke all on function public.fin_categoria_salvar(bigint, bigint, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.fin_categorias_semear(bigint) to service_role;
grant execute on function public.fin_categoria_salvar(bigint, bigint, jsonb, text, text) to service_role;

-- Categorias padrão que já existem: só as que ainda estão como a semente da 285 deixou.
do $$ declare k record; begin
  for k in update fin_categorias c set grupo_dre = 'despesa_ocupacao', updated_at = now()
             from lojas l
            where l.id = c.loja_id and l.modo_estoque = 'proprio'
              and c.padrao in ('oper_aluguel', 'oper_energia') and c.grupo_dre = 'despesa_operacional'
           returning c.loja_id, c.id, c.nome, c.grupo_dre loop
    perform fin_registrar_evento(k.loja_id, 'categoria', k.id, 'editada',
      jsonb_build_object('nome', k.nome, 'grupo_dre', k.grupo_dre, 'motivo', 'Linha Ocupação da DRE (migration 390)'), null, 'Migration 390');
  end loop;
  for k in update fin_categorias c set nome = 'Tarifas bancárias', updated_at = now()
             from lojas l
            where l.id = c.loja_id and l.modo_estoque = 'proprio'
              and c.padrao = 'fin_taxas' and c.nome = 'Taxas de cartão e bancárias'
              and not exists (select 1 from fin_categorias o where o.loja_id = c.loja_id and lower(o.nome) = 'tarifas bancárias')
           returning c.loja_id, c.id, c.nome, c.grupo_dre loop
    perform fin_registrar_evento(k.loja_id, 'categoria', k.id, 'editada',
      jsonb_build_object('nome', k.nome, 'grupo_dre', k.grupo_dre, 'motivo', 'Taxa de cartão passa às deduções (migration 390)'), null, 'Migration 390');
  end loop;
  for k in select id from lojas where modo_estoque = 'proprio' loop
    perform fin_categorias_semear(k.id);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
