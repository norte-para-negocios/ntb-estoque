-- 260 — Fase F [F1/F2]: emissão de NF-e modelo 55 de SAÍDA no estoque próprio (devolução ao fornecedor e transferência
-- entre lojas). Plano: docs/superpowers/plans/2026-10-20-fase-f-nfe-saida.md. Depende da 230 (_exigir_periodo_aberto) e
-- da 231 (devolucoes_fornecedor).
--
-- O banco guarda: configuração fiscal da loja (CRT, séries, autXML, CSTs padrão), a numeração por (loja, ambiente, série)
-- e cada NF-e emitida (XML assinado, XML autorizado procNFe, protocolo, cancelamento, CC-e) com eventos append-only.
-- A rede (assinatura, SEFAZ) fica no servidor Next (lib/nfe-saida); aqui só o estado, com as regras que precisam de trava:
--   * número sem buraco: um número reservado fica preso à NF-e até ela ser autorizada/denegada; rejeitada → reenvia com o
--     MESMO número; descartada → o número volta para a próxima reserva (a SEFAZ não guarda número rejeitado);
--   * no máximo UMA NF-e ativa por documento de origem e ambiente (duplo clique devolve a mesma);
--   * homologação (tp_amb 2) nunca mexe no documento de origem: só a autorização em PRODUÇÃO marca a devolução 'emitida';
--   * fato vindo da SEFAZ (autorização, cancelamento, CC-e) é sempre gravado, mesmo com mês fechado (a trava de período é
--     conferida ANTES de chamar a SEFAZ: nfe_checar_evento).
--
-- SÓ ADITIVA (+ troca do CHECK de devolucoes_fornecedor_eventos.tipo). Aplicar (manual, com backup e OK do dono), DEPOIS
-- da 231:
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 260_nfe_saida.sql
-- Depois: NOTIFY pgrst (já no fim); desktop/scripts/gerar-schema.sh + versão do desktop.
-- Teste: scripts/testes-sql/260_nfe_saida.sql (banco local).

begin;
set lock_timeout = '5s';

insert into permissoes (nome) values ('Compras - Emitir NF-e') on conflict (nome) do nothing;

-- Código IBGE do município (7 dígitos): obrigatório no emitente e no destinatário da NF-e. Não é sensível.
alter table public.lojas add column if not exists codigo_municipio varchar(7);
alter table public.lojas drop constraint if exists lojas_codigo_municipio_chk;
alter table public.lojas add constraint lojas_codigo_municipio_chk check (codigo_municipio is null or codigo_municipio ~ '^[0-9]{7}$');
grant select (codigo_municipio) on public.lojas to anon, authenticated;

create table if not exists public.nfe_config (
  loja_id              bigint primary key references public.lojas(id),
  crt                  smallint check (crt between 1 and 4),          -- 1 Simples, 2 Simples excesso, 3 Normal, 4 MEI
  serie_producao       int check (serie_producao between 0 and 999),   -- sem série de produção = não emite em produção
  serie_homologacao    int not null default 920 check (serie_homologacao between 0 and 999),
  autxml_cnpj          text check (autxml_cnpj is null or autxml_cnpj ~ '^[0-9]{14}$'),
  cst_pis_cofins       text not null default '49' check (cst_pis_cofins ~ '^(49|50|51|52|53|54|55|56|60|61|62|63|64|65|66|67|70|71|72|73|74|75|98|99)$'),
  csosn_transferencia  text not null default '400' check (csosn_transferencia in ('102', '103', '300', '400', '900')),
  cst_transferencia    text not null default '41' check (cst_transferencia in ('40', '41', '50', '90')),
  csosn_remessa        text not null default '900' check (csosn_remessa in ('102', '103', '300', '400', '900')),
  cst_remessa          text not null default '90' check (cst_remessa in ('40', '41', '50', '90')),
  info_complementar    text check (info_complementar is null or length(info_complementar) <= 2000),
  updated_at           timestamptz not null default now(),
  updated_by           text
);

create table if not exists public.nfe_numeracao (
  loja_id        bigint not null references public.lojas(id),
  tp_amb         smallint not null check (tp_amb in (1, 2)),
  serie          int not null check (serie between 0 and 999),
  ultimo_numero  int not null default 0 check (ultimo_numero between 0 and 999999999),
  updated_at     timestamptz not null default now(),
  primary key (loja_id, tp_amb, serie)
);

create table if not exists public.nfe_saida (
  id                   bigint generated always as identity primary key,
  loja_id              bigint not null references public.lojas(id),
  tp_amb               smallint not null check (tp_amb in (1, 2)),
  modelo               text not null default '55' check (modelo = '55'),
  serie                int not null check (serie between 0 and 999),
  numero               int not null check (numero between 1 and 999999999),
  origem_tipo          text not null check (origem_tipo in ('devolucao', 'transferencia_loja')),
  origem_id            bigint not null,
  status               text not null default 'rascunho'
                       check (status in ('rascunho', 'enviando', 'incerta', 'autorizada', 'rejeitada', 'denegada', 'cancelada', 'descartada')),
  chave                text check (chave is null or chave ~ '^[0-9]{44}$'),
  dh_emissao           timestamptz,
  data_emissao         date,
  valor_total          numeric(18,2),
  dest_nome            text,
  dest_doc             text,
  c_stat               text,
  x_motivo             text,
  n_recibo             text,
  protocolo            text,
  dh_recbto            timestamptz,
  xml_assinado         text,
  xml_autorizado       text,              -- procNFe (NFe assinada + protNFe)
  enviando_desde       timestamptz,
  tentativas           int not null default 0,
  cancel_protocolo     text,
  cancel_dh            timestamptz,
  cancel_justificativa text,
  cancel_xml           text,              -- procEventoNFe do cancelamento
  cce_seq              int not null default 0 check (cce_seq between 0 and 20),
  cce_ultima           text,
  cce_xml              text,              -- procEventoNFe da última CC-e
  dados                jsonb,             -- o que foi usado para montar o XML (auditoria)
  criado_por           text,
  criado_por_nome      text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- número: só um vivo por (loja, ambiente, modelo, série); a descartada guarda o número só para histórico
create unique index if not exists nfe_saida_numero_uq on public.nfe_saida (loja_id, tp_amb, modelo, serie, numero) where status <> 'descartada';
-- idempotência por documento de origem: uma NF-e ativa por origem e ambiente
create unique index if not exists nfe_saida_origem_ativa_uq on public.nfe_saida (loja_id, origem_tipo, origem_id, tp_amb) where status not in ('descartada', 'cancelada');
create unique index if not exists nfe_saida_chave_uq on public.nfe_saida (chave) where chave is not null and status <> 'descartada';
create index if not exists nfe_saida_loja on public.nfe_saida (loja_id, id desc);
create index if not exists nfe_saida_origem on public.nfe_saida (loja_id, origem_tipo, origem_id);

create table if not exists public.nfe_saida_eventos (
  id           bigint generated always as identity primary key,
  loja_id      bigint not null references public.lojas(id),
  nfe_id       bigint not null references public.nfe_saida(id),
  tipo         text not null check (tipo in ('reservada', 'envio', 'retorno', 'consulta', 'cancelamento', 'cce', 'descartada', 'erro')),
  c_stat       text,
  x_motivo     text,
  protocolo    text,
  xml_enviado  text,
  xml_retorno  text,
  detalhe      jsonb not null default '{}'::jsonb,
  user_id      text,
  user_nome    text,
  created_at   timestamptz not null default now()
);
create index if not exists nfe_saida_eventos_nfe on public.nfe_saida_eventos (nfe_id, id);

create or replace function public.trg_nfe_saida_eventos_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'nfe_saida_eventos é append-only' using errcode = '55000';
end $$;
drop trigger if exists nfe_saida_eventos_imutavel on public.nfe_saida_eventos;
create trigger nfe_saida_eventos_imutavel before update or delete on public.nfe_saida_eventos
  for each row execute function public.trg_nfe_saida_eventos_imutavel();

-- NF-e nunca é apagada (número fiscal): só muda de status.
create or replace function public.trg_nfe_saida_sem_delete() returns trigger language plpgsql as $$
begin
  raise exception 'NF-e de saída não se apaga (o número é fiscal): use descartar ou cancelar' using errcode = '55000';
end $$;
drop trigger if exists nfe_saida_sem_delete on public.nfe_saida;
create trigger nfe_saida_sem_delete before delete on public.nfe_saida
  for each row execute function public.trg_nfe_saida_sem_delete();

do $$ declare t text; begin
  foreach t in array array['nfe_config', 'nfe_numeracao', 'nfe_saida', 'nfe_saida_eventos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()))', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- A devolução ganha o evento 'nfe_cancelada' (NF-e de produção cancelada → volta a "a emitir").
alter table public.devolucoes_fornecedor_eventos drop constraint if exists devolucoes_fornecedor_eventos_tipo_check;
alter table public.devolucoes_fornecedor_eventos add constraint devolucoes_fornecedor_eventos_tipo_check
  check (tipo in ('registrada', 'cancelada', 'emitida', 'nfe_cancelada'));

-- ------------------------------------------------------------------------------------------------ funções internas
-- Situação do documento de origem que permite emitir (e trava a linha). Devolve o motivo da recusa ou null.
create or replace function public._nfe_origem_emitivel(p_loja bigint, p_origem_tipo text, p_origem_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare v_sit text;
begin
  if p_origem_tipo = 'devolucao' then
    select situacao into v_sit from devolucoes_fornecedor where id = p_origem_id and loja_id = p_loja for update;
    if not found then return 'Devolução não encontrada nesta loja'; end if;
    if v_sit <> 'a_emitir' then return 'Só se emite NF-e de devolução "a emitir" (esta está ' || v_sit || ')'; end if;
  elsif p_origem_tipo = 'transferencia_loja' then
    if to_regclass('public.transferencias_loja') is null then return 'Transferência entre lojas ainda não ativada (migration 261)'; end if;
    execute 'select situacao from transferencias_loja where id = $1 and loja_id = $2 for update' into v_sit using p_origem_id, p_loja;
    if v_sit is null then return 'Transferência não encontrada nesta loja'; end if;
    if v_sit <> 'registrada' then return 'Só se emite NF-e de transferência registrada (esta está ' || v_sit || ')'; end if;
  else
    return 'Tipo de documento inválido';
  end if;
  return null;
end $$;

create or replace function public._nfe_evento(p_nfe nfe_saida, p_tipo text, p_c_stat text, p_x_motivo text, p_protocolo text,
  p_xml_enviado text, p_xml_retorno text, p_detalhe jsonb, p_user text, p_user_nome text) returns void
language sql security definer set search_path = public as $$
  insert into nfe_saida_eventos (loja_id, nfe_id, tipo, c_stat, x_motivo, protocolo, xml_enviado, xml_retorno, detalhe, user_id, user_nome)
  values (p_nfe.loja_id, p_nfe.id, p_tipo, p_c_stat, p_x_motivo, p_protocolo, p_xml_enviado, p_xml_retorno, coalesce(p_detalhe, '{}'::jsonb), p_user, p_user_nome);
$$;

-- ------------------------------------------------------------------------------------------------ reservar número
-- Devolve a NF-e ativa do documento (duplo clique) ou cria uma nova com o próximo número: primeiro o menor número
-- descartado ainda livre (não deixa buraco), senão último + 1.
create or replace function public.nfe_reservar(
  p_loja bigint, p_tp_amb int, p_origem_tipo text, p_origem_id bigint, p_user text default null, p_user_nome text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg nfe_config%rowtype; v_serie int; v_num int; v_motivo text; n nfe_saida%rowtype; v_reap boolean := false;
begin
  if (select modo_estoque from lojas where id = p_loja) is distinct from 'proprio' then
    raise exception 'NF-e de saída pelo app só existe na loja de estoque próprio' using errcode = '22023';
  end if;
  if p_tp_amb not in (1, 2) then raise exception 'Ambiente inválido' using errcode = '22023'; end if;
  select * into cfg from nfe_config where loja_id = p_loja;
  if not found or cfg.crt is null then
    raise exception 'Configure o regime tributário (CRT) da loja em NF-e de saída → Configuração' using errcode = '22023';
  end if;
  v_serie := case when p_tp_amb = 1 then cfg.serie_producao else cfg.serie_homologacao end;
  if v_serie is null then
    raise exception 'Configure a série de produção da NF-e antes de emitir em produção' using errcode = '22023';
  end if;
  perform _exigir_periodo_aberto(p_loja, (now() at time zone 'America/Bahia')::date, 'emissão de NF-e');

  v_motivo := _nfe_origem_emitivel(p_loja, p_origem_tipo, p_origem_id);
  if v_motivo is not null then raise exception '%', v_motivo using errcode = '22023'; end if;

  select * into n from nfe_saida
   where loja_id = p_loja and origem_tipo = p_origem_tipo and origem_id = p_origem_id and tp_amb = p_tp_amb
     and status not in ('descartada', 'cancelada')
   for update;
  if found then
    return jsonb_build_object('ok', true, 'duplicado', true, 'id', n.id, 'numero', n.numero, 'serie', n.serie, 'status', n.status);
  end if;

  perform pg_advisory_xact_lock(7260, hashtext(p_loja || ':' || p_tp_amb || ':' || v_serie));
  select min(d.numero) into v_num from nfe_saida d
   where d.loja_id = p_loja and d.tp_amb = p_tp_amb and d.modelo = '55' and d.serie = v_serie and d.status = 'descartada'
     and not exists (select 1 from nfe_saida a where a.loja_id = d.loja_id and a.tp_amb = d.tp_amb and a.modelo = d.modelo
                       and a.serie = d.serie and a.numero = d.numero and a.status <> 'descartada');
  if v_num is not null then
    v_reap := true;
  else
    insert into nfe_numeracao (loja_id, tp_amb, serie) values (p_loja, p_tp_amb, v_serie) on conflict do nothing;
    update nfe_numeracao set ultimo_numero = ultimo_numero + 1, updated_at = now()
     where loja_id = p_loja and tp_amb = p_tp_amb and serie = v_serie
    returning ultimo_numero into v_num;
  end if;

  insert into nfe_saida (loja_id, tp_amb, serie, numero, origem_tipo, origem_id, status, criado_por, criado_por_nome)
  values (p_loja, p_tp_amb, v_serie, v_num, p_origem_tipo, p_origem_id, 'rascunho', p_user, p_user_nome)
  returning * into n;
  perform _nfe_evento(n, 'reservada', null, null, null, null, null,
                      jsonb_build_object('numero', v_num, 'serie', v_serie, 'reaproveitado', v_reap), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'duplicado', false, 'id', n.id, 'numero', v_num, 'serie', v_serie, 'status', n.status, 'reaproveitado', v_reap);
end $$;

-- Próximo número de uma série (continuar a sequência que a loja já usava em outro emissor). Nunca volta para trás.
create or replace function public.nfe_definir_proximo_numero(p_loja bigint, p_tp_amb int, p_serie int, p_proximo int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ult int; v_max int;
begin
  if p_proximo is null or p_proximo < 1 or p_proximo > 999999999 then raise exception 'Número inválido' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(7260, hashtext(p_loja || ':' || p_tp_amb || ':' || p_serie));
  insert into nfe_numeracao (loja_id, tp_amb, serie) values (p_loja, p_tp_amb, p_serie) on conflict do nothing;
  select ultimo_numero into v_ult from nfe_numeracao where loja_id = p_loja and tp_amb = p_tp_amb and serie = p_serie for update;
  select coalesce(max(numero), 0) into v_max from nfe_saida where loja_id = p_loja and tp_amb = p_tp_amb and serie = p_serie;
  if p_proximo - 1 < greatest(v_ult, v_max) then
    raise exception 'O próximo número não pode voltar: já se usou até o %', greatest(v_ult, v_max) using errcode = '22023';
  end if;
  update nfe_numeracao set ultimo_numero = p_proximo - 1, updated_at = now() where loja_id = p_loja and tp_amb = p_tp_amb and serie = p_serie;
  return jsonb_build_object('ok', true, 'ultimo', p_proximo - 1);
end $$;

-- ------------------------------------------------------------------------------------------------ envio
-- Marca o envio (o XML assinado fica guardado ANTES de ir para a SEFAZ). Só de rascunho ou rejeitada.
create or replace function public.nfe_iniciar_envio(
  p_id bigint, p_loja bigint, p_chave text, p_xml_assinado text, p_dh_emissao timestamptz, p_valor numeric,
  p_dest_nome text, p_dest_doc text, p_dados jsonb, p_user text default null, p_user_nome text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n nfe_saida%rowtype; v_motivo text;
begin
  select * into n from nfe_saida where id = p_id and loja_id = p_loja for update;
  if not found then raise exception 'NF-e não encontrada nesta loja' using errcode = '22023'; end if;
  if n.status = 'enviando' and n.enviando_desde > now() - interval '2 minutes' then
    raise exception 'Já há um envio desta NF-e em andamento' using errcode = '22023';
  end if;
  if n.status in ('enviando', 'incerta') then
    raise exception 'O último envio ficou sem resposta: consulte a situação na SEFAZ antes de reenviar' using errcode = '22023';
  end if;
  if n.status not in ('rascunho', 'rejeitada') then
    raise exception 'Esta NF-e está % e não pode ser enviada', n.status using errcode = '22023';
  end if;
  v_motivo := _nfe_origem_emitivel(n.loja_id, n.origem_tipo, n.origem_id);
  if v_motivo is not null then raise exception '%', v_motivo using errcode = '22023'; end if;
  if p_chave !~ '^[0-9]{44}$' or substr(p_chave, 26, 9)::int <> n.numero or substr(p_chave, 23, 3)::int <> n.serie then
    raise exception 'A chave não confere com o número/série reservados' using errcode = '22023';
  end if;
  update nfe_saida set status = 'enviando', enviando_desde = now(), tentativas = tentativas + 1, chave = p_chave,
         xml_assinado = p_xml_assinado, dh_emissao = p_dh_emissao, data_emissao = (p_dh_emissao at time zone 'America/Bahia')::date,
         valor_total = p_valor, dest_nome = p_dest_nome, dest_doc = p_dest_doc, dados = p_dados, c_stat = null, x_motivo = null,
         updated_at = now()
   where id = n.id returning * into n;
  perform _nfe_evento(n, 'envio', null, null, null, p_xml_assinado, null, jsonb_build_object('tentativa', n.tentativas), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'id', n.id, 'tentativa', n.tentativas);
end $$;

-- Grava o que a SEFAZ respondeu (autorização, rejeição, recibo, consulta). Nunca recusa um fato da SEFAZ.
-- p_status: autorizada | rejeitada | denegada | incerta
create or replace function public.nfe_registrar_retorno(
  p_id bigint, p_loja bigint, p_status text, p_c_stat text, p_x_motivo text, p_protocolo text default null,
  p_dh_recbto timestamptz default null, p_n_recibo text default null, p_xml_autorizado text default null,
  p_xml_retorno text default null, p_tipo_evento text default 'retorno', p_user text default null, p_user_nome text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n nfe_saida%rowtype; v_dev devolucoes_fornecedor%rowtype;
begin
  if p_status not in ('autorizada', 'rejeitada', 'denegada', 'incerta') then raise exception 'Status inválido' using errcode = '22023'; end if;
  if p_tipo_evento not in ('retorno', 'consulta', 'erro') then raise exception 'Tipo de evento inválido' using errcode = '22023'; end if;
  select * into n from nfe_saida where id = p_id and loja_id = p_loja for update;
  if not found then raise exception 'NF-e não encontrada nesta loja' using errcode = '22023'; end if;
  if n.status in ('autorizada', 'cancelada', 'denegada') and p_status <> n.status then
    -- já é definitiva: só registra o evento (ex.: consulta repetida)
    perform _nfe_evento(n, p_tipo_evento, p_c_stat, p_x_motivo, p_protocolo, null, p_xml_retorno, jsonb_build_object('ignorado', p_status), p_user, p_user_nome);
    return jsonb_build_object('ok', true, 'status', n.status, 'ignorado', true);
  end if;
  update nfe_saida set status = p_status, c_stat = p_c_stat, x_motivo = p_x_motivo,
         protocolo = coalesce(p_protocolo, protocolo), dh_recbto = coalesce(p_dh_recbto, dh_recbto),
         n_recibo = coalesce(p_n_recibo, n_recibo), xml_autorizado = coalesce(p_xml_autorizado, xml_autorizado),
         enviando_desde = case when p_status = 'incerta' then enviando_desde else null end, updated_at = now()
   where id = n.id returning * into n;
  perform _nfe_evento(n, p_tipo_evento, p_c_stat, p_x_motivo, p_protocolo, null, p_xml_retorno, '{}'::jsonb, p_user, p_user_nome);

  -- Só a autorização em PRODUÇÃO muda o documento de origem.
  if p_status = 'autorizada' and n.tp_amb = 1 and n.origem_tipo = 'devolucao' then
    select * into v_dev from devolucoes_fornecedor where id = n.origem_id and loja_id = n.loja_id for update;
    if found and v_dev.situacao = 'a_emitir' then
      update devolucoes_fornecedor set situacao = 'emitida', updated_at = now() where id = v_dev.id;
      insert into devolucoes_fornecedor_eventos (loja_id, devolucao_id, tipo, detalhe, user_id, user_nome)
      values (n.loja_id, v_dev.id, 'emitida', jsonb_build_object('nfe_id', n.id, 'chave', n.chave, 'numero', n.numero, 'serie', n.serie, 'protocolo', n.protocolo), p_user, p_user_nome);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'status', n.status);
end $$;

-- Descarta a NF-e que nunca foi autorizada (rascunho ou rejeitada): o número volta para a próxima reserva.
create or replace function public.nfe_descartar(p_id bigint, p_loja bigint, p_user text default null, p_user_nome text default null, p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare n nfe_saida%rowtype;
begin
  select * into n from nfe_saida where id = p_id and loja_id = p_loja for update;
  if not found then raise exception 'NF-e não encontrada nesta loja' using errcode = '22023'; end if;
  if n.status = 'descartada' then return jsonb_build_object('ok', true, 'duplicado', true); end if;
  if n.status not in ('rascunho', 'rejeitada') then
    raise exception 'Só se descarta NF-e que a SEFAZ não autorizou (rascunho ou rejeitada); esta está %', n.status using errcode = '22023';
  end if;
  update nfe_saida set status = 'descartada', updated_at = now() where id = n.id returning * into n;
  perform _nfe_evento(n, 'descartada', null, null, null, null, null, jsonb_build_object('motivo', p_motivo), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'duplicado', false, 'numero_livre', n.numero);
end $$;

-- Confere ANTES de chamar a SEFAZ se o evento (cancelamento/CC-e) pode sair: NF-e autorizada e mês da emissão aberto.
create or replace function public.nfe_checar_evento(p_id bigint, p_loja bigint, p_tipo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n nfe_saida%rowtype;
begin
  select * into n from nfe_saida where id = p_id and loja_id = p_loja;
  if not found then raise exception 'NF-e não encontrada nesta loja' using errcode = '22023'; end if;
  if n.status <> 'autorizada' then raise exception 'Só NF-e autorizada recebe %', p_tipo using errcode = '22023'; end if;
  perform _exigir_periodo_aberto(p_loja, n.data_emissao, p_tipo || ' de NF-e');
  if p_tipo = 'carta de correção' and n.cce_seq >= 20 then raise exception 'Limite de 20 cartas de correção atingido' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true, 'chave', n.chave, 'protocolo', n.protocolo, 'tp_amb', n.tp_amb, 'cce_seq', n.cce_seq);
end $$;

create or replace function public.nfe_registrar_cancelamento(
  p_id bigint, p_loja bigint, p_protocolo text, p_dh timestamptz, p_justificativa text, p_xml text,
  p_xml_retorno text default null, p_user text default null, p_user_nome text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n nfe_saida%rowtype; v_dev devolucoes_fornecedor%rowtype;
begin
  select * into n from nfe_saida where id = p_id and loja_id = p_loja for update;
  if not found then raise exception 'NF-e não encontrada nesta loja' using errcode = '22023'; end if;
  if n.status = 'cancelada' then return jsonb_build_object('ok', true, 'duplicado', true); end if;
  update nfe_saida set status = 'cancelada', cancel_protocolo = p_protocolo, cancel_dh = coalesce(p_dh, now()),
         cancel_justificativa = p_justificativa, cancel_xml = p_xml, updated_at = now()
   where id = n.id returning * into n;
  perform _nfe_evento(n, 'cancelamento', '135', 'Cancelamento registrado', p_protocolo, null, p_xml_retorno,
                      jsonb_build_object('justificativa', p_justificativa), p_user, p_user_nome);
  if n.tp_amb = 1 and n.origem_tipo = 'devolucao' then
    select * into v_dev from devolucoes_fornecedor where id = n.origem_id and loja_id = n.loja_id for update;
    if found and v_dev.situacao = 'emitida' then
      update devolucoes_fornecedor set situacao = 'a_emitir', updated_at = now() where id = v_dev.id;
      insert into devolucoes_fornecedor_eventos (loja_id, devolucao_id, tipo, detalhe, user_id, user_nome)
      values (n.loja_id, v_dev.id, 'nfe_cancelada', jsonb_build_object('nfe_id', n.id, 'chave', n.chave, 'protocolo', p_protocolo), p_user, p_user_nome);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'duplicado', false);
end $$;

create or replace function public.nfe_registrar_cce(
  p_id bigint, p_loja bigint, p_seq int, p_texto text, p_protocolo text, p_xml text, p_xml_retorno text default null,
  p_user text default null, p_user_nome text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n nfe_saida%rowtype;
begin
  select * into n from nfe_saida where id = p_id and loja_id = p_loja for update;
  if not found then raise exception 'NF-e não encontrada nesta loja' using errcode = '22023'; end if;
  update nfe_saida set cce_seq = greatest(cce_seq, p_seq), cce_ultima = p_texto, cce_xml = p_xml, updated_at = now()
   where id = n.id returning * into n;
  perform _nfe_evento(n, 'cce', '135', 'Carta de correção registrada', p_protocolo, null, p_xml_retorno,
                      jsonb_build_object('seq', p_seq, 'texto', p_texto), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'seq', n.cce_seq);
end $$;

-- Registra um evento de erro/consulta sem mudar o status (falha de rede antes do envio, por exemplo).
create or replace function public.nfe_registrar_erro(p_id bigint, p_loja bigint, p_mensagem text, p_voltar_rascunho boolean default false,
  p_user text default null, p_user_nome text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n nfe_saida%rowtype;
begin
  select * into n from nfe_saida where id = p_id and loja_id = p_loja for update;
  if not found then raise exception 'NF-e não encontrada nesta loja' using errcode = '22023'; end if;
  -- só volta para rascunho quando é CERTO que nada saiu para a SEFAZ (erro antes da conexão)
  if p_voltar_rascunho and n.status = 'enviando' then
    update nfe_saida set status = case when n.c_stat is null and n.tentativas <= 1 then 'rascunho' else 'rejeitada' end,
           enviando_desde = null, x_motivo = left(p_mensagem, 500), updated_at = now()
     where id = n.id returning * into n;
  end if;
  perform _nfe_evento(n, 'erro', null, left(p_mensagem, 500), null, null, null, '{}'::jsonb, p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'status', n.status);
end $$;

-- ------------------------------------------------------------------------------------------------ trava na origem
-- Cancelar a devolução com NF-e de PRODUÇÃO em andamento/autorizada é recusado (cancele a NF-e antes). As NF-e que nunca
-- foram autorizadas (rascunho/rejeitada, qualquer ambiente) são descartadas junto: o número volta para a fila.
create or replace function public.trg_devolucao_nfe_ativa() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_num int; v_st text;
begin
  if new.situacao = 'cancelada' and old.situacao is distinct from 'cancelada' then
    select numero, status into v_num, v_st from nfe_saida
     where loja_id = new.loja_id and origem_tipo = 'devolucao' and origem_id = new.id and tp_amb = 1
       and status in ('enviando', 'incerta', 'autorizada') limit 1;
    if found then
      raise exception 'A devolução tem NF-e nº % (%): cancele a NF-e na SEFAZ antes de cancelar a devolução', v_num, v_st using errcode = '22023';
    end if;
    update nfe_saida set status = 'descartada', updated_at = now()
     where loja_id = new.loja_id and origem_tipo = 'devolucao' and origem_id = new.id and status in ('rascunho', 'rejeitada');
  end if;
  return new;
end $$;
drop trigger if exists devolucao_nfe_ativa on public.devolucoes_fornecedor;
create trigger devolucao_nfe_ativa before update of situacao on public.devolucoes_fornecedor
  for each row execute function public.trg_devolucao_nfe_ativa();

do $$ declare f text; begin
  foreach f in array array[
    '_nfe_origem_emitivel(bigint,text,bigint)',
    '_nfe_evento(nfe_saida,text,text,text,text,text,text,jsonb,text,text)',
    'nfe_reservar(bigint,int,text,bigint,text,text)',
    'nfe_definir_proximo_numero(bigint,int,int,int)',
    'nfe_iniciar_envio(bigint,bigint,text,text,timestamptz,numeric,text,text,jsonb,text,text)',
    'nfe_registrar_retorno(bigint,bigint,text,text,text,text,timestamptz,text,text,text,text,text,text)',
    'nfe_descartar(bigint,bigint,text,text,text)',
    'nfe_checar_evento(bigint,bigint,text)',
    'nfe_registrar_cancelamento(bigint,bigint,text,timestamptz,text,text,text,text,text)',
    'nfe_registrar_cce(bigint,bigint,int,text,text,text,text,text,text)',
    'nfe_registrar_erro(bigint,bigint,text,boolean,text,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on function public.trg_devolucao_nfe_ativa() from public, anon, authenticated;
revoke all on function public.trg_nfe_saida_sem_delete() from public, anon, authenticated;
revoke all on function public.trg_nfe_saida_eventos_imutavel() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
