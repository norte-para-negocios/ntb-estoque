#!/bin/bash
# Nota × OP ao mesmo tempo não travam em cruz (313: lancar_compra trava os produtos da cascata em ordem de código antes
# de gravar). CÓPIA local, nunca produção. Uso: PSQL="psql -h … -U supabase_admin" DB_MODELO=base bash scripts/testes-sql/313_concorrencia.sh
# A sessão A faz o que produzir faz (trava em ordem de código: drink 31300 < guaraná 31312) devagar; a B lança a nota do
# guaraná no meio. Sem a trava antecipada a B pegava o guaraná primeiro e o reprocessamento esperava o drink: deadlock.
set -e
cd "$(dirname "$0")/../.."
DB=conc313
$PSQL -d ${DB_MODELO:-base} -q -c "drop database if exists $DB" -c "create database $DB template ${DB_MODELO:-base}"
for f in 311_custo_revisao 312_reprocessar_custo 313_compra_data_da_nota; do $PSQL -d $DB -q -1 -v ON_ERROR_STOP=1 -f supabase/migrations/$f.sql 2>&1 | grep -v skipping || true; done
$PSQL -d $DB -q -v ON_ERROR_STOP=1 <<'SQL'
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99313, '00000000099313', 'TESTE 313', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99313, 8000000031301, 'Estoque', 'S');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
  (99313, 8000000031312, '31312', 'Guaraná 313', 'UN', '00'), (99313, 8000000031300, '31300', 'Drink 313', 'UN', '04');
select registrar_movimento(99313, 8000000031301, 8000000031312, 'PRD', 'PRODUCAO', 'op-drink', -1, null, null, null, 0, null, null, '2026-10-13');
select registrar_movimento(99313, 8000000031301, 8000000031300, 'PRD', 'PRODUCAO', 'op-drink', 1, null, null, null, 0, null, null, '2026-10-13');
SQL
# A: como produzir (_travar_custos em ordem de código), com uma pausa entre o drink e o guaraná (alarga a janela real)
$PSQL -d $DB -q -At -c "begin; select _travar_custos(99313, array[8000000031300]::bigint[]); select pg_sleep(2);
  select _travar_custos(99313, array[8000000031312]::bigint[]);
  select registrar_movimento(99313, 8000000031301, 8000000031312, 'PRD', 'PRODUCAO', 'op2', -1, null, null, null, 0, null, null, null) is not null;
  select registrar_movimento(99313, 8000000031301, 8000000031300, 'PRD', 'PRODUCAO', 'op2', 1, null, null, null, 0, null, null, null) is not null; commit;" > /tmp/conc313_a.log 2>&1 &
sleep 0.5
# B: nota do guaraná
$PSQL -d $DB -q -At -c "select lancar_compra(jsonb_build_object('loja_id', 99313, 'numero', '6', 'emissao', '2026-10-12',
  'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'quantidade', 2, 'valor_unitario', 2, 'valor_total', 4, 'codigo_produto', 8000000031312))), 8000000031301, null)->>'status'" > /tmp/conc313_b.log 2>&1
wait
if grep -qi deadlock /tmp/conc313_a.log /tmp/conc313_b.log; then echo "FALHOU: deadlock"; cat /tmp/conc313_*.log; exit 1; fi
grep -q lancada /tmp/conc313_b.log || { echo "FALHOU: nota não lançada"; cat /tmp/conc313_*.log; exit 1; }
grep -qi error /tmp/conc313_a.log && { echo "FALHOU: sessão A"; cat /tmp/conc313_a.log; exit 1; }
$PSQL -d ${DB_MODELO:-base} -q -c "drop database $DB"
echo "313 CONCORRENCIA OK"
