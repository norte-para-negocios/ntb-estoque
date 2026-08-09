# Incidente: divergência Vercel/Supabase-cloud × Contabo — 2026-08-08

**Status:** reconciliado e verificado. **Gatilho:** usuário reportou (com
prints e áudios de WhatsApp) que o mesmo inventário aparecia diferente em
`app-estoque.norteparanegocios.com.br` (Contabo, produção oficial) e em
`ntb-estoque.vercel.app` (Vercel/Supabase cloud, deveria estar
desativado). Investigação, dump de segurança, cruzamento contra a Omie e
reconciliação de dado feitos nesta sessão, via um plano de 5 tasks
(`docs/superpowers/plans/2026-08-08-reconciliacao-vercel-contabo.md`).

## Causa raiz

O Contabo nasceu como réplica lógica do Supabase cloud (mesmo banco de
`auth`). Quando o Contabo virou o sistema "principal" em 31/07/2026, o
Vercel/Supabase cloud nunca foi desativado — e como a mesma senha
funciona nos dois sistemas sem erro nenhum, **4 usuários com conta
anterior a 31/07** (Andre, Carlos Marinho, Renato Pinho, Ramon)
continuaram logando em ambos, alternadamente, gravando dado real e
independente nos dois bancos sem perceber, desde 31/07/2026 ~16:39 UTC
(fork de `inventarios`) até a investigação desta sessão (08/08/2026).

O estoque físico em si nunca ficou incorreto — os ajustes de estoque
foram lançados corretamente na Omie nos dois sistemas (ver seção de
verificação abaixo). O problema era o **registro** desses eventos ficar
espalhado em dois bancos que não se falam entre si, cada um mostrando uma
fatia incompleta da realidade pro usuário.

## Escopo confirmado (com evidência real)

| Tabela | Fork | Só cloud | Colide com Contabo (conteúdo diferente) | Total reconciliado |
|---|---|---:|---:|---:|
| `inventarios` | id=202 (31/07 16:39 UTC) | 6 | 20 | **26** |
| `inventario_items` (filhos dos 26 acima) | — | — | — | **744** |
| `transferencias` | id=557 (01/08 18:43 UTC) | — | 59 | **59** |
| `movimentos` (filhos das 59 transferências acima) | — | — | — | **231** |

Todos os 26 `inventarios` do cloud precisaram ser inseridos no Contabo —
6 não tinham id equivalente lá, os outros 20 colidiam em id com um
inventário **diferente** (mesma sequence, dois bancos incrementando
independente desde o fork; nunca o mesmo evento duplicado). Mesmo padrão
em `transferencias`: as 59 do cloud colidiam em id com 59 transferências
diferentes já existentes no Contabo (que também tem 32 ids exclusivos
seus, fora do escopo — já eram nativas de lá).

Fora de escopo deste incidente (checado na investigação inicial, sem
divergência relevante ou não é escrita de usuário): `convites`,
`produto_substituicoes`, `previsao_venda` (cron/job automático),
`impressao_etiquetas` (baixo risco, reimprimível), `ordens_producao`
(chave real é da Omie, não colide por id — a sync "cura" a maioria
sozinha).

## Verificação contra a Omie (fonte de verdade externa)

Antes de reconciliar qualquer coisa, todo o escopo divergente foi
cruzado contra a Omie via `ListarAjusteEstoque` (só leitura, nunca
escrita), pra confirmar que os eventos realmente aconteceram e bater a
quantidade.

**Inventários (930 itens elegíveis, `id_ajuste` não-nulo e não-zero, nos
46 inventários divergentes — 26 só-cloud + 20 colidentes):**
**909/930 (97,7%) confirmados reais**, com `id_ajuste` e quantidade
batendo exatamente o que está gravado localmente.

**Transferências (231 movimentos filhos das 59 transferências
divergentes):** **231/231 (100%) confirmados reais**, `id_ajuste` e
quantidade batendo exato — cada movimento de transferência lança um
`IncluirAjusteEstoque` tipo `TRF` (`lib/actions/transferencia.ts:323`),
mesmo padrão do ajuste de inventário. Nenhum "ajuste fantasma" encontrado
nesta tabela.

### Achado separado: 21 "ajustes fantasma" em `inventario_items`

Pendência de investigação futura, **não bloqueou a reconciliação** (o
registro local — payload de sucesso genuíno, `id_ajuste`/`id_movest`
reais — é evidência suficiente de que o ajuste foi tentado e aceito pela
Omie no momento; a reconciliação banco-a-banco não depende do estado
atual da Omie).

21 itens marcados `Concluido` localmente, com resposta de sucesso
completa registrada no momento da criação (`codigo_status: "0"`,
`id_movest`/`id_ajuste` preenchidos), mas que **hoje não existem mais**
na Omie (`ListarAjusteEstoque` devolve 0 registros):

- **20 concentrados no inventário 222** (loja 4, nativo do Contabo,
  criado 08/08/2026 entre 12:12–13:08 UTC) — intercalados no tempo com
  itens confirmados (não é um bloco contíguo, descarta "um lote inteiro
  falhou").
- **1 isolado no inventário 210** (cloud, loja 6, criado 5 dias antes da
  verificação).

Nenhum mismatch de quantidade foi encontrado nos 21 casos — é ausência
total do registro na Omie, não um valor errado. Hipóteses não
confirmadas: exclusão manual do ajuste na UI da Omie depois da criação;
processo externo de limpeza/estorno; rollback assíncrono por regra de
negócio da Omie (ex. período fechado). Evidência completa (ids,
quantidades, timestamps, respostas originais) no relatório da Task 2
(`.superpowers/sdd/2026-08-08-reconciliacao-vercel-contabo/task-2-report.md`,
fora do controle de versão).

## O que foi reconciliado e como

**Regra de ouro seguida em toda a reconciliação: nunca `UPDATE`/`DELETE`
em linha já existente no Contabo — só `INSERT` de linha nova, com id
remapeado acima do maior id já existente, preservando
conteúdo/timestamp/usuário original.** Verificado de forma independente
via o log de auditoria `outbox` (trigger `outbox_trigger`, ativo nas 4
tabelas envolvidas, sem consumidor — ver achados laterais): confirmou
100% `INSERT`, 0% `UPDATE`/`DELETE` **da própria reconciliação**,
exatamente nas faixas de id alegadas, nas duas tasks de escrita (ver nota
sobre 2 `DELETE`s legítimos e sem relação com a reconciliação, logo
abaixo).

### `inventarios` + `inventario_items`

26 inventários (ids novos 228–253) + 744 itens filhos (ids novos
7260–8003) inseridos no Contabo, com a FK de cada item remapeada pro novo
id do seu inventário pai. Validação campo-a-campo dos 26+744 registros
contra a origem: 0 diferenças. Soma de `quan`/`valor` por produto (530
produtos distintos) e totais gerais: 0 mismatches. Zero órfãos de FK,
zero duplicatas (inclusive checado por `id_ajuste` da Omie duplicado, que
seria a assinatura de um ajuste físico gravado 2×). Sequences avançadas
corretamente ao final, sem risco de colisão com escrita orgânica futura.

**Nota sobre 2 `DELETE`s legítimos no `outbox`, sem relação com a
reconciliação:** a auditoria bruta do `outbox` para `inventario_items` no
período tem exatamente 2 linhas `DELETE` dentro da faixa de id
reconciliada (ids 7260 e 7261) — não é uma violação da regra de ouro
acima, e um auditor futuro rodando a mesma query do `outbox` não deve
interpretar como tal. São 2 linhas criadas organicamente por um usuário
real às 17:55:54–17:55:56 UTC de 08/08 (inventário #224, sem
`id_ajuste`, nunca chegaram a ser lançadas na Omie) e apagadas pelo
próprio usuário 15–19 segundos depois (17:56:10–17:56:14 UTC) — 8 horas
antes da reconciliação rodar (01:52 UTC de 09/08). Como consequência, o
`MAX(id)` calculado pela reconciliação depois dessas exclusões reaproveitou
os ids 7260 e 7261 (que antes pertenciam às 2 linhas apagadas) para 2 dos
744 itens novos reconciliados. **Risco teórico registrado, não
materializado aqui:** o método de verificação da Task 2 cruza contra a
Omie via `cod_int_ajuste = "ITEM<id>"` — reuso de id é um vetor teórico de
falso-match nesse método. Não aconteceu neste caso (os ids reaproveitados
nunca tiveram ajuste na Omie), mas vale como cuidado para reconciliações
futuras: preferir remapear para ids fora de qualquer faixa já
usada/liberada por exclusão, não só acima do `MAX` atual.

### `transferencias` + `movimentos`

59 transferências (ids novos 649–707) + 231 movimentos filhos (ids novos
1056028–1056258) inseridos no Contabo, mesma disciplina de remapeamento
de FK. Mesma validação campo-a-campo (0 diferenças em 59+231 registros),
soma de `quan` por produto (109 produtos distintos) e totais gerais (0
mismatches). As 91 transferências pré-existentes do Contabo na mesma
faixa de id (558–648) reconferidas campo-a-campo contra o estado
anterior: 91/91 idênticas, nenhuma tocada.

**Nota técnica para rastreio futuro:** o `cod_int_ajuste` gravado na Omie
para esses 231 movimentos ainda referencia o id **antigo** do cloud
(`MOV-<id-cloud>`), não o novo id do Contabo — a reconciliação preservou o
payload original, não regravou o vínculo. Isso não quebra nada hoje (o
ajuste já está lançado e correto), mas qualquer rastreio futuro
Contabo→Omie que dependa desse campo para achar o `movimentos.id`
associado vai falhar silenciosamente nessas 231 linhas específicas.

### Premissa de duplicata refutada (achado importante da Task 4)

A investigação inicial (que gerou o plano) levantou a hipótese de que
Carlos Marinho e Renato Pinho tinham gravado o **mesmo evento físico** de
transferência nos dois bancos (o mesmo clique gerando duas linhas). A
Task 4 investigou isso a fundo — 6 estratégias de matching diferentes
(item exato, overlap fraco, matching só de cabeçalho, verificação
nominal por usuário) contra as 612 transferências pré-existentes
inteiras do Contabo, não só as 91 na janela pós-fork — e **refutou a
premissa com evidência forte: 0 duplicatas reais**.

- **Renato Pinho:** matematicamente impossível ter duplicata nesta
  tabela — parou de usar o cloud 6 dias antes do fork de `transferencias`
  (última transferência dele no cloud é de 26/07, o fork é de 01/08).
- **Carlos Marinho:** tem transferências ativas nos dois bancos no mesmo
  período, mas sem sobreposição real de produto/quantidade/local/data —
  são eventos diferentes, não o mesmo lançamento duplicado.

Resultado prático: as 59 transferências do cloud entraram **todas** no
Contabo, sem nenhuma descartada por duplicata (lista de pares
duplicados: vazia). A menção original a "Carlos/Renato duplicando
evento" provavelmente se referia a eles serem usuários ativos nos dois
sistemas em geral (verdade, principalmente em `inventarios`), não a um
evento físico específico duplicado em `transferencias`.

## Verificação final (Task 5)

### Conferência de contagens (Contabo, ao vivo)

```
inventarios:       209 total (183 pré-existentes + 26 reconciliados)
inventario_items:  7167 total (6423 pré-existentes + 744 reconciliados)
transferencias:    671 total (612 pré-existentes + 59 reconciliados)
movimentos (filhos de transferencia_id > 648): 231
```

Bate exatamente com o que as Tasks 3/4 reportaram — sem drift desde a
reconciliação. Sequences (`inventarios_id_seq`=253,
`inventario_items_id_seq`=8003, `transferencias_id_seq`=707,
`movimentos_id_seq`=1056258, todas `is_called=true`) também batem exato
com o valor definido ao final das Tasks 3/4, sem escrita orgânica
colidindo desde então.

### Checagem na UI real (conta QA, produção)

Verificado com Playwright standalone (perfil isolado, login real como
`claude.qa@ntb-estoque.dev`) contra
`https://app-estoque.norteparanegocios.com.br`, abrindo Inventários e
Transferências para as 3 lojas mais envolvidas:

| Loja | Registro | Na UI | Confere com o banco |
|---|---|---|---|
| 2 (DONANA VILAS DO ATLANTICO) | Inventário #229 | BAR, 31/07/2026, Carlos Marinho, 10/10 | 10/10 itens `Concluido` no banco |
| 2 | Inventário #249 | COZINHA, 06/08/2026, Carlos Marinho, 22/22 | 22/22 itens `Concluido` no banco |
| 2 | Transferência #664 | DEPOSITO→BAR, 05/08/2026, 7/7 | 7/7 movimentos `Concluido` no banco |
| 2 | Transferência #669 | DEPOSITO→COZINHA, 06/08/2026, 6/6 | 6/6 movimentos `Concluido` no banco |
| 4 (O SERTAO VAI VIRAR MAR) | Inventário #228 | ADEGA, 30/07/2026, Ramon, Em contagem | bate (inventário ainda aberto) |
| 4 | Inventário #244 | COZINHA, 02/08/2026, Renato Pinho, Em contagem | bate |
| 4 | Transferências | nenhuma reconciliada aqui — Renato não tem transferência cloud pós-fork | confirma o achado da Task 4 |
| 6 (DONANA BROTAS) | Inventário #253 | BAR, 07/08/2026, Andre Do, 5/5 | 5/5 itens `Concluido` no banco |
| 6 | Transferência #684 | Local Padrão→SALAO, 07/08/2026, Andre Do, 3/3 | 3/3 movimentos `Concluido` no banco |

Todos os registros reconciliados aparecem corretamente (data, local,
responsável, contagem de itens integrados) e **nenhum apareceu
duplicado** em nenhuma das listas — cada id buscado teve exatamente uma
ocorrência na tela. As tabelas de Inventários/Transferências desta app
usam listas com carregamento amplo (não paginação tradicional visível na
primeira dobra) — a verificação usou o conteúdo real do DOM renderizado,
não só o que aparecia na primeira captura de tela, para não gerar falso
negativo.

## Itens do spec original conscientemente fora do escopo desta reconciliação

O spec original (`docs/superpowers/specs/2026-08-08-reconciliacao-vercel-contabo-design.md`)
levantou 3 itens divergentes que as 5 tasks deste plano deliberadamente
**não** reconciliaram. Ficam documentados aqui, com investigação real onde
fazia sentido, pra não se perder:

### 1. `movimentos` sem sincronização — cron `sync-ajustes` nunca foi ligado no Contabo (~8.048 linhas, crescendo)

**Correção sobre a versão anterior deste documento:** a versão anterior
descrevia isto como "88 linhas" com causa no cursor incremental do cron
`sync-ajustes` já ter avançado além do intervalo. Essa descrição estava
errada nos dois eixos — causa raiz e tamanho — e foi corrigida nesta
revisão, com evidência coletada ao vivo (2026-08-09).

**Causa raiz real:** `sync-ajustes` (`/api/cron/sync-ajustes`,
`lib/omie/sync-ajustes.ts`) só está agendado em `vercel.json`
(`30 4 * * *`). O crontab real de produção no Contabo
(`/opt/ntb-estoque/scripts/sync-cron.sh`) **nunca chama essa rota** —
confirmado lendo o script ao vivo no servidor: ele dispara `sync-nfs`,
`sync-ops`, `retry-op-conclusao`, `sync-posicao`, `sync-reconciliar-op`,
`sync-locais`, `sync-produtos`, `sync-previsao`, `sync-movimentos`,
`sync-faturamento`, `sync-preco-movimentacao`,
`snapshot-margem-diario` e `snapshot-op-planejada` — `sync-ajustes` não
está na lista. Não é sobre o cursor nunca "olhar pra trás" — é o cron
inteiro nunca ter rodado no Contabo, nem uma vez.

`/api/cron/sync-movimentos`, que esse sim roda no Contabo (bloco 2 do
`sync-cron.sh`), grava em `movimentos_historico` — uma tabela agregada
diferente (entradas/saídas por produto/dia, mês-a-mês) — e não substitui
`sync-ajustes` de nenhuma forma.

**Resultado:** desde **2026-08-02 05:20 UTC** (~7 dias e contando), a
tabela `movimentos` no Contabo não recebe nenhum registro novo vindo de
ajuste da Omie via `id_ajuste`. Só o Supabase cloud continua recebendo
esses registros, porque o agendamento do Vercel segue ativo lá.

**Tamanho real, reconfirmado nesta correção (SQL direto, 2026-08-09):**
comparando `movimentos` com `id_ajuste` não nulo, sem `transferencia_id`
(exclui os `TRF` nativos de transferência local, que entram por outro
caminho, `lib/actions/transferencia.ts`), criados após 2026-08-02 05:20
UTC:

| Loja | Linhas só no cloud (Contabo = 0) |
|---|---:|
| 2 | 1.686 |
| 3 | 3.188 |
| 5 | 2.446 |
| 6 | 728 |
| **Total** | **8.048** |

Por tipo: 7.803 `SAI` (venda, majoritário), 143 `TRF` (tipo de ajuste da
Omie, não confundir com a tabela `transferencias` local), 88 `SLD`
(exatamente a fatia que a versão anterior deste documento já citava — mas
como "as 88" no total, quando eram só a fatia SLD) e 14 `ENT`; nenhum
`TPQ` neste corte. **Este número cresce a cada hora que passa** — quem for
agir sobre isso deve reconfirmar a contagem antes, não reusar os valores
acima.

**Decisão para o futuro (não executada aqui):** como o estoque físico
nesses casos já foi confirmado correto na Omie (parte dos 909/930 da Task
2), o risco de deixar como está é só de **registro**/auditoria interna
incompleta, mesma natureza dos outros achados já reconciliados — não afeta
saldo real. Duas ações ficam em aberto pra decisão do usuário, e não são
alternativas — as duas são necessárias: (a) adicionar `/api/cron/sync-ajustes`
ao `sync-cron.sh` do Contabo, pra parar de crescer; (b) rodar um backfill
pontual pra fechar o gap já acumulado (mesmo padrão de `INSERT` usado nas
Tasks 3/4, remapeando id) — o cron sozinho, mesmo ligado, não volta atrás
pra preencher o que já ficou pra trás do cursor. Nenhuma das duas foi
feita nesta correção — é achado de investigação, fora do escopo autorizado
(só documentação).

### 2. `audit_log` — 233 colisões de id entre os dois bancos

Tabela de log de auditoria (histórico de ações do sistema), não dado
operacional/transacional. Conscientemente deixada fora da reconciliação —
log de auditoria não precisa do mesmo rigor de reconciliação campo-a-campo
que `inventarios`/`transferencias`, e um id duplicado ali não afeta saldo,
estoque nem nenhuma tela do app. Confirmado que a tabela tem ids
contíguos sem buraco em ambos os bancos (cloud: 1–1189; Contabo: 1–1278),
consistente com uma faixa de sobreposição na casa das centenas — sem
necessidade de ação.

### 3. `profiles`/`loja_user` — 1 linha só no Contabo (Edson dos Santos Dias, loja 5)

Direção **oposta** aos outros achados deste incidente: Edson dos Santos
Dias (`santosedson260201@gmail.com`, loja 5) existe em `profiles`/
`loja_user` **só no Contabo**, confirmado nesta correção (`select ... from
profiles where name ilike '%edson%'` — 0 linhas no cloud, 1 no Contabo).
Ele nunca teve conta no Supabase cloud — não é um usuário "perdido" nem
"duplicado", ele sempre esteve no sistema certo (o de produção) desde o
início. **Benigno, sem ação necessária.**

## Achados laterais (fora de escopo deste incidente)

Encontrados durante a investigação/reconciliação, sem relação direta com
a divergência Vercel×Contabo, registrados aqui só para não se perder:

1. **9 itens de inventário (histórico, pré-existente)** nunca geraram
   ajuste real na Omie por falta de CMC válido — bug pré-existente, não
   causado por este incidente.
2. **Metadado local de `ordens_producao`** (`concluida_por`,
   `observacao`) não volta do sync da Omie — risco baixo.
3. **Achado de segurança incidental, não relacionado a este incidente** —
   detalhes reportados diretamente ao dono do projeto fora deste
   documento público, não descritos aqui de propósito.
4. **Tabela `outbox` (32,5M+ linhas antes desta reconciliação, cresceu
   mais ~1.000 com os INSERTs desta sessão) não tem nenhum consumidor
   ativo** — resquício provável do antigo mecanismo de failover já
   removido desta sessão. O trigger `outbox_trigger` continua ativo nas
   tabelas envolvidas, gravando cópia de auditoria de cada escrita sem
   nenhum efeito colateral, mas crescendo sem limite.

## Próximos passos

**(a) Investigar a causa raiz dos 21 ajustes fantasma** (seção acima) —
por que um ajuste que a Omie confirmou como criado no momento (payload de
sucesso completo) deixou de existir depois. Pista de código pro
follow-up: `lib/actions/inventario.ts:600-639`
(`editQuantidadeInventarioItem`) zera `id_ajuste` sem relançar
automaticamente — candidato a mecanismo, não confirmado.

**(b) Aposentar o Vercel/Supabase cloud de vez — FASE SEPARADA, NÃO
incluída neste plano.** Precisa de confirmação explícita do usuário antes
de executar. Envolve desativar login (ou redirecionar o domínio pro
Contabo) e pausar o projeto Supabase cloud. Só deve ser feito depois de
todos os envolvidos confirmarem que pararam de usar o Vercel/cloud — a
causa raiz deste incidente (login funcionando nos dois sistemas sem
aviso) continua existindo até essa fase rodar.

**⚠️ BLOQUEIO — não fazer isso antes de resolver o item 1 acima
(`movimentos` sem sincronização).** Hoje o Supabase cloud é a **única**
fonte que ainda sincroniza `movimentos` vindos de ajuste da Omie — o
cron `sync-ajustes` nunca foi ligado no Contabo. Aposentar o
Vercel/Supabase cloud sem antes (1) adicionar `sync-ajustes` ao
`sync-cron.sh` do Contabo e (2) rodar o backfill que fecha o gap atual
mataria essa sincronização de vez, não só atrasaria — ninguém mais
escreveria em `movimentos` a partir de ajuste da Omie depois disso.

**(c) Follow-ups de menor prioridade** (achados laterais 2, 3 e 4 acima):
atualizar metadado de `ordens_producao` pro sync trazer de volta (ou
aceitar a perda como limitação documentada); resolver o achado de
segurança já reportado diretamente ao dono do projeto (achado lateral 3,
detalhes fora deste documento público de propósito); decidir se
`outbox_trigger`/tabela `outbox` devem ser aposentados (mecanismo de
failover que os originou já foi removido) ou mantidos como log de
auditoria intencional com uma política de retenção.

## Referências

- Plano de execução:
  `docs/superpowers/plans/2026-08-08-reconciliacao-vercel-contabo.md`
- Spec/design:
  `docs/superpowers/specs/2026-08-08-reconciliacao-vercel-contabo-design.md`
- Dump de segurança bruto (antes de qualquer escrita):
  `docs/incidente-divergencia-vercel-contabo-2026-08-08-dump-bruto.json`
