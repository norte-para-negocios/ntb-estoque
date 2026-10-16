-- Tira do retry automático a linha 1323129 de `movimentos` (loja 5, AZEITONA PRETA (MP) 80203, SAI 2997,
-- "Central de correções: contagem corrigida (3000 → 3)") SEM mandar ao Omie. O Omie recusou todas as tentativas
-- por motivo inválido ("SAI") e a azeitona já foi corrigida à mão pelo Ramon em 15/10/2026: reenviar duplicaria.
--
-- Mesmo jeito que o código usa para tirar uma linha do retry (lib/omie/motivo-ajuste.ts, decidirReenvioAjusteManual;
-- decidirErroItemInventario): status 'Erro' + tentativas no teto (30 = ERRO_MAX_TENTATIVAS de movimentacoes.ts;
-- as 3 queries do retry usam tentativas < 30) + explicação em descricao_status. Não apaga nada.
--
-- Rodar no banco de produção do NE (Contabo, banco `postgres`):
--   scp este arquivo para /tmp no servidor e
--   docker exec -i supabase-db psql -U supabase_admin -d postgres -f /dev/stdin < /tmp/encerrar-mov-1323129-motivo-invalido.sql
-- Só atualiza se a linha ainda está em 'Erro' sem id_ajuste. Se mostrar "UPDATE 0", o cron estava com ela em
-- 'Processando': espere 1-2 minutos e rode de novo. Depois do deploy do branch motivo-ajuste-1510 o próprio cron
-- encerra a linha sozinho (sem ir ao Omie), então este SQL só adianta isso.

begin;

update movimentos
   set status = 'Erro',
       tentativas = greatest(coalesce(tentativas, 0), 30),
       descricao_status = 'Encerrado em 15/10/2026, não reenviar ao Omie: o envio foi recusado por motivo inválido (SAI) '
         || 'e a azeitona 80203 já foi corrigida à mão pelo Ramon. Erro original: '
         || coalesce(descricao_status, ''),
       ultima_tentativa_em = now()
 where id = 1323129
   and loja_id = 5
   and status = 'Erro'
   and id_ajuste is null
returning id, status, tentativas, left(descricao_status, 160) as descricao_status;

commit;
