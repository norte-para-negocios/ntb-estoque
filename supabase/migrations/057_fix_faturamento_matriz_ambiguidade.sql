-- Fix: faturamento "não puxava". Existiam DUAS versões de relatorio_faturamento_matriz:
--   (bigint, text)  e  (bigint, text, text DEFAULT NULL, text DEFAULT NULL)
-- Chamar com 2 args (como o app faz) casava as duas -> erro "is not unique" ->
-- a tela caía no empty state mesmo havendo faturamento importado.
-- Remove a versão de 4 params (o filtro de período é feito no app); mantém a de 2.
drop function if exists relatorio_faturamento_matriz(bigint, text, text, text);
