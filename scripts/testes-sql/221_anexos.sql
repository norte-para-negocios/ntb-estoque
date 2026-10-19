-- Teste da migration 221 (anexos). Banco LOCAL g1 com fase_g_setup.sql (stub de storage) + 221. Nunca em produção.
-- Uso: docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d g1 < scripts/testes-sql/221_anexos.sql
begin;
do $$ begin
  if (select public from storage.buckets where id = 'anexos') is not false then raise exception 'bucket público ou ausente'; end if;
  if (select file_size_limit from storage.buckets where id = 'anexos') <> 8388608 then raise exception 'limite do bucket'; end if;
  if not exists (select 1 from permissoes where nome = 'Anexos - Enviar') or not exists (select 1 from permissoes where nome = 'Anexos - Excluir') then raise exception 'permissões'; end if;
  -- caminho precisa estar na pasta da própria loja; id do registro só dígitos
  begin
    insert into anexos (loja_id, entidade, entidade_id, nome_arquivo, caminho, tipo_mime, tamanho) values (9001, 'op', '1', 'a.pdf', 'loja-9002/op/1/x.pdf', 'application/pdf', 10);
    raise exception 'aceitou caminho de outra loja';
  exception when check_violation then null; end;
  begin
    insert into anexos (loja_id, entidade, entidade_id, nome_arquivo, caminho, tipo_mime, tamanho) values (9001, 'op', '1;drop', 'a.pdf', 'loja-9001/op/1/x.pdf', 'application/pdf', 10);
    raise exception 'aceitou entidade_id torto';
  exception when check_violation then null; end;
  begin
    insert into anexos (loja_id, entidade, entidade_id, nome_arquivo, caminho, tipo_mime, tamanho) values (9001, 'op', '1', 'a.pdf', 'loja-9001/op/1/y.pdf', 'application/pdf', 9000000);
    raise exception 'aceitou arquivo maior que 8 MB';
  exception when check_violation then null; end;
end $$;
insert into anexos (loja_id, entidade, entidade_id, nome_arquivo, caminho, tipo_mime, tamanho) values (9001, 'op', '1', 'a.pdf', 'loja-9001/op/1/a.pdf', 'application/pdf', 10);
insert into anexos (loja_id, entidade, entidade_id, nome_arquivo, caminho, tipo_mime, tamanho) values (9002, 'op', '1', 'b.pdf', 'loja-9002/op/1/b.pdf', 'application/pdf', 10);
insert into storage.buckets (id, name, public) values ('certificados', 'certificados', false) on conflict (id) do nothing;
insert into storage.objects (bucket_id, name) values ('anexos', 'loja-9001/op/1/a.pdf'), ('anexos', 'loja-9002/op/1/b.pdf'), ('certificados', 'loja-9001.pfx');

-- Ana (loja 9001): vê só o anexo e o objeto da loja dela; não grava na pasta de outra loja; não lê o bucket de certificados
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000009001"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from anexos) <> 1 then raise exception 'RLS anexos: viu % linhas', (select count(*) from anexos); end if;
  if (select count(*) from storage.objects) <> 1 then raise exception 'RLS storage: viu % objetos', (select count(*) from storage.objects); end if;
  begin
    insert into storage.objects (bucket_id, name) values ('anexos', 'loja-9002/op/1/invasor.pdf');
    raise exception 'gravou na pasta de outra loja';
  exception when insufficient_privilege then null; end;
  insert into storage.objects (bucket_id, name) values ('anexos', 'loja-9001/op/1/novo.pdf');
  begin
    insert into anexos (loja_id, entidade, entidade_id, nome_arquivo, caminho, tipo_mime, tamanho) values (9001, 'op', '1', 'c.pdf', 'loja-9001/op/1/c.pdf', 'application/pdf', 10);
    raise exception 'authenticated gravou na tabela anexos';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- service role: não apaga linha (excluir é marcar)
set local role service_role;
do $$ begin
  begin delete from anexos; raise exception 'service_role apagou'; exception when insufficient_privilege then null; end;
  update anexos set excluido_em = now() where caminho = 'loja-9001/op/1/a.pdf';
end $$;
reset role;
select 'OK 221' as resultado;
rollback;
