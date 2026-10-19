-- 221 — Fase G [O2]: anexos nos registros (produto, nota de entrada, pedido de compra, OP) — nesta fase só estoque próprio
-- (lib/anexos/anexos-puro.ts → anexosPermitidos; o modo Omie não muda).
-- SÓ ADITIVA: bucket privado novo, tabela nova, políticas novas em storage.objects (só para o bucket 'anexos') e duas permissões.
-- Aplicar (manual, com backup e OK do dono): docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 221_anexos.sql
-- Depois: NOTIFY pgrst (no fim); desktop/scripts/gerar-schema.sh + versão nova do app desktop.
-- Teste: scripts/testes-sql/221_anexos.sql (cópia local com o stub de storage do fase_g_setup.sql).
--
-- Fluxo: o app envia e baixa pelo servidor (POST /api/anexos, GET /api/anexos/<id>) com a service role, depois de conferir
-- sessão, permissão, loja e que o registro existe. O navegador nunca recebe URL do Storage (ele só escuta em 127.0.0.1).
-- As políticas abaixo são a segunda trava: um usuário logado só enxerga/grava/apaga objeto na pasta loja-<id> das lojas dele.
-- Caminho: loja-<loja>/<entidade>/<id do registro>/<uuid>.<ext> (o nome original fica na tabela, nunca no caminho).
-- Excluir = apaga o objeto e marca excluido_em/excluido_por na linha (fica o registro de quem excluiu).

begin;

insert into permissoes (nome) values ('Anexos - Enviar'), ('Anexos - Excluir') on conflict (nome) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anexos', 'anexos', false, 8388608, array[
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/xml', 'text/csv', 'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.anexos (
  id                bigint generated always as identity primary key,
  loja_id           bigint not null references public.lojas(id),
  entidade          text not null check (entidade in ('produto', 'nota_entrada', 'pedido_compra', 'op')),
  entidade_id       text not null check (entidade_id ~ '^[0-9]{1,20}$'),
  nome_arquivo      text not null check (length(nome_arquivo) between 1 and 120),
  caminho           text not null unique check (caminho like 'loja-' || loja_id || '/%'),
  tipo_mime         text not null,
  tamanho           bigint not null check (tamanho > 0 and tamanho <= 8388608),
  enviado_por       uuid,
  enviado_por_nome  text,
  created_at        timestamptz not null default now(),
  excluido_em       timestamptz,
  excluido_por      uuid,
  excluido_por_nome text
);
create index if not exists anexos_registro on public.anexos (loja_id, entidade, entidade_id, id desc) where excluido_em is null;

alter table public.anexos enable row level security;
drop policy if exists anexos_select_por_loja on public.anexos;
create policy anexos_select_por_loja on public.anexos for select
  using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()));
revoke all on public.anexos from public, anon, authenticated;
grant select on public.anexos to authenticated;
grant select, insert, update on public.anexos to service_role;  -- sem delete: excluir é marcar excluido_em

-- Storage: só a pasta da loja do usuário (segunda trava; o app usa a service role, que passa por cima da RLS).
drop policy if exists anexos_ler_por_loja on storage.objects;
create policy anexos_ler_por_loja on storage.objects for select to authenticated
  using (bucket_id = 'anexos' and ((select public.usuario_e_admin()) or (storage.foldername(name))[1] in (select 'loja-' || l from public.usuario_lojas() l)));
drop policy if exists anexos_gravar_por_loja on storage.objects;
create policy anexos_gravar_por_loja on storage.objects for insert to authenticated
  with check (bucket_id = 'anexos' and ((select public.usuario_e_admin()) or (storage.foldername(name))[1] in (select 'loja-' || l from public.usuario_lojas() l)));
drop policy if exists anexos_apagar_por_loja on storage.objects;
create policy anexos_apagar_por_loja on storage.objects for delete to authenticated
  using (bucket_id = 'anexos' and ((select public.usuario_e_admin()) or (storage.foldername(name))[1] in (select 'loja-' || l from public.usuario_lojas() l)));

commit;

notify pgrst, 'reload schema';

-- Reverter: drop policy anexos_ler_por_loja on storage.objects; (idem gravar/apagar); drop table public.anexos;
-- delete from storage.buckets where id = 'anexos' (só com o bucket vazio); delete from permissoes where nome like 'Anexos - %'.
