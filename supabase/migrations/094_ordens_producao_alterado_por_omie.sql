-- Item #8 da reuniao 2026-07-27: "OP alterada dentro do Omie hoje so traz a
-- ordem, nao traz quem fez a alteracao". Pesquisa 2026-07-29 confirmou que a
-- Omie ja manda esse dado (outrasInf.uAlt/dAlteracao em ListarOrdemProducao/
-- ConsultarOrdemProducao) mas o app descartava. So passa a existir a partir
-- de agora -- full_object hoje e reduzido a itensDetalhes (ver toSlim em
-- lib/omie/ordem-producao.ts), entao nao ha como recuperar retroativamente.
--
-- alterado_por_omie e TEXTO LIVRE do usuario da Omie (nao referencia
-- profiles.id -- e um usuario do Omie, nao do NTB Estoque).
alter table ordens_producao
  add column if not exists alterado_por_omie text,
  add column if not exists dt_ultima_alteracao_omie date;
