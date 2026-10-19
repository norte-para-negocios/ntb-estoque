#!/bin/bash
# Migration 240: dois "gerar pedido" simultâneos com a mesma chave = pedidos criados uma vez só; o 2º devolve duplicado.
# Só na cópia local (banco $1 do container ntb-teste-sql, com a 240 aplicada). Nunca em produção.
set -e
DB=${1:?banco local}
P="docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d $DB -Atq"
LOJA=$($P -c "insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 240 CONC', '00000000000249', 'proprio') returning id")
$P -c "insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values ($LOJA, 801, 'P801', 'X', 'UN')"
REQ=$($P -c "select (rc_salvar($LOJA, '{\"itens\":[{\"codigo_produto\":801,\"quantidade\":1,\"fornecedor_nome\":\"F\"}]}'::jsonb)->>'id')")
$P -c "select rc_acao($LOJA, $REQ, 'aprovar')" > /dev/null
# A segura a trava por 2 s antes de confirmar; B chega no meio
( $P -c "begin; select rc_gerar_pedidos($LOJA, array[$REQ]::bigint[], 'conc-gerar-1'); select pg_sleep(2); commit;" > /dev/null ) &
sleep 0.5
B=$($P -c "select rc_gerar_pedidos($LOJA, array[$REQ]::bigint[], 'conc-gerar-1')->>'duplicado'")
wait
N=$($P -c "select count(*) from pedidos_compra where loja_id = $LOJA")
$P -c "alter table requisicoes_compra_eventos disable trigger requisicoes_compra_eventos_imutavel; alter table pedidos_compra_eventos disable trigger pedidos_compra_eventos_imutavel;
  delete from requisicoes_compra_eventos where loja_id = $LOJA; delete from requisicoes_compra_itens where loja_id = $LOJA; delete from requisicoes_compra where loja_id = $LOJA;
  delete from pedidos_compra_eventos where loja_id = $LOJA; delete from pedidos_compra_itens where loja_id = $LOJA; delete from pedidos_compra where loja_id = $LOJA;
  alter table requisicoes_compra_eventos enable trigger requisicoes_compra_eventos_imutavel; alter table pedidos_compra_eventos enable trigger pedidos_compra_eventos_imutavel;
  delete from produtos where loja_id = $LOJA; delete from lojas where id = $LOJA"
if [ "$B" = "true" ] && [ "$N" = "1" ]; then echo "concorrência (240) OK"; else echo "FALHOU: duplicado=$B pedidos=$N"; exit 1; fi
