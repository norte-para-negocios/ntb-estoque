\set ON_ERROR_STOP 1
begin;
create temp table cp as select codigo, codigo_produto from produtos where loja_id=15 and codigo in ('90081','90083','70038','70016','70039');
-- 90081 Ensopado de Filé de Pescada: tira a pescada inteira 600 g (proteína em dobro na Donana 90214)
select salvar_ficha(15, f.codigo_produto, f.rendimento,
  (select jsonb_agg(jsonb_build_object('codigo_insumo',i.codigo_insumo,'quantidade_liquida',i.quantidade_liquida,'fator_correcao',i.fator_correcao,'perda_pct',i.perda_pct) order by i.ordem)
     from ficha_tecnica_itens i where i.ficha_id=f.id and i.codigo_insumo <> (select codigo_produto from cp where codigo='70038')),
  f.expandir_na_venda, 'Norte', 'Correção: sem a pescada inteira 600 g duplicada da Donana (90214); só o filé')
from fichas_tecnicas f where f.loja_id=15 and f.ativa and f.codigo_produto=(select codigo_produto from cp where codigo='90081');
-- 90083 Moqueca de Filé de Pescada e Camarão: filé 400 g no lugar da pescada inteira 500 g (igual ao Ensopado 90084)
select salvar_ficha(15, f.codigo_produto, f.rendimento,
  (select jsonb_agg(jsonb_build_object('codigo_insumo',case when i.codigo_insumo=(select codigo_produto from cp where codigo='70016') then (select codigo_produto from cp where codigo='70039') else i.codigo_insumo end,
     'quantidade_liquida',i.quantidade_liquida,'fator_correcao',i.fator_correcao,'perda_pct',i.perda_pct) order by i.ordem)
     from ficha_tecnica_itens i where i.ficha_id=f.id),
  f.expandir_na_venda, 'Norte', 'Correção: filé de pescada 400 g no lugar da pescada inteira (Donana 90556), igual ao ensopado')
from fichas_tecnicas f where f.loja_id=15 and f.ativa and f.codigo_produto=(select codigo_produto from cp where codigo='90083');
select pp.codigo, f.versao, c.codigo, c.descricao, i.quantidade_liquida from fichas_tecnicas f join produtos pp on pp.loja_id=15 and pp.codigo_produto=f.codigo_produto
 join ficha_tecnica_itens i on i.ficha_id=f.id join produtos c on c.loja_id=15 and c.codigo_produto=i.codigo_insumo
 where f.loja_id=15 and f.ativa and pp.codigo in ('90081','90083') and (c.descricao ilike '%pescada%' or c.descricao ilike '%file%') order by 1;
\if :{?commit}
commit;
\else
rollback;
\endif
