-- 360 — Conta a pagar da nota de entrada: DECISÕES DO DONO (Ramon, 05/11/2026) sobre a 340. Depende da 285/286 (fin_*),
-- 313 (_data_entrada_compra, estoque_movimentos_efetivo da 311) e 340 (fin_titulos_da_nota_*, gatilho). SÓ loja própria.
--
-- 1. Nota sem duplicata: à vista, vence na emissão (já era assim na 340; aqui só sai a marca de "decisão pendente").
-- 2. Categoria: NÃO existe categoria padrão (sai o cmv_revenda/cmv_insumos e a ligação pela categoria contábil da 340). A
--    categoria vem da FAMÍLIA do produto, por um mapa família → categoria financeira por loja (fin_familia_categoria, tela só
--    dev Financeiro › Categoria por família). Vale a família de MAIOR VALOR entre os itens que geram conta a pagar (produto
--    sem família é um grupo próprio; empate: família antes de "sem família", depois o menor código). Família predominante
--    sem categoria (ou categoria inativa/receita) = conta SEM categoria, a tela mostra "A definir". Não se inventa categoria.
--    RATEIO: o contas a pagar guarda UMA categoria por título (fin_titulos_pagar.categoria_id; não há tabela de rateio no
--    modelo fin_*), por isso a predominante. Espelho: categoriaDaNota em lib/financeiro/titulos-da-nota-puro.ts.
-- 3. Competência: mês da ENTRADA da nota no estoque (data efetiva dos movimentos de entrada da compra, a mesma do custo/CMV;
--    sem movimento, _data_entrada_compra = dhSaiEnt/dSaiEnt do XML ou emissão), não da emissão. Vencimento = o da duplicata.
-- 4. Notas antigas não ganham conta sozinhas. fin_notas_sem_conta lista as notas confirmadas de loja própria sem conta da
--    rodada atual (tela só dev "Notas sem conta a pagar"); fin_titulos_da_nota_gerar_manual gera MESMO COM a chave
--    lojas.fin_cp_da_nota_ativo desligada (decisão humana explícita). A geração automática (gatilho) continua só com a chave.
--    Por isso o ESTORNO não olha mais a chave: conta gerada à mão numa loja sem a chave também sai quando a nota é desfeita
--    (antes ficaria órfã). Sem conta da nota, o estorno não faz nada (nem evento).
-- 5. Parcela paga em nota desfeita: decide o GERENTE. fin_pendencias_nota_desfeita lista; fin_nota_desfeita_decidir faz
--    'estornar' (estorna cada pagamento ativo com o fin_pagamento_estornar que já existe e cancela a conta) ou 'manter'
--    (registra a decisão em fin_eventos). Permissão nova 'Financeiro - Decidir nota desfeita' (cargo Gerente; Admin e
--    AdminLoja já têm tudo). A pendência volta se a nota for confirmada e desfeita de novo com a parcela ainda paga.
--
-- Assinaturas da 340 iguais (o TS e o desktop não quebram). Nenhuma tabela existente muda; nada é apagado; não há carga.
-- Aplicar (manual, com backup e OK do dono; numa transação):
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 360_conta_pagar_nota_decisoes.sql
-- Teste: bash scripts/testes-sql/360_rodar.sh (produção, BEGIN … ROLLBACK, loja 19). Depois: desktop/scripts/gerar-schema.sh.

begin;
set lock_timeout = '5s';

insert into permissoes (nome) values
  ('Financeiro - Decidir nota desfeita')
on conflict (nome) do nothing;

insert into public.cargo_permissao (cargo_id, permissao_id)
select c.id, p.id from public.cargos c join public.permissoes p on p.nome = 'Financeiro - Decidir nota desfeita'
where c.nome = 'Gerente'
on conflict do nothing;

-- --------------------------------------------------------------------------------------- mapa família → categoria
-- Configuração (não é lançamento): muda e sai; cada mudança vai para fin_eventos (entidade 'familia_categoria').
-- Sem FK para familias de propósito: a família pode ser recadastrada pela sincronização; a função de salvar confere.
create table if not exists public.fin_familia_categoria (
  loja_id             bigint not null references public.lojas(id),
  codigo_familia      bigint not null,
  categoria_id        bigint not null,
  atualizado_por      text,
  atualizado_por_nome text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (loja_id, codigo_familia),
  foreign key (categoria_id, loja_id) references public.fin_categorias (id, loja_id)
);
alter table public.fin_familia_categoria enable row level security;
drop policy if exists fin_familia_categoria_select_por_loja on public.fin_familia_categoria;
create policy fin_familia_categoria_select_por_loja on public.fin_familia_categoria for select
  using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()));
revoke all on public.fin_familia_categoria from anon, authenticated;
grant all on public.fin_familia_categoria to service_role;

create or replace function public.fin_familia_categoria_salvar(p_loja bigint, p_codigo_familia bigint, p_categoria bigint,
  p_user text default null, p_user_nome text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_antes bigint; v_nome text;
begin
  perform fin_exigir_loja_propria(p_loja);
  select nome into v_nome from familias where loja_id = p_loja and codigo_familia = p_codigo_familia;
  if not found then raise exception 'Família não encontrada nesta loja' using errcode = '22023'; end if;
  if p_categoria is not null and not exists (select 1 from fin_categorias where id = p_categoria and loja_id = p_loja and tipo = 'despesa' and ativa) then
    raise exception 'Escolha uma categoria de despesa ativa desta loja' using errcode = '22023';
  end if;
  select categoria_id into v_antes from fin_familia_categoria where loja_id = p_loja and codigo_familia = p_codigo_familia for update;
  if v_antes is not distinct from p_categoria then
    return jsonb_build_object('ok', true, 'mudou', false);
  end if;
  if p_categoria is null then
    delete from fin_familia_categoria where loja_id = p_loja and codigo_familia = p_codigo_familia;
  else
    insert into fin_familia_categoria (loja_id, codigo_familia, categoria_id, atualizado_por, atualizado_por_nome)
    values (p_loja, p_codigo_familia, p_categoria, p_user, p_user_nome)
    on conflict (loja_id, codigo_familia) do update set categoria_id = excluded.categoria_id, atualizado_por = excluded.atualizado_por,
      atualizado_por_nome = excluded.atualizado_por_nome, updated_at = now();
  end if;
  perform fin_registrar_evento(p_loja, 'familia_categoria', p_codigo_familia, case when p_categoria is null then 'desligada' else 'ligada' end,
    jsonb_build_object('familia', v_nome, 'antes', v_antes, 'depois', p_categoria), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'mudou', true);
end $$;

-- Famílias da loja (ativas ou com produto) com a categoria ligada e quantos produtos têm cada uma. Para a tela do mapa.
create or replace function public.fin_familia_categoria_listar(p_loja bigint)
returns table (codigo_familia bigint, nome text, inativa boolean, produtos int, categoria_id bigint, categoria_nome text, categoria_ok boolean)
language sql stable security definer set search_path = public as $$
  select f.codigo_familia, f.nome::text, f.inativo,
         (select count(*) from produtos p where p.loja_id = p_loja and p.codigo_familia = f.codigo_familia)::int,
         m.categoria_id, k.nome, coalesce(k.ativa and k.tipo = 'despesa', false)
  from familias f
  left join fin_familia_categoria m on m.loja_id = f.loja_id and m.codigo_familia = f.codigo_familia
  left join fin_categorias k on k.id = m.categoria_id and k.loja_id = m.loja_id
  where f.loja_id = p_loja and f.codigo_familia is not null
    and (not f.inativo or m.categoria_id is not null
         or exists (select 1 from produtos p where p.loja_id = p_loja and p.codigo_familia = f.codigo_familia))
  order by lower(f.nome), f.codigo_familia
$$;

-- ---------------------------------------------------------------------------------- categoria e competência da nota
-- Espelho de categoriaDaNota (lib/financeiro/titulos-da-nota-puro.ts). Itens = os da compra da nota que geram conta a pagar;
-- valor do item = valor total do item na nota (vTotalItem), senão o valor dos produtos.
create or replace function public.fin_categoria_da_nota(p_loja bigint, p_nota bigint)
returns table (categoria_id bigint, codigo_familia bigint, motivo text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_fam bigint; v_cat bigint;
begin
  select g.fam into v_fam
  from (select p.codigo_familia as fam, sum(round(coalesce(i.valor_total_item, i.valor_total), 2)) as valor
        from compras_proprio c
        join compras_proprio_itens i on i.compra_id = c.id
        left join produtos p on p.loja_id = c.loja_id and p.codigo_produto = i.codigo_produto
        where c.loja_id = p_loja and c.nota_fiscal_id = p_nota and i.gera_conta_pagar
        group by p.codigo_familia) g
  order by g.valor desc, (g.fam is null), g.fam
  limit 1;
  if not found then return query select null::bigint, null::bigint, 'sem_itens'::text; return; end if;
  if v_fam is null then return query select null::bigint, null::bigint, 'sem_familia'::text; return; end if;
  select m.categoria_id into v_cat from fin_familia_categoria m
    join fin_categorias k on k.id = m.categoria_id and k.loja_id = m.loja_id and k.ativa and k.tipo = 'despesa'
   where m.loja_id = p_loja and m.codigo_familia = v_fam;
  return query select v_cat, v_fam, case when v_cat is null then 'familia_sem_categoria' else 'mapeada' end;
end $$;

-- Data da ENTRADA da nota no estoque (para a competência): a data efetiva dos movimentos de entrada ainda lançados da compra
-- (estoque_movimentos_efetivo: já com correção de data da 316); sem movimento (nada movimenta estoque), a data de entrada da
-- nota (_data_entrada_compra, 313); sem compra, null.
create or replace function public.fin_data_entrada_da_nota(p_loja bigint, p_nota bigint) returns date
language plpgsql stable security definer set search_path = public as $$
declare v_comp bigint; v date;
begin
  select id into v_comp from compras_proprio where loja_id = p_loja and nota_fiscal_id = p_nota order by id desc limit 1;
  if v_comp is null then return null; end if;
  select min(m.data_ref) into v from compras_proprio_itens i join estoque_movimentos_efetivo m on m.id = i.movimento_id
   where i.compra_id = v_comp and i.lancado;
  if v is null then select d.data into v from _data_entrada_compra(p_loja, v_comp) d; end if;
  return v;
end $$;

-- ------------------------------------------------------------------------------------------------------------- gerar
-- Corpo da 340 com as decisões: categoria pela família, competência pela entrada, chave só no automático.
create or replace function public._fin_titulos_da_nota_gerar(p_loja bigint, p_nota bigint, p_user text, p_user_nome text, p_manual boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c compras_proprio%rowtype; n notas_fiscais%rowtype; f fornecedores%rowtype; v_cod bigint; v_cat bigint; v_fam bigint; v_motcat text;
  x record; v_chave text; v_numero int; v_doc text; v_gerados int := 0; v_ja int := 0; v_regra text; v_soma numeric := 0;
  v_ids bigint[] := '{}'; t fin_titulos_pagar%rowtype; v_emissao date; v_entrada date; v_comp date;
begin
  perform fin_exigir_loja_propria(p_loja);
  if not p_manual and not fin_cp_da_nota_ligado(p_loja) then
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

  v_cod := fornecedor_da_nota_sefaz(p_loja, coalesce(n.c_cnpj_cpf, c.fornecedor_cnpj), coalesce(n.c_razao_social, c.fornecedor_nome), n.c_nome, n.c_inscricao);
  if v_cod is null then raise exception 'Nota sem CNPJ/CPF do fornecedor: não dá para gerar a conta a pagar' using errcode = '22023'; end if;
  select * into f from fornecedores where loja_id = p_loja and codigo_omie = v_cod order by id limit 1;
  if not found then raise exception 'Fornecedor da nota não encontrado no cadastro' using errcode = '22023'; end if;

  -- 360: categoria = a da família de maior valor; sem categoria ligada = sem categoria ("A definir"). Sem padrão.
  select k.categoria_id, k.codigo_familia, k.motivo into v_cat, v_fam, v_motcat from fin_categoria_da_nota(p_loja, p_nota) k;
  v_emissao := coalesce(n.d_emissao_nfe, c.emissao);
  v_entrada := fin_data_entrada_da_nota(p_loja, p_nota); -- 360: competência pela entrada
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
    v_comp := date_trunc('month', coalesce(v_entrada, v_emissao, x.vencimento))::date;
    select coalesce(max(numero), 0) + 1 into v_numero from fin_titulos_pagar where loja_id = p_loja;
    insert into fin_titulos_pagar (loja_id, numero, fornecedor_id, fornecedor_nome, documento, parcela, total_parcelas, valor, data_emissao,
        data_vencimento, data_competencia, categoria_id, observacao, origem_tipo, origem_id, chave_idempotencia, assinatura, criado_por, criado_por_nome)
    values (p_loja, v_numero, f.id, coalesce(nullif(f.nome_fantasia, ''), f.razao_social), v_doc, x.parcela, x.total_parcelas, x.valor, v_emissao,
        x.vencimento, v_comp, v_cat,
        case when p_manual then 'Gerada à mão pela nota de entrada' else 'Gerada pela nota de entrada' end
          || case when x.regra = 'sem_duplicata' then ' (sem duplicata no XML: à vista, vence na emissão)' else '' end,
        'nota_entrada', p_nota, v_chave, md5(concat_ws('|', 'nota_entrada', p_nota, x.parcela, x.valor, x.vencimento)), p_user, p_user_nome)
    returning * into t;
    v_ids := v_ids || t.id; v_gerados := v_gerados + 1;
    perform fin_registrar_evento(p_loja, 'titulo_pagar', t.id, 'incluido',
      jsonb_build_object('numero', t.numero, 'valor', t.valor, 'vencimento', t.data_vencimento, 'fornecedor', t.fornecedor_nome,
        'origem', 'nota_entrada', 'nota_id', p_nota, 'parcela', t.parcela, 'regra', x.regra, 'manual', p_manual,
        'categoria_id', v_cat, 'familia', v_fam, 'motivo_categoria', v_motcat, 'competencia', v_comp), p_user, p_user_nome);
  end loop;

  if v_gerados > 0 then
    perform fin_registrar_evento(p_loja, 'nota_entrada', p_nota, 'titulos_gerados', jsonb_build_object('titulos', to_jsonb(v_ids),
      'regra', v_regra, 'rodada', coalesce(c.estornos, 0), 'diferenca_total', v_soma - coalesce(n.n_valor_nfe, c.valor_total),
      'manual', p_manual, 'categoria_id', v_cat, 'familia', v_fam, 'motivo_categoria', v_motcat, 'data_entrada', v_entrada), p_user, p_user_nome);
  end if;
  return jsonb_build_object('ok', true, 'gerados', v_gerados, 'ja_existiam', v_ja, 'regra', coalesce(v_regra, 'sem_valor'), 'titulos', to_jsonb(v_ids),
    'categoria_id', v_cat, 'motivo_categoria', v_motcat,
    'motivo', case when v_regra is null then 'Nota sem valor e sem duplicata' end);
end $$;

-- Automático (gatilho) e "Gerar agora" antigos: mesma assinatura da 340, respeita a chave da loja.
create or replace function public.fin_titulos_da_nota_gerar(p_loja bigint, p_nota bigint, p_user text default null,
  p_user_nome text default null) returns jsonb
language sql security definer set search_path = public as $$
  select _fin_titulos_da_nota_gerar(p_loja, p_nota, p_user, p_user_nome, false)
$$;

-- À mão (tela "Notas sem conta a pagar" e "Gerar agora" da nota): decisão humana, vale com a chave desligada.
create or replace function public.fin_titulos_da_nota_gerar_manual(p_loja bigint, p_nota bigint, p_user text default null,
  p_user_nome text default null) returns jsonb
language sql security definer set search_path = public as $$
  select _fin_titulos_da_nota_gerar(p_loja, p_nota, p_user, p_user_nome, true)
$$;

-- ----------------------------------------------------------------------------------------------------------- estornar
-- 340 sem a chave: a chave liga só a GERAÇÃO automática. Sem conta da nota, não faz nada.
create or replace function public.fin_titulos_da_nota_estornar(p_loja bigint, p_nota bigint, p_motivo text default null,
  p_user text default null, p_user_nome text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t fin_titulos_pagar%rowtype; v_canc int := 0; v_pagos int := 0; v_nums int[] := '{}'; v_motivo text;
begin
  perform fin_exigir_loja_propria(p_loja);
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
-- Mesmo gatilho da 340 (não é recriado: só a função muda). Gerar: só com a chave. Estornar: sempre, em loja própria.
create or replace function public.trg_compra_conta_pagar() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_erro text;
begin
  if new.nota_fiscal_id is null or not exists (select 1 from lojas where id = new.loja_id and modo_estoque = 'proprio') then
    return null;
  end if;
  if new.status in ('lancada', 'parcial') then
    if not fin_cp_da_nota_ligado(new.loja_id) then return null; end if;
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

-- ------------------------------------------------------------------------------------------- notas sem conta a pagar
-- Notas de entrada confirmadas (compra 'lancada'/'parcial') de loja própria, não excluídas nem canceladas na SEFAZ, com
-- algo a pagar (alguma duplicata ou valor), SEM conta ativa e sem conta da rodada atual (conta cancelada à mão na rodada
-- atual = decisão já tomada, não volta). p_loja null = todas as lojas próprias. Mostra a prévia: parcelas, categoria e
-- competência que a geração usaria, e a última falha do gatilho (se houver).
create or replace function public.fin_notas_sem_conta(p_loja bigint default null, p_limite int default 500)
returns table (loja_id bigint, loja_nome text, chave_ligada boolean, nota_id bigint, compra_id bigint, numero text, fornecedor_nome text,
  fornecedor_cnpj text, emissao date, data_entrada date, valor_total numeric, status_compra text, regra text, parcelas jsonb,
  categoria_id bigint, categoria_nome text, familia_nome text, motivo_categoria text, ultima_falha text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with base as (
    select c.loja_id, l.nome::text as loja_nome, l.fin_cp_da_nota_ativo as chave, c.nota_fiscal_id as nota_id, c.id as compra_id,
           coalesce(nullif(ltrim(coalesce(n.c_numero_nfe, c.numero, ''), '0'), ''), c.numero)::text as numero,
           coalesce(n.c_razao_social, c.fornecedor_nome)::text as forn, coalesce(n.c_cnpj_cpf, c.fornecedor_cnpj)::text as cnpj,
           coalesce(n.d_emissao_nfe, c.emissao) as emissao, coalesce(n.n_valor_nfe, c.valor_total) as valor, c.status, n.full_object,
           c.estornos
    from compras_proprio c
    join lojas l on l.id = c.loja_id and l.modo_estoque = 'proprio'
    join notas_fiscais n on n.id = c.nota_fiscal_id and n.loja_id = c.loja_id and n.deleted_at is null
    where (p_loja is null or c.loja_id = p_loja) and c.status in ('lancada', 'parcial')
      and coalesce(n.full_object->'infoCadastro'->>'cCancelada', 'N') <> 'S'
      and (not exists (select 1 from compras_proprio_itens i where i.compra_id = c.id)
           or exists (select 1 from compras_proprio_itens i where i.compra_id = c.id and i.gera_conta_pagar))
      and not exists (select 1 from fin_titulos_pagar t where t.loja_id = c.loja_id and t.origem_tipo = 'nota_entrada'
                        and t.origem_id = c.nota_fiscal_id
                        and (t.status <> 'cancelado' or t.chave_idempotencia like 'nota_entrada:' || c.nota_fiscal_id || ':' || c.estornos || ':%'))
  )
  select b.loja_id, b.loja_nome, b.chave, b.nota_id, b.compra_id, b.numero, b.forn, b.cnpj, b.emissao,
         fin_data_entrada_da_nota(b.loja_id, b.nota_id), round(b.valor, 2), b.status, p.regra, p.parcelas,
         k.categoria_id, kc.nome::text, f.nome::text, k.motivo,
         (select e.detalhe->>'erro' from fin_eventos e where e.loja_id = b.loja_id and e.entidade = 'nota_entrada' and e.entidade_id = b.nota_id
           order by e.id desc limit 1)
  from base b
  cross join lateral (
    select min(x.regra) as regra,
           jsonb_agg(jsonb_build_object('parcela', x.parcela, 'total', x.total_parcelas, 'vencimento', x.vencimento, 'valor', x.valor) order by x.parcela) as parcelas
    from fin_parcelas_da_nota(b.full_object, b.valor, b.emissao) x
  ) p
  cross join lateral fin_categoria_da_nota(b.loja_id, b.nota_id) k
  left join fin_categorias kc on kc.id = k.categoria_id
  left join familias f on f.loja_id = b.loja_id and f.codigo_familia = k.codigo_familia
  where p.parcelas is not null
  order by b.loja_id, b.emissao desc nulls last, b.nota_id desc
  limit greatest(1, least(coalesce(p_limite, 500), 2000));
end $$;

-- ------------------------------------------------------------------------------- parcela paga em nota desfeita (gerente)
-- Pendente = conta da nota ativa com algo pago, a entrada da nota NÃO está confirmada (desfeita, cancelada, excluída) e a
-- última notícia da conta é 'nota_desfeita_com_pagamento' (não houve 'nota_desfeita_mantida' depois).
create or replace function public.fin_pendencias_nota_desfeita(p_loja bigint)
returns table (titulo_id bigint, numero int, nota_id bigint, documento text, fornecedor_nome text, parcela int, total_parcelas int,
  valor numeric, valor_quitado numeric, data_vencimento date, status text, status_compra text, desfeita_em timestamptz, pagamentos int)
language sql stable security definer set search_path = public as $$
  select t.id, t.numero, t.origem_id, t.documento, t.fornecedor_nome, t.parcela, t.total_parcelas, t.valor, t.valor_quitado,
         t.data_vencimento, t.status, c.status, ev.created_at,
         (select count(*) from fin_pagamentos pg where pg.titulo_id = t.id and pg.estornado_em is null)::int
  from fin_titulos_pagar t
  left join lateral (select cp.status from compras_proprio cp where cp.loja_id = t.loja_id and cp.nota_fiscal_id = t.origem_id
                     order by cp.id desc limit 1) c on true
  join lateral (select e.tipo, e.created_at from fin_eventos e where e.loja_id = t.loja_id and e.entidade = 'titulo_pagar' and e.entidade_id = t.id
                  and e.tipo in ('nota_desfeita_com_pagamento', 'nota_desfeita_mantida') order by e.id desc limit 1) ev on true
  where t.loja_id = p_loja and t.origem_tipo = 'nota_entrada' and t.status <> 'cancelado' and t.valor_quitado > 0
    and coalesce(c.status, 'cancelada') not in ('lancada', 'parcial')
    and ev.tipo = 'nota_desfeita_com_pagamento'
  order by ev.created_at, t.id
$$;

-- p_acao 'estornar': estorna cada pagamento ativo (fin_pagamento_estornar, que devolve o valor ao extrato) e cancela a conta.
-- p_acao 'manter': a conta fica como está; a decisão fica em fin_eventos. Motivo obrigatório. Repetir a mesma decisão = duplicado.
create or replace function public.fin_nota_desfeita_decidir(p_loja bigint, p_titulo bigint, p_acao text, p_motivo text,
  p_user text default null, p_user_nome text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t fin_titulos_pagar%rowtype; v_motivo text := btrim(coalesce(p_motivo, '')); pg record; v_est int := 0; v_ult text;
begin
  perform fin_exigir_loja_propria(p_loja);
  if p_acao not in ('estornar', 'manter') then raise exception 'Decisão inválida' using errcode = '22023'; end if;
  if length(v_motivo) < 3 then raise exception 'Informe o motivo da decisão' using errcode = '22023'; end if;
  select * into t from fin_titulos_pagar where id = p_titulo and loja_id = p_loja for update;
  if not found then raise exception 'Conta a pagar não encontrada' using errcode = '22023'; end if;
  select e.tipo into v_ult from fin_eventos e where e.loja_id = p_loja and e.entidade = 'titulo_pagar' and e.entidade_id = t.id
    and e.tipo in ('nota_desfeita_com_pagamento', 'nota_desfeita_mantida', 'nota_desfeita_estornada') order by e.id desc limit 1;
  if (p_acao = 'manter' and v_ult = 'nota_desfeita_mantida') or (p_acao = 'estornar' and v_ult = 'nota_desfeita_estornada') then
    return jsonb_build_object('ok', true, 'duplicado', true, 'status', t.status);
  end if;
  if not exists (select 1 from fin_pendencias_nota_desfeita(p_loja) x where x.titulo_id = t.id) then
    raise exception 'Esta conta não tem decisão pendente (a nota foi confirmada de novo ou a decisão já foi tomada)' using errcode = '22023';
  end if;

  if p_acao = 'manter' then
    perform fin_registrar_evento(p_loja, 'titulo_pagar', t.id, 'nota_desfeita_mantida',
      jsonb_build_object('nota_id', t.origem_id, 'motivo', v_motivo, 'valor_quitado', t.valor_quitado), p_user, p_user_nome);
    return jsonb_build_object('ok', true, 'duplicado', false, 'status', t.status);
  end if;

  for pg in select id from fin_pagamentos where titulo_id = t.id and loja_id = p_loja and estornado_em is null order by id loop
    perform fin_pagamento_estornar(p_loja, pg.id, 'Nota desfeita: ' || v_motivo, p_user, p_user_nome);
    v_est := v_est + 1;
  end loop;
  select * into t from fin_titulos_pagar where id = p_titulo;
  if t.valor_quitado <> 0 then raise exception 'O pagamento não foi estornado por inteiro' using errcode = '22023'; end if;
  update fin_titulos_pagar set status = 'cancelado', cancelado_em = now(), cancelado_por = p_user, cancelado_por_nome = p_user_nome,
      motivo_cancelamento = 'Nota desfeita: pagamento estornado (' || v_motivo || ')', updated_at = now() where id = t.id;
  perform fin_registrar_evento(p_loja, 'titulo_pagar', t.id, 'cancelado', jsonb_build_object('motivo', v_motivo, 'nota_id', t.origem_id), p_user, p_user_nome);
  perform fin_registrar_evento(p_loja, 'titulo_pagar', t.id, 'nota_desfeita_estornada',
    jsonb_build_object('nota_id', t.origem_id, 'motivo', v_motivo, 'pagamentos_estornados', v_est), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'duplicado', false, 'status', 'cancelado', 'pagamentos_estornados', v_est);
end $$;

-- ---------------------------------------------------------------------------------------------------------------- grants
do $$ declare f text; begin
  foreach f in array array[
    'fin_familia_categoria_salvar(bigint,bigint,bigint,text,text)', 'fin_familia_categoria_listar(bigint)',
    'fin_categoria_da_nota(bigint,bigint)', 'fin_data_entrada_da_nota(bigint,bigint)',
    '_fin_titulos_da_nota_gerar(bigint,bigint,text,text,boolean)', 'fin_titulos_da_nota_gerar(bigint,bigint,text,text)',
    'fin_titulos_da_nota_gerar_manual(bigint,bigint,text,text)', 'fin_titulos_da_nota_estornar(bigint,bigint,text,text,text)',
    'trg_compra_conta_pagar()', 'fin_notas_sem_conta(bigint,int)', 'fin_pendencias_nota_desfeita(bigint)',
    'fin_nota_desfeita_decidir(bigint,bigint,text,text,text,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
