-- 222 — Fase G: notificações dentro do app (sininho). Nada é enviado para fora (sem WhatsApp/e-mail).
-- SÓ ADITIVA: duas tabelas novas e uma função. Geração pelo cron /api/cron/gerar-notificacoes (só leitura do banco,
-- nenhuma chamada ao Omie), que calcula as contagens por loja (lib/notificacoes/coletar.ts), monta as notificações
-- (lib/notificacoes/regras-puro.ts) e chama notificacoes_sincronizar.
-- Aplicar (manual, com backup e OK do dono): docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 222_notificacoes.sql
-- Depois: NOTIFY pgrst (no fim); agendar o cron em scripts/sync-cron.sh (já está no repo, blocos 1 e 4 = 2x por hora);
-- desktop/scripts/gerar-schema.sh + versão nova do app desktop.
-- Teste: scripts/testes-sql/222_notificacoes.sql.
--
-- Uma linha por (loja, chave). "Não lida" para um usuário = não existe leitura dele com lida_em >= atualizada_em.
-- atualizada_em só anda quando a notificação nasce, reaparece depois de resolvida ou o nível (contagem) SOBE; texto que
-- muda com o nível igual ou menor não incomoda de novo. Tipo avaliado sem item = resolvida. Resolvida há mais de 30 dias
-- é apagada pela própria função.

begin;

create table if not exists public.notificacoes (
  id            bigint generated always as identity primary key,
  loja_id       bigint not null references public.lojas(id) on delete cascade,
  tipo          text not null,
  chave         text not null,
  gravidade     text not null check (gravidade in ('err', 'warn', 'info')),
  titulo        text not null check (length(titulo) between 1 and 200),
  mensagem      text check (length(mensagem) <= 500),
  link          text check (link ~ '^/[^/\\]'),        -- só caminho interno do app (nunca outro site)
  nivel         numeric not null default 0,
  criada_em     timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  resolvida_em  timestamptz,
  unique (loja_id, chave)
);
create index if not exists notificacoes_abertas on public.notificacoes (loja_id, atualizada_em desc) where resolvida_em is null;

create table if not exists public.notificacoes_leituras (
  notificacao_id bigint not null references public.notificacoes(id) on delete cascade,
  user_id        uuid not null,
  lida_em        timestamptz not null default now(),
  primary key (notificacao_id, user_id)
);

alter table public.notificacoes enable row level security;
drop policy if exists notificacoes_select_por_loja on public.notificacoes;
create policy notificacoes_select_por_loja on public.notificacoes for select
  using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()));
alter table public.notificacoes_leituras enable row level security;
drop policy if exists notificacoes_leituras_proprias on public.notificacoes_leituras;
create policy notificacoes_leituras_proprias on public.notificacoes_leituras for select using (user_id = (select auth.uid()));
revoke all on public.notificacoes, public.notificacoes_leituras from public, anon, authenticated;
grant select on public.notificacoes, public.notificacoes_leituras to authenticated;
grant select, insert, update, delete on public.notificacoes, public.notificacoes_leituras to service_role;

-- p_tipos: tipos avaliados nesta rodada (o que não veio em p_itens fica resolvido). p_itens: [{tipo, chave, gravidade,
-- titulo, mensagem, link, nivel}]. Só o servidor (service role) chama.
create or replace function public.notificacoes_sincronizar(p_loja bigint, p_tipos text[], p_itens jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  x jsonb; v_novas int := 0; v_reabertas int := 0; v_resolvidas int := 0; v_antes notificacoes%rowtype; v_chaves text[] := '{}';
begin
  if p_loja is null or not exists (select 1 from lojas where id = p_loja) then
    raise exception 'Loja % inexistente', p_loja using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_itens, '[]'::jsonb)) <> 'array' then raise exception 'p_itens precisa ser uma lista' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('notificacoes_sincronizar'), p_loja::int);
  for x in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    if not (x->>'tipo' = any(p_tipos)) then
      raise exception 'Item de tipo % fora dos tipos avaliados', x->>'tipo' using errcode = '22023';
    end if;
    v_chaves := v_chaves || (x->>'chave');
    select * into v_antes from notificacoes where loja_id = p_loja and chave = x->>'chave' for update;
    if not found then
      insert into notificacoes (loja_id, tipo, chave, gravidade, titulo, mensagem, link, nivel)
      values (p_loja, x->>'tipo', x->>'chave', x->>'gravidade', x->>'titulo', x->>'mensagem', x->>'link', coalesce((x->>'nivel')::numeric, 0));
      v_novas := v_novas + 1;
    else
      if v_antes.resolvida_em is not null or coalesce((x->>'nivel')::numeric, 0) > v_antes.nivel then v_reabertas := v_reabertas + 1; end if;
      update notificacoes set tipo = x->>'tipo', gravidade = x->>'gravidade', titulo = x->>'titulo', mensagem = x->>'mensagem', link = x->>'link',
          nivel = coalesce((x->>'nivel')::numeric, 0), resolvida_em = null,
          atualizada_em = case when v_antes.resolvida_em is not null or coalesce((x->>'nivel')::numeric, 0) > v_antes.nivel then now() else v_antes.atualizada_em end
        where id = v_antes.id;
    end if;
  end loop;
  update notificacoes set resolvida_em = now()
   where loja_id = p_loja and tipo = any(p_tipos) and resolvida_em is null and not (chave = any(v_chaves));
  get diagnostics v_resolvidas = row_count;
  delete from notificacoes where loja_id = p_loja and resolvida_em < now() - interval '30 days';
  return jsonb_build_object('novas', v_novas, 'reabertas', v_reabertas, 'resolvidas', v_resolvidas);
end $$;
revoke all on function public.notificacoes_sincronizar(bigint, text[], jsonb) from public, anon, authenticated;
grant execute on function public.notificacoes_sincronizar(bigint, text[], jsonb) to service_role;

commit;

notify pgrst, 'reload schema';

-- Reverter: drop function public.notificacoes_sincronizar(bigint, text[], jsonb); drop table public.notificacoes_leituras;
-- drop table public.notificacoes; e tirar a linha do gerar-notificacoes do scripts/sync-cron.sh.
