#!/bin/bash
# Revisão I1 do C1 (migration 270): corrida entre cancelar o pedido no NTB e o envio ao Omie reivindicar a tentativa.
# A) cancelar segura a trava do pedido; a reivindicação chega no meio → espera e NÃO pega (pedido cancelado).
# B) a reivindicação segura a trava; cancelar chega no meio → espera e é RECUSADO (pedido já 'enviando').
# Só na cópia local (banco $1 do container ntb-teste-sql, com a 270). Nunca em produção. Nenhuma chamada ao Omie.
set -e
DB=${1:?banco local}
P="docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d $DB -Atq"
LOJA=$($P -c "insert into lojas (nome, cnpj, modo_estoque, omie_gravar_pedidos_compra) values ('TESTE 270 CONC', '00000000000278', 'omie', true) returning id")
$P -c "insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values ($LOJA, 3155667788, 'AZ', 'AZEITE', 'UN')"
novo() {
  local id
  id=$($P -c "select (pc_salvar($LOJA, '{\"fornecedor_nome\":\"F\",\"previsao_entrega\":\"2026-10-27\",\"itens\":[{\"codigo_produto\":3155667788,\"quantidade\":1}]}'::jsonb)->>'id')")
  $P -c "select pc_acao($LOJA, $id, 'aprovar'); select pc_omie_enfileirar($LOJA, $id);" > /dev/null
  echo "$id"
}
limpar() {
  $P -c "delete from pedidos_compra_itens where loja_id = $LOJA; alter table pedidos_compra_eventos disable trigger pedidos_compra_eventos_imutavel; delete from pedidos_compra_eventos where loja_id = $LOJA; alter table pedidos_compra_eventos enable trigger pedidos_compra_eventos_imutavel; delete from pedidos_compra_omie where loja_id = $LOJA; delete from pedidos_compra where loja_id = $LOJA; delete from produtos where loja_id = $LOJA; delete from lojas where id = $LOJA"
}
trap limpar EXIT

# A
PA=$(novo)
( $P -c "begin; select pc_acao($LOJA, $PA, 'cancelar', null, null, 'teste'); select pg_sleep(2); commit;" > /dev/null ) &
sleep 0.5
OKA=$($P -c "select pc_omie_reivindicar($LOJA, $PA, 'enviar')->>'ok'")
wait
EA=$($P -c "select p.etapa || '/' || o.status from pedidos_compra p join pedidos_compra_omie o on o.pedido_id = p.id where p.id = $PA")

# B
PB=$(novo)
( $P -c "begin; select pc_omie_reivindicar($LOJA, $PB, 'enviar'); select pg_sleep(2); commit;" > /dev/null ) &
sleep 0.5
if $P -c "select pc_acao($LOJA, $PB, 'cancelar', null, null, 'teste')" > /dev/null 2>&1; then CB=aceitou; else CB=recusou; fi
wait
EB=$($P -c "select p.etapa || '/' || o.status from pedidos_compra p join pedidos_compra_omie o on o.pedido_id = p.id where p.id = $PB")

if [ "$OKA" = "false" ] && [ "$EA" = "cancelado/pendente" ] && [ "$CB" = "recusou" ] && [ "$EB" = "aprovado/enviando" ]; then
  echo "concorrência (270) OK"
else
  echo "FALHOU: A reivindicou=$OKA estado=$EA | B cancelar=$CB estado=$EB"; exit 1
fi
