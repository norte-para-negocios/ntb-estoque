# D5 — Espelho completo (kardex) nas lojas 2, 3 e 6: proteção e roteiro de ativação

Plano mestre: `2026-10-18-plano-mestre-paridade-omie.md`, Fase D item 5 [L7/L24]. Branch de trabalho a partir de `paridade-omie`.

**Regras fixas:** loja 4 (Sertão) nunca, já travada no código (`getLojasEspelhoCompleto` + `lojaPodeEspelhar`). Loja 7 não: a chave está inválida (hoje já gera `[BLOQUEIO OMIE]` em `ListarAjusteEstoque`, `ListarOrdemProducao`, `ListarPosEstoque` e `ListarRecebimentos`). Loja 5 **continua desligada** até a faxina externa terminar, porque ela usa a mesma chave do Omie. Loja de teste nunca.

## 1. Por que precisou mudar código antes de ligar

Limites do Omie ([Limites de consumo da API](https://ajuda.omie.com.br/pt-BR/articles/8112984-limites-de-consumo-da-api-do-omie)): 960 req/min por IP (todas as lojas usam o mesmo IP do servidor), 240 req/min e 4 simultâneas por IP + App Key + método, 100 registros por página. A 10ª requisição com erro no mesmo IP + App Key + método causa bloqueio de 30 min (HTTP 425). A página não diz em que janela os 10 erros são contados, nem se "Não existem registros" conta como erro.

O que estava no código em 20/10 e o que mudou:

| Problema | Antes | Agora |
|---|---|---|
| Erro repetido sem teto | Erro do Omie deixava o cursor parado e a mesma página era repetida a cada 10 min, sem limite. Fichas e OPs abertas também repetiam o mesmo produto/OP. | **Guarda** (`lib/estoque/espelho-guarda.ts` + `lib/omie/espelho-ciclo.ts`): depois de um erro, a frente espera 10, 20, 40, 80 min e, no 5º erro seguido, 24 h (no máximo 5 erros por frente e método por dia). Produto de ficha ou OP que deu erro sai da fila (7 dias / 24 h) em vez de travar a frente. |
| Bloqueio numa frente, outras seguiam | Kardex bloqueado não impedia OPs abertas, fichas e ajustes da mesma loja de chamar o Omie. O nosso disjuntor trava a **chave inteira** quando um 2º método bloqueia, e isso pararia as vendas da loja. | Erro de limite (MISUSE, consumo redundante, 425/429, recusa do disjuntor) **pausa a loja inteira por 60 min** em todas as frentes. Antes de cada loja, ela é pulada se o disjuntor tem qualquer método da chave bloqueado (em memória) ou se há `[BLOQUEIO OMIE]` da loja nos últimos 35 min (`integration_attempts`, vale depois de restart). Guarda ilegível = loja pulada. |
| Lojas em série sem orçamento | Kardex, OPs e fichas rodavam loja por loja, até 150 s **cada**. Com 3 lojas, o kardex sozinho passaria de 450 s. | Orçamento por ciclo para todas as lojas juntas (kardex 200 s, OPs abertas 120 s, fichas 120 s), **rodízio** da ordem a cada ciclo; a loja que não cabe fica para o ciclo seguinte. |
| Ciclo principal já no limite | O `sync-cron.sh` leva ~7 dos 10 min (o `retry-ajustes-movimentos` estoura 240 s em quase todo ciclo, `000ERR`). O espelho em 3 lojas passaria de 10 min, e o `flock -n` pularia ciclos inteiros, inclusive o retry da integração de vendas. | Kardex, OPs abertas e fichas saem para `scripts/sync-espelho.sh`, com trava, log e horário próprios (minuto 5 de cada 10). O `sync-ajustes` continua no principal, com teto de 90 s (era 150 s). |
| Ligar o espelho religava consultas pesadas | O webhook (`ConsultarOrdemProducao` a cada aviso de OP) e o cron de OPs fantasmas usavam `espelho_completo` como "fora de faxina". Como a flag é false em todas as lojas, os dois estão parados em **todas** desde 16/10. Ligar o espelho numa loja religaria os dois junto, no mesmo método que bloqueou a loja 5 em 16/10. | Coluna própria `lojas.omie_op_tempo_real` (migration **250**, padrão false = mantém o que roda hoje). Religar é decisão separada, loja a loja. |
| Custo da frente recente | Relia ontem + hoje a cada 30 min, em todos os locais ativos (cada local vazio custa 1 chamada por janela). Na loja 5 isso ocupava ~80% do ciclo, e revisão e backfill quase não avançavam. | Recente a cada 60 min e só nos locais com movimento nos últimos 35 dias (`estado.ativos`). Revisão e backfill continuam em todos os locais e descobrem local novo. Kardex: 24 páginas por loja e ciclo (eram 12). Ajustes: 12 (eram 8). |
| OPs abertas logo depois de ligar | `/ordem-producao/abertas` e a sugestão de compra trocavam na hora para `aberta_omie`, que ainda está vazio numa loja recém-ligada: a lista ficava vazia. | Só usam `aberta_omie` depois da 1ª leitura completa (`espelho_sync_estado` `ops-abertas` com `lido_em`). Até lá, `concluida = false` (tela: `opsAbertasLidas`; SQL: `_sugestao_ops_abertas`, migration 250). |

### O buraco da loja 5 (14–16/10) e a cobertura "conferida"

**Achado (leitura em produção, 20/10):** `espelho_sync_estado` da loja 5 diz `coberto_ate = 16/10`, mas o kardex espelhado tem 37 linhas em 14/10, 99 em 15/10 e 600 em 16/10. Em 12/10 foram 6.048 linhas e em 13/10, 2.611. Pelo sync de OPs (independente do espelho), a loja concluiu 202, 302 e 741 OPs nesses três dias, todas alteradas no Omie no próprio dia. Os ajustes do PDV (`movimentos`, mesma lógica de janela) também vieram quase vazios (14/10: 0; 15/10: 120). Nos dias normais são 700 a 900.

**Causa provável (não dá para provar sem chamar o Omie):** `recente.coberto_ate` avança assim que a janela [ontem, hoje] é lida, mesmo que o Omie receba depois lançamentos com data desses dias. Exemplos: o reprocessamento da integração do PDV, que já tinha atrasado dias em 07–09/10 e 13/10; OPs e inventários concluídos depois; o recálculo do Omie. Só a revisão diária pegaria esses lançamentos, e ela:

- ficava sem vez, porque a recente de 30 min levava quase todo o ciclo;
- parou no meio de uma janela quando a flag foi desligada em 16/10 (cursor na página 40 de 12/09–11/10). A janela de 12–14/10 nunca foi relida.

Na volta, continuar daquela página 40 ainda pularia linhas: a paginação do Omie é por posição, e a revisão apaga o que "não viu" ao fechar a janela.

**Correção (`lib/estoque/espelho-frentes.ts`):**

- **`conferido_ate`:** último dia relido pelo menos 2 dias depois, de forma contígua (revisão ou retomada). Um estado antigo deriva esse dia da última revisão concluída: na loja 5, 13/10.
- **Retomada:** frente recente parada há mais de 12 h (pausa da guarda ou flag desligada) recomeça de `conferido_ate + 1` em todos os locais, numa janela só até hoje (no máximo 30 dias para trás; o resto fica com a revisão). Religar a loja 5 relê 14/10 → hoje antes de qualquer outra coisa.
- **Cursor parado:** janela sem avançar há mais de 12 h recomeça da página 1. A madrugada proibida tem 7 h, então isso não dispara à toa.
- **Relatórios:** `coberturaKardex` passa a trazer `lidoAte`, `conferidoAte` e `ligado`. Com o espelho **desligado**, o kardex vale só até o conferido (loja 5: até 13/10; para 14–16/10 o CMV volta a ser estimado). Com ele ligado, vale até o lido, com aviso para o trecho ainda não relido. `avisoCoberturaKardex` mostra o aviso no CMV (tela e Excel), na Produção por produto, na Movimentação "valor do movimento" (tela e Excel) e no saldo em data (`/estoque?data=`, que também avisa quando o kardex parou). Em `/movimentacoes`, a lista reconstruída é usada quando o kardex não chega ao fim do período (`escolherFonte` com `ate`/`fim`).

### Ajustes da revisão independente (2º commit)

- **C1 (crítico):** a janela recente fechava antes da hora enquanto a lista "ativos" nascia. O laço marcava o local depois da leitura, e a escolha do próximo local saía da lista parcial. Reproduzido com o estado real da loja 5 e 4 locais: só 2 eram lidos em 14–21/10 e, mesmo assim, o motor gravava `coberto_ate` 21/10 e `conferido` 19/10. Correção:
  - a lista de locais é **fixada no cursor na abertura da janela** (`cursor.locais`);
  - a 1ª janela de uma loja, a recuperação de atraso e a **retomada leem todos os locais**;
  - a retomada é uma janela só, até hoje, de no máximo 30 dias (o que for mais antigo fica com a revisão).
- **I1:** "intervalo de 30 min" e "trava" passaram a ser **neutros** e não zeram mais a contagem de erros da guarda. Antes, nas OPs abertas, o erro de `ConsultarOrdemProducao` nunca passava de 1 falha (~34 erros/dia no método do MISUSE). Agora a espera cresce até o teto.
- **I2:** o disjuntor (qualquer método da chave) é conferido **antes de cada chamada ao Omie** dentro dos laços de kardex, ajustes, OPs e fichas. Se algum método da chave estiver bloqueado, a frente para com "limite do Omie" e a guarda pausa a loja por 60 min.
- **M1:** página que erra 3 vezes seguidas é **pulada**. Ela fica registrada em `estado.puladas`, a janela não conta como conferida, a revisão não apaga nada nessa janela e os relatórios avisam "uma parte do kardex não pôde ser lida".
- **M2:** `coberto_ate` nunca volta para trás.
- **M3:** a lista de OPs abertas respeita o prazo do ciclo. Lista cortada = incompleta: não marca saída de OP e não grava `lido_em`.
- **M4:** em `/movimentacoes`, de madrugada (kardex até ontem, período até hoje), a tela continua no kardex com o aviso "hoje ainda não lido", em vez de trocar o período inteiro pela lista reconstruída. Juntar kardex até ontem com a reconstrução só de hoje exigiria unir duas fontes paginadas no servidor, e isso não é barato.
- **M5:** aviso duplicado no saldo em data removido.

## 2. Estimativa de chamadas ao Omie por loja

Volume de kardex por loja: não existe kardex das lojas 2, 3 e 6. A estimativa vem da proporção medida na loja 5 entre o kardex e os ajustes do PDV (5,84 linhas de kardex por ajuste PDV; o kardex PDV da loja 5 bate com os ajustes PDV: 13.800 × 13.816), conferida pela proporção por OP concluída. Período usado: 15/09–12/10, só leitura.

| | Loja 2 (Donana Vilas) | Loja 3 (Rio Vermelho) | Loja 6 (Brotas) | Loja 5 (referência) |
|---|---|---|---|---|
| Ajustes PDV/dia | 247 | 380 | 176 | 493 |
| OPs concluídas/dia (sync-ops) | 97 | 129 | 102 | 211 |
| **Kardex/dia estimado** (linhas) | ~1.300–1.450 | ~1.750–2.200 | ~1.000–1.400 | 2.880 (medido) |
| Locais ativos / com movimento (35 d) | 15 / ~7 | 13 / ~6 | 10 / ~5 | 11 / 3 |
| Produtos PA/PI (fichas) | 791 | 753 | 685 | 892 |
| OPs `concluida=false` hoje | 78 | 613 | 89 | 422 |

Chamadas de `ListarMovimentoEstoque` (100 por página, limite do Omie), usando a estimativa mais alta:

| Kardex | Loja 2 | Loja 3 | Loja 6 |
|---|---|---|---|
| Recente: chamadas por passada (ontem + hoje, locais com movimento) | ~27 | ~38 | ~24 |
| Recente por dia (17 passadas, 07–24 h) | ~460 | ~650 | ~410 |
| Revisão por dia (35 dias, todos os locais) | ~540 | ~800 | ~510 |
| **Regime (por dia)** | **~1.000** | **~1.450** | **~920** |
| **Backfill inicial (01/07 → hoje, ~110 dias)** | **~1.650** | **~2.470** | **~1.580** |
| Teto da loja (24 páginas × 102 ciclos/dia, 07–24 h) | 2.448 | 2.448 | 2.448 |

Demais frentes:

- **Ajustes** (`ListarAjusteEstoque`, 50 por página; 12 páginas por ciclo, teto de 1.224/dia):
  - regime: ~620/dia (loja 2), ~960/dia (loja 3), ~480/dia (loja 6);
  - backfill: ~570, ~900 e ~450 páginas;
  - hoje, no modo por id, são ~2–3 chamadas por ciclo (~250/dia).
- **OPs abertas:** `ListarOrdemProducao` (1–7 páginas) a cada 30 min, mais até 30 `ConsultarOrdemProducao` por passada. Fila inicial da loja 3: até ~600 OPs, ~10 h. Depois, poucas por dia.
- **Fichas:** `ConsultarEstrutura`, 20 por ciclo. Carga inicial de ~35–40 ciclos (~7 h de horário permitido) e depois ~110/dia (refaz a cada 7 dias).

**Pico por minuto:**

- Por loja e ciclo de 10 min, no máximo ~24 (kardex) + 12 (ajustes) + 20 (fichas) + ~37 (OPs) chamadas, todas em série e com pausa de 0,7–1,5 s.
- Por chave e método: ≤ 24/min (limite 240).
- No IP, com as 3 lojas: ~30/min a mais (limite 960).
- Simultâneas por chave e método: 1 do espelho. O `sync-ops` do ciclo principal pode estar no mesmo `ListarOrdemProducao` ao mesmo tempo (2 de 4).

**Erros:** no máximo 5 por frente e método por dia por loja. Qualquer bloqueio pausa a loja inteira por 60 min.

## 3. Duração esperada do backfill (uma loja ligada por vez)

Livre para backfill = teto − regime. A revisão cresce junto com o histórico, então os primeiros dias andam mais rápido.

| Loja | Kardex | Ajustes | Fichas | OPs abertas | Conferido chega a hoje − 2 |
|---|---|---|---|---|---|
| 6 | ~1 dia | < 1 dia | ~7 h | 1–3 h | 1ª revisão completa, ~1–2 dias |
| 2 | ~1–1,5 dia | ~1 dia | ~7 h | 1–3 h | ~1–2 dias |
| 3 | ~2–3 dias | ~3–4 dias | ~7 h | ~10 h | ~2–4 dias |

Só há leitura entre 07:00 e 24:00 (Bahia). As 3 lojas juntas dividem o orçamento de 200 s do kardex (~65 páginas por ciclo), e tudo leva uns 2–3 dias. Por segurança, ligue uma de cada vez.

**Ordem:** 6 (menor volume) → 2 → 3, com pelo menos 24 h de observação limpa entre uma e outra.

## 4. Antes de ligar a primeira loja (deploy)

1. Backup e OK do dono. Aplicar a migration 250 (numa transação; `lock_timeout` de 5 s, é só rodar de novo se desistir):

   ```bash
   ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -1" < supabase/migrations/250_espelho_varias_lojas.sql
   ```

   Conferir: `\d lojas` (coluna `omie_op_tempo_real`, todas false) e `\df _sugestao_ops_abertas` (1 overload).
2. Deploy do código (`deploy.sh`). O deploy já tira kardex, OPs abertas e fichas do `sync-cron.sh`. Enquanto o passo 3 não for feito, o espelho não roda em loja nenhuma, o que é seguro: hoje todas estão com a flag desligada.
3. Crontab do servidor (`crontab -e`), linha nova:

   ```
   5-59/10 * * * * /usr/bin/flock -n /tmp/sync-espelho.lock /bin/bash /opt/ntb-estoque/scripts/sync-espelho.sh
   ```

   Depois de 10 min, conferir `/opt/ntb-estoque/sync-espelho.log`: 3 linhas `-> 200` por ciclo, com `"total":0`.
4. `desktop/scripts/gerar-schema.sh` + versão nova do desktop (coluna nova em `lojas`).
5. Conferir que a loja 5 continua desligada: `select id, espelho_completo, omie_op_tempo_real from lojas where id in (2,3,4,5,6,7) order by id;`. Deve dar tudo `f`.

> **Mudança esperada na loja 5 logo depois do deploy (intencional, não é bug):** com o espelho desligado, o kardex da loja 5 passa a valer só até o último dia conferido, **13/10/2026** (antes: até 16/10).
>
> - **CMV** (`/relatorio-cmv`) e **Produção por produto** (`/relatorio-ops`): com data final entre 14/10 e 16/10, deixam de usar o kardex e passam para **"estimado"** (CMV) ou **OPs sincronizadas** (Produção). Aparece um aviso explicando que 14–16/10 foram lidos incompletos.
> - **Movimentação "pelo valor do movimento"**: fica **cortada em 13/10**, com aviso.
> - **Saldo em data** depois de 13/10: aparece com aviso.
>
> Antes, esses relatórios mostravam números muito baixos para 14–16/10 sem avisar (o espelho tinha ~1% dos movimentos desses dias). Volta ao normal quando a loja 5 for religada e a releitura passar (seção 8).

## 5. Ligar uma loja (exemplo: loja 6)

Fora do horário de pico (de manhã, depois das 07:00 da Bahia, antes do almoço):

```sql
begin;
update lojas set espelho_completo = true
 where id = 6 and is_test = false and id not in (4, 5, 7) and modo_estoque = 'omie'
returning id, nome, espelho_completo, omie_op_tempo_real;
commit;
```

Esperado: 1 linha, `espelho_completo = t`, `omie_op_tempo_real = f`. **Não** ligar `omie_op_tempo_real` junto.

O ciclo seguinte do `sync-espelho.sh` (minuto 5 de cada 10) começa pelas OPs abertas. O `sync-ajustes` passa para o modo por janela no ciclo seguinte do `sync-cron.sh`.

## 6. O que acompanhar

Primeira hora: a cada ciclo. Depois, 2x por dia até o fim do backfill. Todas as consultas são só leitura (`begin read only;`).

```sql
-- Progresso e erro de cada frente (kardex, ajustes, ops-abertas, fichas) e da guarda (guarda-loja, guarda-<frente>)
select frente, estado->'recente'->>'coberto_ate' lido_ate, estado->>'conferido_ate' conferido_ate,
       estado->'backfill'->>'coberto_desde' desde, estado->'backfill'->>'concluido' backfill_ok,
       estado->'revisao'->>'concluido_em' revisao_em, left(ultimo_erro, 160) erro, atualizado_em
  from espelho_sync_estado where loja_id = 6 order by frente;

-- Bloqueios reais do Omie na loja (qualquer um = parar e olhar; num método de venda = desligar na hora)
select created_at, model, left(error_message, 200) from integration_attempts
 where loja_id = 6 and model like '[BLOQUEIO OMIE]%' and created_at > now() - interval '6 hours' order by 1 desc;

-- Erros da integração de vendas da loja, comparar com o dia anterior à ativação
select date_trunc('hour', created_at) h, model, count(*) from integration_attempts
 where loja_id = 6 and error and created_at > now() - interval '24 hours' group by 1, 2 order by 1 desc, 3 desc;

-- O kardex tem o volume esperado? (kardex/dia ≈ 5–14 × OPs concluídas/dia; dia com quase nada = olhar)
select k.d, k.linhas, o.ops from
  (select data_mov d, count(*) linhas from kardex_omie where loja_id = 6 and data_mov >= current_date - 10 group by 1) k
  full join (select dt_conclusao_real d, count(*) ops from ordens_producao where loja_id = 6 and concluida and dt_conclusao_real >= current_date - 10 group by 1) o using (d)
 order by 1;
```

Logs no servidor:

- `tail -n 30 /opt/ntb-estoque/sync-espelho.log`: resumo por loja de cada rota (páginas, `parouPor`, `pulado`).
- `grep -E 'sync-ajustes|retry-integracao-vendas' /opt/ntb-estoque/sync-cron.log | tail -n 20`: devem continuar `-> 200`.
- Duração do ciclo principal: o 1º e o último horário de cada bloco no `sync-cron.log` não podem passar de ~9 min (hoje ~7).

**Sinais para parar e desligar (rollback):**

- qualquer `[BLOQUEIO OMIE]` da loja num método de venda (`IncluirOrdemProducao`, `ConcluirOrdemProducao`, `ImportarNFCe`, `IncluirAjusteEstoque`);
- `guarda-loja` com pausa mais de uma vez no mesmo dia;
- aumento de erros da integração de vendas da loja;
- ciclo principal passando de 10 min (linha de um ciclo faltando no `sync-cron.log`).

Um `guarda-<frente>` com 1–2 falhas isoladas é esperado (instabilidade do Omie). Olhar o `ultimo_erro`.

**Quando ligar a próxima loja:** backfill do kardex com `concluido = true` (ou quase) e 24 h sem `[BLOQUEIO OMIE]` e sem pausa de loja.

## 7. Desligar (rollback)

```sql
begin;
update lojas set espelho_completo = false where id = 6 returning id, espelho_completo;
commit;
```

- Os crons param no ciclo seguinte. Um ciclo em andamento termina em no máximo 200 s.
- O `sync-ajustes` volta ao modo por id.
- As telas voltam ao modo sem espelho: movimentações reconstruídas, CMV estimado, OPs abertas por `concluida = false`. O kardex já lido **fica** e continua valendo até o último dia conferido, com aviso nos relatórios. Não apagar nada.
- Emergência (todas as lojas de uma vez): comentar a linha do `sync-espelho.sh` no crontab. O `sync-ajustes` das lojas com a flag continua até a flag ser desligada.
- Religar depois é seguro: a retomada relê desde o último dia conferido e as janelas paradas recomeçam da página 1.

## 8. Loja 5, quando a faxina terminar (não agora)

Mesmo SQL da seção 5 com `id = 5` (tirar o `5` do `not in`). Na volta:

- a recente relê de 14/10 até hoje: ~7–10 dias × ~29 páginas, umas 3 h de ciclos;
- a revisão parada em 12/09–11/10 recomeça da página 1;
- o conferido passa de 13/10 para hoje − 2 depois da 1ª passada.

Decidir à parte se `omie_op_tempo_real` volta para a loja 5 (era o comportamento antes de 16/10).

## 9. Fora do escopo, achado no caminho

- `omie_op_tempo_real = false` em todas as lojas desde 16/10 (antes era a flag do espelho): o webhook não consulta OP e o cron de OPs fantasmas não roda em nenhuma loja. Religar loja a loja é decisão do dono.
- `retry-ajustes-movimentos` estoura os 240 s do curl quase todo ciclo (`000ERR`) e o `retry-ajustes-inventario` responde 502 às vezes (log de 20/10).
- Loja 7: chave inválida gerando `[BLOQUEIO OMIE]` em 4 métodos de leitura dos crons de sempre.
- A revisão apaga, ao fechar a janela, linhas "não vistas". Se o Omie excluir movimentos de uma janela enquanto ela está sendo lida, as páginas andam para trás e uma linha válida pode ser apagada até a revisão do dia seguinte. É anterior ao D5. O cursor parado agora recomeça da página 1, mas uma janela longa ainda corre esse risco.
- Não foi possível provar, sem chamar o Omie, se "Não existem registros" conta como erro para o bloqueio. A loja 5 leu 3 dias com 8–10 locais vazios por janela sem bloqueio registrado. A recente agora só lê locais com movimento, o que reduz isso.
