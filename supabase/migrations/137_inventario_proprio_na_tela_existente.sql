-- 137 — Inventário existente também funciona em loja de estoque próprio (06/10/2026).
-- A tela, a lista, o PDF e o Excel continuam lendo inventarios / inventario_items. Em loja 'proprio' o "envio"
-- do item lança um ajuste (AJU) no ledger em vez de chamar o Omie. Esta migration só acrescenta colunas:
--   inventario_items.motivo     motivo da diferença (obrigatório acima do limite de valor da loja)
--   inventario_items.diferenca  diferença lançada (contado − saldo no momento do envio), na unidade base
--   inventarios.curva           curva ABC usada para montar uma contagem cíclica (A/B/C, ex.: 'A' ou 'A,B')
alter table public.inventario_items add column if not exists motivo text;
alter table public.inventario_items add column if not exists diferenca numeric(18,6);
alter table public.inventarios add column if not exists curva text;
notify pgrst, 'reload schema';
