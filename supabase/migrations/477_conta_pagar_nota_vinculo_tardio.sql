-- 477 — Conta a pagar da nota digitada ("Lançar sem XML"): o gatilho também dispara quando o VÍNCULO da nota é gravado depois.
-- Causa (F-01 da lista final do ERP): lancarCompraManual lança a compra (status vira 'lancada') e SÓ DEPOIS grava
-- compras_proprio.nota_fiscal_id. O gatilho trg_compra_conta_pagar (340/360) disparava só em "update of status" e saía calado
-- com nota_fiscal_id nulo; quando o vínculo chegava, não havia mais nada para disparar. Resultado: estoque e custo certos,
-- mas nenhuma conta a pagar (loja com a chave fin_cp_da_nota_ativo ligada).
-- Correção: o gatilho passa a ouvir também "update of nota_fiscal_id" (só quando o vínculo muda). A função do gatilho não muda:
-- com status 'lancada'/'parcial' ela chama fin_titulos_da_nota_gerar (idempotente, respeita a chave). A aplicação também
-- passou a chamar a geração logo depois do vínculo (lib/estoque/compra-manual-titulos.ts), então funciona mesmo antes desta migration.
-- Notas digitadas antes desta correção NÃO ganham conta sozinhas: tela "Notas sem conta a pagar" (360).
-- Aplicar (manual, com backup e OK do dono, numa transação; NUNCA sem pedido):
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 477_conta_pagar_nota_vinculo_tardio.sql

begin;
set lock_timeout = '5s';

drop trigger if exists compras_proprio_conta_pagar on public.compras_proprio;
create trigger compras_proprio_conta_pagar after update of status, nota_fiscal_id on public.compras_proprio
  for each row when (old.status is distinct from new.status or old.nota_fiscal_id is distinct from new.nota_fiscal_id)
  execute function public.trg_compra_conta_pagar();

notify pgrst, 'reload schema';
commit;
