-- reconcile-notas-fiscais-frio.sql
--
-- NAO EXECUTADO AINDA -- precisa de aprovação humana explícita. Preparado
-- durante a Task 11 (auditoria do relatório Compras, plano
-- 2026-08-09-retry-omie-auditoria-detalhes). Corrigido na "Fix round 1" e na
-- "Fix round 2" depois de 2 revisões independentes, ambas read-only direto
-- em produção (ver task-11-report.md pro achado completo e pros problemas
-- de cada rodada).
--
-- COMO RODAR -- OBRIGATÓRIO: sessão `psql` INTERATIVA, nunca `psql -f` nem
-- qualquer forma não-interativa. Este arquivo de propósito NÃO tem um
-- `COMMIT` no final (fix round 2: a v1 tinha `COMMIT;` na última linha, o
-- que faria `psql -f` rodar preview + UPDATE + COMMIT tudo numa passada só,
-- sem parar pra nenhum humano conferir a contagem do preview antes da
-- escrita virar permanente). No servidor Contabo:
--   sudo -u postgres psql -d ntb_frio
-- Dentro da sessão interativa, cole o conteúdo deste arquivo (ou `\i
-- reconcile-notas-fiscais-frio.sql`), CONFIRA o resultado do preview (passo
-- 1: tem que retornar exatamente 134) e do UPDATE (passo 2: tem que
-- retornar "UPDATE 134"), e só então digite `COMMIT;` você mesmo -- ou
-- `ROLLBACK;` se qualquer um dos dois números não bater com o esperado.
--
-- ACHADO: o dual-write de `notas_fiscais` pro Postgres do Contabo
-- (gravarNotaFiscalNoFrio, lib/omie/nota-fiscal.ts) é fire-and-forget, sem
-- nenhum mecanismo de retry -- ao contrário de ajustes de movimento/
-- inventário/conclusão de OP, que têm crons dedicados
-- (retry-ajustes-movimentos, retry-ajustes-inventario, retry-op-conclusao).
-- Qualquer falha transitória nesse dual-write (ex.: o incidente documentado
-- em AGENTS.md de 2026-07-18, quando frio-api.* respondeu 404 por um
-- período) deixa a NF PERMANENTEMENTE desatualizada -- ou, em casos piores,
-- AUSENTE -- no Contabo, mesmo que o Supabase (fonte quente, sempre
-- correta) já tenha sido atualizado corretamente pelo mesmo código.
--
-- URGÊNCIA -- LEIA COM CUIDADO (fix round 2: a versão anterior deste
-- cabeçalho dizia "impacto hoje é ~zero", verdade só pras 134 notas que
-- ESTE script corrige, e isso invertia a prioridade real dos 2 achados
-- desta task):
--
--   * MAIS URGENTE, JÁ SANGRANDO HOJE, ESTE SCRIPT NÃO CORRIGE: existe um
--     buraco MAIOR (ver "GAP MAIOR" abaixo) de 142 notas que não existem DE
--     JEITO NENHUM no espelho do Contabo -- não é status errado, é linha
--     ausente por completo, precisaria de INSERT, não UPDATE. 141 das 142
--     já estão dentro da janela fria HOJE (2026-08-09) -- só 1 ainda está
--     na janela quente. Maior destaque: loja 5, 105 notas emitidas em
--     março/2026, R$131.897,55 já ausentes do total "Concluída" da tela de
--     Compras AGORA MESMO (medido ao vivo, read-only). Somando as 141 notas
--     já frias em todas as lojas: ~R$161.067,94. Resolver ISSO é mais
--     urgente que rodar este script -- mas este script não resolve.
--
--   * MENOS URGENTE, ESTE SCRIPT RESOLVE: as 134 notas abaixo (status
--     desatualizado, não ausentes) foram TODAS emitidas entre 2026-06-01 e
--     2026-07-12 -- 100% dentro da janela quente atual (corte = hoje-90d ~=
--     2026-05-11) -- o impacto de SÓ essas 134 é ~zero hoje (validado: loja
--     3, período totalmente frio jan-mai/2026, RPC quente x SQL direto no
--     frio bateram quase exato, R$9,02 de diferença em R$995 mil,
--     arredondamento). É uma bomba-relógio: a partir de ~30/08/2026 (quando
--     a nota mais antiga das 134 cruzar os 90 dias) o problema começa a
--     aparecer, crescendo até cobrir as 134 notas (~R$189.555) por volta de
--     ~11/10/2026. Rodar ESTA correção antes de 30/08/2026 evita que ela se
--     some ao buraco maior acima.
--
-- ESCOPO DESTE SCRIPT: só as 134 chaves (loja_id, n_id_receb) diagnosticadas
-- ao vivo em 2026-08-09 como desatualizadas (c_etapa='40' no frio quando já
-- é '60' -- Concluída -- no Supabase). Atualiza SÓ `c_etapa` (o campo que
-- causa o bug diagnosticado), NÃO `full_object` inteiro: 63 das ~10.7 mil NF
-- concluídas no quente têm `full_object` de tamanho diferente do frio por
-- outros motivos não relacionados a este achado (9 delas ENCOLHERIAM se
-- sobrescritas com o lado quente) -- sobrescrever o JSON inteiro arriscava
-- corromper dado não relacionado ao bug sendo corrigido aqui.
--
-- GAP MAIOR, NÃO COBERTO POR ESTE SCRIPT E MAIS URGENTE (ver "URGÊNCIA"
-- acima) -- documentado, não corrigido, mesma causa raiz, mas precisaria de
-- INSERT, não UPDATE:
--   * 142 notas existem no Supabase (quente) e NÃO EXISTEM DE JEITO NENHUM
--     no espelho do Contabo (não é status errado, é linha ausente por
--     completo) -- mesmo dual-write sem retry, provavelmente a mesma classe
--     de falha transitória, só que na chamada de INSERT em vez de UPDATE.
--     141 das 142 já estão na janela fria hoje, sangrando ~R$161.067,94 no
--     total (loja 5/mar-2026 sozinha: R$131.897,55/105 notas).
--   * 163 linhas do lado frio não existem no lado quente -- 161 delas são
--     TODAS da loja 7, que tem ZERO linhas no Supabase hoje (provavelmente
--     loja desativada/histórica) -- inalcançáveis por qualquer reconciliação
--     partindo do lado quente, já que não há fonte de verdade viva pra elas.
-- Resolver o buraco de 142 é candidato a um follow-up separado (provavelmente
-- o mesmo mecanismo de retry sugerido acima pra `gravarNotaFiscalNoFrio`,
-- capaz de INSERT além de UPDATE) -- fora do escopo desta correção pontual,
-- mas é o mais urgente dos dois achados desta task.
--
-- Idempotente: o UPDATE só toca linhas onde `c_etapa` ainda diverge (roda
-- de novo sem efeito colateral se já tiver sido aplicado).

BEGIN;

-- Passo 1 (preview) -- confira ANTES de escrever. Deve retornar exatamente
-- 134. Se não bater, dê ROLLBACK e investigue (os dados podem ter mudado
-- desde o diagnóstico de 2026-08-09) em vez de seguir pro passo 2.
SELECT count(*) AS linhas_que_vao_mudar_esperado_134
FROM notas_fiscais
WHERE (loja_id, n_id_receb) IN (
  (2,'9546153339'), (2,'9546172663'), (2,'9546176108'), (2,'9546176116'), (2,'9547301572'),
  (2,'9548159174'), (2,'9548882179'), (2,'9550713930'), (2,'9550718834'), (2,'9551021758'),
  (2,'9551821664'), (2,'9551831974'), (2,'9552154511'), (2,'9552154524'), (2,'9552154549'),
  (2,'9552200778'), (2,'9552222379'), (2,'9552259363'), (2,'9552451093'), (2,'9552538468'),
  (2,'9552944364'), (2,'9552944400'), (2,'9552944416'), (2,'9552944656'), (2,'9552944691'),
  (2,'9553074042'), (2,'9553226468'), (2,'9553253295'), (2,'9553253311'), (2,'9553492347'),
  (2,'9553499757'), (2,'9553499779'), (2,'9553624068'), (2,'9553624104'), (2,'9553871029'),
  (2,'9554076686'), (2,'9554078630'), (2,'9554078995'), (2,'9554086930'), (2,'9555521278'),
  (2,'9555548793'), (2,'9555548809'), (2,'9555623022'), (2,'9555623041'), (2,'9555945584'),
  (2,'9555945591'), (2,'9556369774'), (2,'9556435046'), (2,'9559198929'), (2,'9560488025'),
  (2,'9564301897'), (2,'9564583928'),
  (3,'4826803326'), (3,'4827164136'), (3,'4827318714'), (3,'4827736933'), (3,'4827916424'),
  (3,'4827921545'), (3,'4827924556'), (3,'4827968354'), (3,'4828184934'), (3,'4828673220'),
  (3,'4828744674'), (3,'4828840042'), (3,'4828915463'), (3,'4828916150'), (3,'4828916189'),
  (3,'4828956970'), (3,'4828957017'), (3,'4828957055'), (3,'4829263062'), (3,'4830075619'),
  (3,'4830446389'), (3,'4831038204'), (3,'4831048639'), (3,'4831339478'), (3,'4831345832'),
  (3,'4831400991'), (3,'4831401031'), (3,'4831427894'), (3,'4831427899'), (3,'4831874665'),
  (3,'4831907517'), (3,'4831909501'), (3,'4831964474'), (3,'4832023038'), (3,'4833305290'),
  (3,'4833305465'), (3,'4833406457'), (3,'4833406481'), (3,'4834297850'), (3,'4834314695'),
  (3,'4834368581'), (3,'4834624353'), (3,'4834722376'), (3,'4834787186'), (3,'4834881079'),
  (3,'4834916885'), (3,'4835119299'), (3,'4835333141'), (3,'4835630150'), (3,'4836374142'),
  (3,'4837739652'), (3,'4837739677'), (3,'4837745017'),
  (4,'6938957772'), (4,'6938997415'), (4,'6944822682'), (4,'6944848130'), (4,'6944848167'),
  (4,'6945072799'), (4,'6945075211'), (4,'6945076347'), (4,'6945077730'), (4,'6945457867'),
  (4,'6945983396'),
  (5,'3793772067'), (5,'3793998579'), (5,'3793998585'), (5,'3794001538'), (5,'3794218219'),
  (5,'3794232434'), (5,'3794248731'), (5,'3794255165'), (5,'3794255170'), (5,'3794531176'),
  (5,'3794533745'), (5,'3794533765'),
  (6,'8970577197'), (6,'8981904690'), (6,'8981904723'), (6,'8982499297'), (6,'8982850379'),
  (6,'8982850411')
)
AND c_etapa IS DISTINCT FROM '60';

-- Passo 2 -- aplica a correção. Escopo travado nas mesmas 134 chaves do
-- passo 1, e só toca linhas que ainda divergem (idempotente). Atualiza
-- SOMENTE c_etapa (não full_object).
UPDATE notas_fiscais
SET c_etapa = '60', updated_at = now()
WHERE (loja_id, n_id_receb) IN (
  (2,'9546153339'), (2,'9546172663'), (2,'9546176108'), (2,'9546176116'), (2,'9547301572'),
  (2,'9548159174'), (2,'9548882179'), (2,'9550713930'), (2,'9550718834'), (2,'9551021758'),
  (2,'9551821664'), (2,'9551831974'), (2,'9552154511'), (2,'9552154524'), (2,'9552154549'),
  (2,'9552200778'), (2,'9552222379'), (2,'9552259363'), (2,'9552451093'), (2,'9552538468'),
  (2,'9552944364'), (2,'9552944400'), (2,'9552944416'), (2,'9552944656'), (2,'9552944691'),
  (2,'9553074042'), (2,'9553226468'), (2,'9553253295'), (2,'9553253311'), (2,'9553492347'),
  (2,'9553499757'), (2,'9553499779'), (2,'9553624068'), (2,'9553624104'), (2,'9553871029'),
  (2,'9554076686'), (2,'9554078630'), (2,'9554078995'), (2,'9554086930'), (2,'9555521278'),
  (2,'9555548793'), (2,'9555548809'), (2,'9555623022'), (2,'9555623041'), (2,'9555945584'),
  (2,'9555945591'), (2,'9556369774'), (2,'9556435046'), (2,'9559198929'), (2,'9560488025'),
  (2,'9564301897'), (2,'9564583928'),
  (3,'4826803326'), (3,'4827164136'), (3,'4827318714'), (3,'4827736933'), (3,'4827916424'),
  (3,'4827921545'), (3,'4827924556'), (3,'4827968354'), (3,'4828184934'), (3,'4828673220'),
  (3,'4828744674'), (3,'4828840042'), (3,'4828915463'), (3,'4828916150'), (3,'4828916189'),
  (3,'4828956970'), (3,'4828957017'), (3,'4828957055'), (3,'4829263062'), (3,'4830075619'),
  (3,'4830446389'), (3,'4831038204'), (3,'4831048639'), (3,'4831339478'), (3,'4831345832'),
  (3,'4831400991'), (3,'4831401031'), (3,'4831427894'), (3,'4831427899'), (3,'4831874665'),
  (3,'4831907517'), (3,'4831909501'), (3,'4831964474'), (3,'4832023038'), (3,'4833305290'),
  (3,'4833305465'), (3,'4833406457'), (3,'4833406481'), (3,'4834297850'), (3,'4834314695'),
  (3,'4834368581'), (3,'4834624353'), (3,'4834722376'), (3,'4834787186'), (3,'4834881079'),
  (3,'4834916885'), (3,'4835119299'), (3,'4835333141'), (3,'4835630150'), (3,'4836374142'),
  (3,'4837739652'), (3,'4837739677'), (3,'4837745017'),
  (4,'6938957772'), (4,'6938997415'), (4,'6944822682'), (4,'6944848130'), (4,'6944848167'),
  (4,'6945072799'), (4,'6945075211'), (4,'6945076347'), (4,'6945077730'), (4,'6945457867'),
  (4,'6945983396'),
  (5,'3793772067'), (5,'3793998579'), (5,'3793998585'), (5,'3794001538'), (5,'3794218219'),
  (5,'3794232434'), (5,'3794248731'), (5,'3794255165'), (5,'3794255170'), (5,'3794531176'),
  (5,'3794533745'), (5,'3794533765'),
  (6,'8970577197'), (6,'8981904690'), (6,'8981904723'), (6,'8982499297'), (6,'8982850379'),
  (6,'8982850411')
)
AND c_etapa IS DISTINCT FROM '60';

-- FIM DO SCRIPT -- de propósito, SEM COMMIT/ROLLBACK aqui (fix round 2, ver
-- cabeçalho). A transação acima fica ABERTA depois do UPDATE. Confira, na
-- SUA sessão psql interativa:
--   1) o preview (passo 1) retornou "134"?
--   2) o UPDATE (passo 2) respondeu "UPDATE 134"?
-- Se os dois baterem: digite `COMMIT;` você mesmo. Se qualquer um não
-- bater: digite `ROLLBACK;` e investigue antes de tentar de novo -- não
-- rode este arquivo inteiro de novo sem entender por que os números
-- mudaram desde o diagnóstico de 2026-08-09.
