-- 295: Posição de estoque / Estoque valorizado — custo do Omie fora da escala da unidade (auditoria dos relatórios,
-- 23/10/2026, loja 5).
--
-- Problema (produção, só leitura, foto de 23/10, loja 5, total 2.121.249,54): a regra do custo suspeito da 282 compara o
-- CMC com o CMC dos OUTROS locais com saldo positivo — mas o próprio local entra na referência. Produto com um local só
-- nunca é suspeito, por mais absurdo que seja o custo para a unidade:
--   80284 CAFE SOLUVEL (MP)       1.000 G × R$ 99,716/g  = R$ 99.716,00  (custo do QUILO em grama; vale ~R$ 99,72)
--   80405 MONIN MARACUJA AZUL     550 ML × R$ 49,75/ml   = R$ 27.362,50  (custo da GARRAFA de 700 ml em ml; nota de
--   80404 MONIN MARACUJA          550 ML × R$ 49,075/ml  = R$ 26.991,25   16/06 entrou 2 GF a 49,75 sem conversão)
--   80403 MONIN LIMAO SICILIANO   500 ML × R$ 49,075/ml  = R$ 24.537,50
--   80073 LEITE DE COCO 20 %      660 ML × R$ 12,61/ml   = R$  8.322,00
--   70081 MOLHO DE LEGUMES (PI)   1 L × R$ 6.241,31/L    = R$  6.241,31
--   + canela em pau 64,92/g, páprica 37,66/g, martini 39,67/ml, monin manga (−50 ml × 49,75)
--   Lojas 2/3/4/6: conhaque Domecq 27,44/ml (+400 e −999 ml), suco concentrado 6,75/ml, paçoca 11,50/g, molho de tomate
--   79,26/g, pimenta biquinho 25–44/g, rúcula 10,61/g, farinha de rosca 19,89/g, ...
--
-- Regra nova, "fora da escala da unidade" (dado errado no Omie: custo de outra unidade — quilo, litro, garrafa):
--   unidade de grama/mililitro (G, GR, GRS, GRAMA, GRAMAS, ML) com CMC > R$ 5,00 por g/ml (= R$ 5.000 o quilo/litro);
--     ML de tipo 08 (ativo) e 99 (outras) fica fora: lá ML é metro linear (cabos 281581/3966950, R$ 7–16 o metro);
--   unidade de quilo/litro (KG, KGS, L, LT, LTS, LITRO) com CMC > R$ 2.000 por kg/l.
-- A linha fora da escala é SUSPEITA e:
--   (1) não entra na referência dos locais (antes o próprio custo errado virava a referência);
--   (2) vale saldo × referência de custo do produto (outros locais com saldo positivo, senão a última entrada por nota),
--       desde que a referência também esteja dentro da escala (a nota do Monin entrou a 49,75 "por ml" — não serve);
--   (3) sem referência boa, em g/ml vale saldo × (CMC ÷ fator): fator = tamanho da embalagem escrito na descrição
--       ("700ML" = 700, "1L" = 1000, "500G" = 500, "1KG" = 1000), senão 1000 (custo do quilo/litro); fonte_referencia =
--       'unidade' e referencia = CMC ÷ fator (a tela mostra o fator = CMC ÷ referência). Em kg/l sem referência vale 0.
-- As demais regras da 282 continuam iguais (≥ 1e7; > 10× a referência; sem referência > 10× o preço de venda; sem nada,
-- negativa > 100 mil). Acréscimo pequeno: a última entrada por nota ignora nota cancelada (cCancelada = 'S'), como as
-- RPCs de Compras.
-- Mesma assinatura e colunas (CREATE OR REPLACE): Posição, Estoque Valorizado (283), CMV (fonte "foto", 282) e Bloco H
-- passam a usar a regra sem mudar código. Valores conferidos no fim do arquivo de teste.
--
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 295_custo_fora_de_escala_unidade.sql
-- (depois da 282 e da 290, que cria teto_custo_unidade; independente da 296). Depois: desktop/scripts/gerar-schema.sh (desktop/schema copia esta função).
-- Reverter: reaplicar o CREATE OR REPLACE de posicao_valorizada da 282.
-- Teste: scripts/testes-sql/295_custo_fora_de_escala_unidade.sql (banco local).

begin;

create or replace function public.posicao_valorizada(p_loja_id bigint, p_data date default null)
returns table (
  n_cod_prod bigint, codigo_local_estoque bigint, data_posicao date, n_saldo numeric, n_cmc numeric, reservado numeric,
  cmc_usado numeric, valor numeric, suspeito boolean, referencia numeric, fonte_referencia text, valor_omie numeric
)
language sql stable security invoker set search_path = public as $$
  with foto as (
    select coalesce(p_data, (select max(pe.data_posicao) from posicao_estoques pe where pe.loja_id = p_loja_id and pe.codigo_local_estoque <> 0)) as d
  ), l0 as (
    select pe.n_cod_prod, pe.codigo_local_estoque, pe.data_posicao, coalesce(pe.n_saldo, 0) as n_saldo, coalesce(pe.n_cmc, 0) as n_cmc, pe.reservado,
           pr.valor_unitario as preco,
           -- escala da unidade: regra única teto_custo_unidade (290), a mesma do CMV
           teto_custo_unidade(pr.unidade, pr.tipo_item) as teto_un,
           case teto_custo_unidade(pr.unidade, pr.tipo_item) when 5 then 'fracao' when 2000 then 'inteira' end as escala_un,
           upper(btrim(coalesce(pr.unidade, ''))) as un,
           pr.descricao
    from posicao_estoques pe
    join foto f on pe.data_posicao = f.d
    left join produtos pr on pr.loja_id = p_loja_id and pr.codigo_produto = pe.n_cod_prod
    where pe.loja_id = p_loja_id and pe.codigo_local_estoque <> 0
  ), l as (
    select l0.*,
           -- custo de outra unidade (quilo/litro/embalagem) gravado na unidade do produto
           coalesce(l0.n_cmc > l0.teto_un, false) as fora_escala
    from l0
  ), ref_locais as (  -- referência 1: CMC ponderado dos locais do produto com saldo positivo (sem os fora de escala)
    select l.n_cod_prod, sum(l.n_saldo * l.n_cmc) / sum(l.n_saldo) as ref
    from l
    where l.n_saldo > 0 and l.n_cmc > 0 and l.n_cmc < 10000000 and not l.fora_escala
    group by l.n_cod_prod
  ), sem_ref as (
    select distinct l.n_cod_prod from l
    where l.n_saldo <> 0 and l.n_cmc > 0 and not exists (select 1 from ref_locais r where r.n_cod_prod = l.n_cod_prod)
  ), ref_entrada as (  -- referência 2: custo unitário da última entrada (valor de estoque N3 ÷ quantidade recebida)
    select s.n_cod_prod, e.c as ref
    from sem_ref s
    cross join lateral (
      select custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit)
             / nullif(coalesce(nullif(nullif(i.full_object->'itensAjustes'->>'nQtdeRecebida', '')::numeric, 0), i.n_qtde_nfe), 0) as c
      from nota_fiscal_items i
      join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
      where i.loja_id = p_loja_id and i.n_id_produto = s.n_cod_prod
        and nf.deleted_at is null and nf.c_etapa = '60' and item_movimenta_estoque(i.full_object)
        and coalesce(nf.full_object->'infoCadastro'->>'cCancelada', 'N') <> 'S'
      order by nf.d_emissao_nfe desc, i.id desc
      limit 1
    ) e
    where e.c > 0
  ), ref as (
    select r.n_cod_prod, r.ref, 'locais'::text as f from ref_locais r
    union all
    select r.n_cod_prod, r.ref, 'entrada'::text from ref_entrada r
  ), av0 as (
    select l.*,
           -- referência que também está dentro da escala da unidade (senão não serve)
           case when r.ref is null or r.ref > l.teto_un then null else r.ref end as ref,
           case when r.ref is null or r.ref > l.teto_un then null else r.f end as f,
           -- tamanho da embalagem na descrição, na unidade do produto ("700ML" → 700 ml, "1,5L" → 1500 ml, "1KG" → 1000 g)
           (select case when l.un = 'ML' and m[2] = 'ML' then n
                        when l.un = 'ML' and m[2] in ('L', 'LT', 'LTS') then n * 1000
                        when l.un <> 'ML' and m[2] in ('G', 'GR', 'GRS') then n
                        when l.un <> 'ML' and m[2] in ('KG', 'KGS') then n * 1000
                   end
            from (select regexp_match(upper(coalesce(l.descricao, '')), '(\d+(?:[.,]\d+)*)\s*(ML|LTS|LT|L|KGS|KG|GRS|GR|G)(?![A-Z])') as m) x
            -- "3.600G" = 3.600 g (ponto de milhar), "1,5L" = 1,5 l, "0.750L" = 0,75 l
            cross join lateral (select case when x.m[1] ~ '^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$' then replace(replace(x.m[1], '.', ''), ',', '.')
                                            when x.m[1] ~ '^\d+([.,]\d+)?$' then replace(x.m[1], ',', '.')
                                       end::numeric as n) y
            where x.m is not null) as tam_desc
    from l
    left join ref r on r.n_cod_prod = l.n_cod_prod
  ), av as (
    select av0.*,
           case when av0.escala_un = 'fracao' then coalesce(case when av0.tam_desc between 2 and 100000 then av0.tam_desc end, 1000) end as fator,
           case when av0.n_cmc <= 0 or av0.n_saldo = 0 then false
                when av0.n_cmc >= 10000000 then true                          -- trava antiga: nunca vale como custo
                when av0.fora_escala then true                                -- custo de outra unidade (295)
                when av0.ref is not null then av0.n_cmc > 10 * av0.ref        -- regra do dono: mais de 10× a referência de custo
                when av0.preco > 0 then av0.n_cmc > 10 * av0.preco            -- sem custo de referência: 10× o preço de venda
                else av0.n_saldo < 0 and av0.n_cmc > 100000                   -- sem nada: linha negativa com CMC > 100 mil
           end as susp
    from av0
  ), fim as (
    select av.*,
           case when not av.susp then null
                when av.ref is not null then round(av.ref, 6)
                when av.fora_escala and av.fator is not null then round(av.n_cmc / av.fator, 6)
           end as ref_usada,
           case when not av.susp then av.f
                when av.ref is not null then av.f
                when av.fora_escala and av.fator is not null then 'unidade'
           end as fonte
    from av
  )
  select fim.n_cod_prod, fim.codigo_local_estoque, fim.data_posicao, fim.n_saldo, fim.n_cmc, fim.reservado,
         case when fim.susp then coalesce(fim.ref_usada, 0) when fim.n_cmc > 0 then fim.n_cmc else 0 end as cmc_usado,
         round(fim.n_saldo * case when fim.susp then coalesce(fim.ref_usada, 0) when fim.n_cmc > 0 then fim.n_cmc else 0 end, 2) as valor,
         fim.susp as suspeito,
         case when fim.susp then fim.ref_usada else round(fim.ref, 6) end as referencia,
         fim.fonte as fonte_referencia,
         round(fim.n_saldo * fim.n_cmc, 2) as valor_omie
  from fim
$$;

revoke all on function public.posicao_valorizada(bigint, date) from public, anon;
grant execute on function public.posicao_valorizada(bigint, date) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
