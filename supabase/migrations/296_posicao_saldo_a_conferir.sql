-- 296: Posição de estoque / Estoque valorizado — saldos do Omie que precisam de conferência (auditoria dos relatórios,
-- 23/10/2026, loja 5).
--
-- Problema (produção, só leitura, foto de 23/10, loja 5): parte grande do total vem de produtos com saldo MAIOR do que
-- tudo o que entrou por nota nos últimos 12 meses — o Omie soma as compras e nunca dá baixa (consumo, perda, produção):
--   60037 GLP (MC)              16.027 kg  R$ 226.468,98  (comprou 7.432 kg em 12 meses; nenhuma saída no kardex)
--   80157 MAIONESE (MP)         11.199 kg  R$ 186.144,39  (comprou 154 kg)
--   80049 FILE MIGNON (MP)       1.980 kg  R$ 138.339,65  (comprou 767 kg)
--   80304 CAMARAO S/ CABECA IQF  2.011 kg  R$ 101.296,90  (comprou 186 kg)
--   80142 TOMATE SALADA (MP)     8.715 kg  R$  56.631,84
--   60159 GASOLINA COMUM (MC)    5.731 l   R$  35.529,95
-- E produtos INATIVOS com saldo (muitos cadastrados sozinhos pela entrada de nota, tipo 99, sem família — ex. 13190
-- CAMARAO CONG BLOCO CRU PPV 61/70, 720 kg, R$ 30.053,00): 73 produtos, R$ 141.158,29.
-- Esses saldos são do Omie (o relatório soma como o Omie). A função não muda valor nenhum: só aponta o que conferir.
--
-- posicao_saldo_a_conferir(loja, data) — uma linha por produto com saldo na foto (mesma foto e mesmo valor de
-- posicao_valorizada) que tenha pelo menos um dos sinais:
--   acumulado: saldo > 0, valor ≥ R$ 1.000 e saldo maior que a soma das quantidades recebidas (unidade de estoque,
--              nQtdeRecebida) nas notas concluídas e não canceladas emitidas nos 365 dias até a foto. Só vale se a loja
--              tem nota com mais de 365 dias (histórico de 12 meses completo); senão nenhum produto é marcado.
--   inativo:   produto inativo no cadastro com saldo diferente de zero.
-- Colunas: n_cod_prod, saldo, valor, comprado_12m (= tudo o que ENTROU em 12 meses: notas + produção das OPs, o maior
-- entre o espelho de OPs e as entradas de OP do kardex, + entradas por ajuste/inventário do kardex; null = nada),
-- acumulado, inativo. Produto produzido ou com entrada por inventário não é mais marcado só por não ter nota (revisão
-- 23/10); continua exigindo pelo menos uma nota no período.
--
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 296_posicao_saldo_a_conferir.sql
-- (depois da 282; a 295 é independente). Sem ela as telas não mostram o aviso (nada quebra).
-- Reverter: drop function public.posicao_saldo_a_conferir(bigint, date);
-- Teste: scripts/testes-sql/296_posicao_saldo_a_conferir.sql (banco local).

begin;

create or replace function public.posicao_saldo_a_conferir(p_loja_id bigint, p_data date default null)
returns table (n_cod_prod bigint, saldo numeric, valor numeric, comprado_12m numeric, acumulado boolean, inativo boolean)
language sql stable security invoker set search_path = public as $$
  with v as (
    select pv.n_cod_prod, sum(pv.n_saldo) as saldo, sum(pv.valor) as valor, max(pv.data_posicao) as d
    from posicao_valorizada(p_loja_id, p_data) pv
    group by pv.n_cod_prod
    having sum(pv.n_saldo) <> 0
  ), foto as (
    select max(v.d) as d from v
  ), cobre as (  -- histórico de notas de pelo menos 12 meses antes da foto
    select exists (
      select 1 from notas_fiscais nf, foto f
      where nf.loja_id = p_loja_id and nf.deleted_at is null and nf.c_etapa = '60' and nf.d_emissao_nfe <= f.d - 365
    ) as ok
  ), cand as (
    select v.* from v, cobre where cobre.ok and v.saldo > 0 and v.valor >= 1000
  ), comp as (
    select i.n_id_produto, sum(coalesce(nullif(nullif(i.full_object->'itensAjustes'->>'nQtdeRecebida', '')::numeric, 0), i.n_qtde_nfe, 0)) as q
    from nota_fiscal_items i
    join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
    cross join foto f
    where i.loja_id = p_loja_id and i.n_id_produto in (select c.n_cod_prod from cand c)
      and nf.deleted_at is null and nf.c_etapa = '60'
      and coalesce(nf.full_object->'infoCadastro'->>'cCancelada', 'N') <> 'S'
      and nf.d_emissao_nfe > f.d - 365 and nf.d_emissao_nfe <= f.d
      and item_movimenta_estoque(i.full_object)
    group by i.n_id_produto
  ), op as (  -- produzido nas OPs concluídas em 12 meses (espelho de OPs)
    select o.identificacao_n_cod_produto as n_cod_prod, sum(coalesce(o.identificacao_n_qtde, o.quantidade, 0)) as q
    from ordens_producao o cross join foto f
    where o.loja_id = p_loja_id and o.concluida and o.identificacao_n_cod_produto in (select c.n_cod_prod from cand c)
      and o.dt_conclusao_real::date > f.d - 365 and o.dt_conclusao_real::date <= f.d
    group by o.identificacao_n_cod_produto
  ), kx as (  -- kardex: entradas de produção e entradas por ajuste/inventário em 12 meses (o espelho de OPs tem buracos)
    select k.n_cod_prod,
           sum(k.quantidade) filter (where k.cod_origem = 'OPE') as ope,
           sum(k.quantidade) filter (where k.cod_origem not in ('OPE', 'COM', 'IMP', 'CIM')) as aju
    from kardex_omie k cross join foto f
    where k.loja_id = p_loja_id and not k.cancelado and k.quantidade > 0 and k.n_cod_prod in (select c.n_cod_prod from cand c)
      and k.data_mov > f.d - 365 and k.data_mov <= f.d
    group by k.n_cod_prod
  ), r as (
    select v.n_cod_prod, v.saldo, v.valor,
           -- entrou em 12 meses = notas + produção (o maior entre OPs e kardex, para não contar duas vezes) + ajustes positivos
           nullif(coalesce(comp.q, 0) + greatest(coalesce(op.q, 0), coalesce(kx.ope, 0)) + coalesce(kx.aju, 0), 0) as entrou,
           comp.q as comprado,
           c.n_cod_prod is not null as candidato,
           coalesce(p.inativo, false) as inativo
    from v
    left join cand c on c.n_cod_prod = v.n_cod_prod
    left join comp on comp.n_id_produto = v.n_cod_prod
    left join op on op.n_cod_prod = v.n_cod_prod
    left join kx on kx.n_cod_prod = v.n_cod_prod
    left join produtos p on p.loja_id = p_loja_id and p.codigo_produto = v.n_cod_prod
  )
  select r.n_cod_prod, round(r.saldo, 6) as saldo, round(r.valor, 2) as valor, round(r.entrou, 6) as comprado_12m, r.acumulado, r.inativo
  from (select r0.*, (r0.candidato and r0.comprado > 0 and r0.saldo > r0.entrou) as acumulado from r r0) r
  where r.acumulado or r.inativo
$$;

revoke all on function public.posicao_saldo_a_conferir(bigint, date) from public, anon;
grant execute on function public.posicao_saldo_a_conferir(bigint, date) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
