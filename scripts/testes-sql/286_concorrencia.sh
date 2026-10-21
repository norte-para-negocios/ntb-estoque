#!/bin/bash
# Financeiro 286: baixa dupla. Só na cópia local (banco $1 do container ntb-teste-sql, com a 285 e a 286). Nunca em produção.
# A) duas baixas do SALDO INTEIRO ao mesmo tempo, chaves diferentes → só uma passa (a outra recusa: já pago).
# B) duas chamadas com a MESMA chave ao mesmo tempo → um único pagamento e um único lançamento.
set -e
DB=${1:?banco local}
P="docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d $DB -Atq"
LOJA=$($P -c "insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 286 CONC', '00000000000286', 'proprio') returning id")
FORN=$($P -c "insert into fornecedores (loja_id, razao_social) values ($LOJA, 'F CONC') returning id")
CONTA=$($P -c "select (fin_conta_salvar($LOJA, null, '{\"nome\":\"Caixa\",\"tipo\":\"caixa\",\"saldo_inicial\":0}'::jsonb)->>'id')")
limpar() {
  $P -c "alter table fin_lancamentos disable trigger fin_lancamentos_imutavel; alter table fin_eventos disable trigger fin_eventos_imutavel; alter table fin_pagamentos disable trigger fin_pagamentos_guarda;
         delete from fin_pagamentos where loja_id = $LOJA; delete from fin_lancamentos where loja_id = $LOJA; delete from fin_eventos where loja_id = $LOJA;
         delete from fin_titulos_pagar where loja_id = $LOJA; delete from fin_contas_correntes where loja_id = $LOJA; delete from fin_categorias where loja_id = $LOJA;
         delete from fornecedores where loja_id = $LOJA; delete from lojas where id = $LOJA;
         alter table fin_lancamentos enable trigger fin_lancamentos_imutavel; alter table fin_eventos enable trigger fin_eventos_imutavel; alter table fin_pagamentos enable trigger fin_pagamentos_guarda" > /dev/null
}
trap limpar EXIT
novo() { $P -c "select (fin_titulo_pagar_salvar($LOJA, null, jsonb_build_object('fornecedor_id', $FORN, 'valor', 100, 'data_vencimento', current_date))->>'id')"; }

# A
TA=$(novo)
( $P -c "begin; select fin_pagamento_registrar($LOJA, $TA, '{\"conta_id\":$CONTA}'::jsonb, 'u', 'U', 'cA1'); select pg_sleep(2); commit;" > /dev/null ) &
sleep 0.5
if $P -c "select fin_pagamento_registrar($LOJA, $TA, '{\"conta_id\":$CONTA}'::jsonb, 'u', 'U', 'cA2')" > /dev/null 2>&1; then A2=passou; else A2=recusou; fi
wait
NA=$($P -c "select count(*) from fin_pagamentos where titulo_id = $TA")
QA=$($P -c "select valor_quitado from fin_titulos_pagar where id = $TA")

# B
TB=$(novo)
( $P -c "begin; select fin_pagamento_registrar($LOJA, $TB, '{\"conta_id\":$CONTA}'::jsonb, 'u', 'U', 'cB'); select pg_sleep(2); commit;" > /dev/null ) &
sleep 0.5
DUP=$($P -c "select fin_pagamento_registrar($LOJA, $TB, '{\"conta_id\":$CONTA}'::jsonb, 'u', 'U', 'cB')->>'duplicado'")
wait
NB=$($P -c "select count(*) from fin_pagamentos where titulo_id = $TB")
LB=$($P -c "select count(*) from fin_lancamentos where loja_id = $LOJA")

# C) inativar a conta ao mesmo tempo que um pagamento: o pagamento espera a conta (FOR SHARE), vê que ela já está inativa e recusa
CONTA2=$($P -c "select (fin_conta_salvar($LOJA, null, '{\"nome\":\"Conta C\",\"tipo\":\"caixa\"}'::jsonb)->>'id')")
TC=$(novo)
( $P -c "begin; select fin_conta_salvar($LOJA, $CONTA2, '{\"nome\":\"Conta C\",\"tipo\":\"caixa\",\"ativa\":false}'::jsonb); select pg_sleep(2); commit;" > /dev/null ) &
sleep 0.5
if $P -c "select fin_pagamento_registrar($LOJA, $TC, '{\"conta_id\":$CONTA2}'::jsonb, 'u', 'U', 'cC')" > /dev/null 2>&1; then C1=passou; else C1=recusou; fi
wait
NC=$($P -c "select count(*) from fin_pagamentos where titulo_id = $TC")

if [ "$A2" = "recusou" ] && [ "$NA" = "1" ] && [ "$QA" = "100.00" ] && [ "$DUP" = "true" ] && [ "$NB" = "1" ] && [ "$LB" = "2" ] && [ "$C1" = "recusou" ] && [ "$NC" = "0" ]; then
  echo "concorrência (286) OK"
else
  echo "FALHOU: A 2ª baixa=$A2 pagamentos=$NA quitado=$QA | B duplicado=$DUP pagamentos=$NB lançamentos=$LB | C conta inativada: pagamento=$C1 gravados=$NC"; exit 1
fi
