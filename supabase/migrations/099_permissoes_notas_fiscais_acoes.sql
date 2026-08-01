-- Fecha o gap de permissoes granulares em Notas Fiscais: os 3 botoes de acao real
-- (Manifestar/Reverter/Excluir, que chamam a API real da Omie) hoje ficam atras da
-- MESMA permissao "Notas Fiscais" que so da acesso de leitura a tela -- qualquer um
-- que pode ver a tela pode excluir permanentemente um recebimento na Omie real.
-- Mesmo padrao ja usado em "Ordens de Producao - Excluir/Concluir/Reverter".
--
-- Convencao de nomes (sem acento, como o banco guarda): "<Modulo> - <Acao>".
-- A permissao de ACESSO existente ("Notas Fiscais") e mantida como o "ver/acessar"
-- do modulo e NAO e renomeada (o MENU_PERMISSAO depende dela).
-- Idempotente (on conflict do nothing).

insert into permissoes (nome) values
  ('Notas Fiscais - Manifestar'),
  ('Notas Fiscais - Reverter'),
  ('Notas Fiscais - Excluir')
on conflict (nome) do nothing;
