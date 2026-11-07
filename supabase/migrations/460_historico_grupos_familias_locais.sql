-- 460 (Fase 9): histórico de alterações (migration 220) também em grupos de produto, famílias e locais de estoque.
-- 'ignorar' = só grava mudança feita por alguém: famílias e locais das lojas Omie vêm do sync e os grupos podem vir do Vendas
-- (sem autor), e isso não deve encher a tabela. Só gatilhos AFTER; nada muda nas tabelas.
drop trigger if exists historico on public.grupos_produto;
create trigger historico after insert or update or delete on public.grupos_produto for each row execute function public.historico_registrar(
  'grupo', 'id', '', 'ignorar',
  'nome', 'pai_id', 'ordem', 'ativo');

drop trigger if exists historico on public.familias;
create trigger historico after insert or update or delete on public.familias for each row execute function public.historico_registrar(
  'familia', 'id', '', 'ignorar',
  'nome', 'codigo', 'inativo');

drop trigger if exists historico on public.local_estoques;
create trigger historico after insert or update or delete on public.local_estoques for each row execute function public.historico_registrar(
  'local', 'id', '', 'ignorar',
  'descricao', 'codigo', 'tipo', 'padrao', 'inativo');
