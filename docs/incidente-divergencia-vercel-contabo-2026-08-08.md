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
100% `INSERT`, 0% `UPDATE`/`DELETE`, exatamente nas faixas de id
alegadas, nas duas tasks de escrita.

### `inventarios` + `inventario_items`

26 inventários (ids novos 228–253) + 744 itens filhos (ids novos
7260–8003) inseridos no Contabo, com a FK de cada item remapeada pro novo
id do seu inventário pai. Validação campo-a-campo dos 26+744 registros
contra a origem: 0 diferenças. Soma de `quan`/`valor` por produto (530
produtos distintos) e totais gerais: 0 mismatches. Zero órfãos de FK,
zero duplicatas (inclusive checado por `id_ajuste` da Omie duplicado, que
seria a assinatura de um ajuste físico gravado 2×). Sequences avançadas
corretamente ao final, sem risco de colisão com escrita orgânica futura.

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

**(c) Follow-ups de menor prioridade** (achados laterais (b)/(c)/(d)
acima): atualizar metadado de `ordens_producao` pro sync trazer de volta
(ou aceitar a perda como limitação documentada); rotacionar/proteger a
senha do Postgres standby fora do `crontab` em texto plano; decidir se
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
