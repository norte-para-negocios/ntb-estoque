#!/bin/bash
# Revisão M1 da migration 200: dois envios simultâneos com a mesma chave de idempotência = 1 pedido + "duplicado".
# Só na cópia local (banco $1 do container ntb-teste-sql, com a 200 aplicada). Nunca em produção.
set -e
DB=${1:?banco local}
P="docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d $DB -Atq"
LOJA=$($P -c "insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 200 CONC', '00000000000099', 'proprio') returning id")
$P -c "insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values ($LOJA, 601, 'P601', 'X', 'UN')"
DADOS='{"chave_idempotencia":"conc-1","fornecedor_nome":"F","itens":[{"codigo_produto":601,"quantidade":1}]}'
# A segura a trava por 2 s antes de confirmar; B chega no meio
( $P -c "begin; select pc_salvar($LOJA, '$DADOS'::jsonb); select pg_sleep(2); commit;" > /dev/null ) &
sleep 0.5
B=$($P -c "select pc_salvar($LOJA, '$DADOS'::jsonb)->>'duplicado'")
wait
N=$($P -c "select count(*) from pedidos_compra where loja_id = $LOJA")
$P -c "delete from pedidos_compra_itens where loja_id = $LOJA; alter table pedidos_compra_eventos disable trigger pedidos_compra_eventos_imutavel; delete from pedidos_compra_eventos where loja_id = $LOJA; alter table pedidos_compra_eventos enable trigger pedidos_compra_eventos_imutavel; delete from pedidos_compra where loja_id = $LOJA; delete from produtos where loja_id = $LOJA; delete from lojas where id = $LOJA"
if [ "$B" = "true" ] && [ "$N" = "1" ]; then echo "concorrência (200) OK"; else echo "FALHOU: duplicado=$B pedidos=$N"; exit 1; fi
