-- 440 (Fase 6): grupo de produto APAGADO também entra no outbox do catálogo (antes o gatilho era só insert/update, e o grupo
-- apagado no Estoque ficava para sempre no cardápio do Vendas). trg_sync_outbox_catalogo já trata DELETE (operacao 'delete',
-- ref = id do grupo); a entrega manda os ids em `grupos_apagados` e o Vendas (migration 194 de lá) apaga a categoria vazia ou
-- só desliga a que ainda tem produto. Só lojas 'proprio' ligadas ao Vendas (o próprio gatilho filtra).
drop trigger if exists grupos_produto_sync_outbox on public.grupos_produto;
create trigger grupos_produto_sync_outbox after insert or update or delete on public.grupos_produto
  for each row execute function public.trg_sync_outbox_catalogo();
