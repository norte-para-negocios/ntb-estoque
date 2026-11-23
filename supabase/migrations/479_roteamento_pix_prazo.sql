-- 479 — Roteamento Pix e prazo de recebimento por conta (chamado do contador, loja 4 Sertão).
-- lojas.omie_conta_pix: conta do Omie que recebe os títulos Pix (null = não mexe no Pix).
-- omie_contas_regras: prazo de recebimento (dias corridos) por conta de destino; taxa_percentual guardada para uso futuro
-- (o conta_receber_cadastro do Omie não tem campo de taxa). Conta fora da tabela: o código usa pdv_dias_venc da própria conta.
alter table public.lojas add column if not exists omie_conta_pix bigint;

create table if not exists public.omie_contas_regras (
  loja_id bigint not null,
  n_cod_cc bigint not null,
  prazo_dias int not null,
  taxa_percentual numeric(6,3),
  primary key (loja_id, n_cod_cc)
);
alter table public.omie_contas_regras enable row level security; -- só service role (sem policies)

insert into public.omie_contas_regras (loja_id, n_cod_cc, prazo_dias, taxa_percentual) values
  (4, 6719180709, 30, 1.69), -- Rede Visa Crédito
  (4, 6719179965, 30, 1.69), -- Rede Master Crédito
  (4, 6719182470, 30, 2.49), -- Rede Elo Crédito
  (4, 6719183387, 30, 0),    -- Rede Amex Crédito
  (4, 6690551207, 2, 0),     -- GetNet Sodexo
  (4, 6690551209, 30, 0),    -- GetNet Alelo
  (4, 6690551199, 1, 1.94),  -- GetNet Master Crédito
  (4, 6719180419, 1, 0.69),  -- Rede Visa Débito
  (4, 6719179776, 1, 0.69),  -- Rede Master Débito
  (4, 6719182845, 1, 1.49),  -- Rede Elo Débito
  (4, 6690551205, 1, 0.69),  -- GetNet Visa Electron Débito
  (4, 6690551195, 1, 1.48),  -- GetNet Elo Débito
  (4, 6845514790, 0, 0)      -- ITAU PIX
on conflict (loja_id, n_cod_cc) do update set prazo_dias = excluded.prazo_dias, taxa_percentual = excluded.taxa_percentual;

update public.lojas set omie_conta_pix = 6845514790 where id = 4;
