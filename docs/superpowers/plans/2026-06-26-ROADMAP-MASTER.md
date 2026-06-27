# NTB Estoque -- ROADMAP MASTER (documento vivo)

> **LEIA ISTO PRIMEIRO ao retomar o projeto.** Este e o documento mestre que consolida TODA a visao, contexto e plano. Se a conversa foi compactada, este arquivo + as memorias (MEMORY.md) sao a fonte de verdade. Atualize o status das tasks aqui conforme forem feitas.

**Ultima atualizacao:** 2026-06-26
**Modelo atual de trabalho:** migrando para Sonnet (Opus so para planejamento pesado)

---

## A VISAO (o que estamos construindo de verdade)

O NTB Estoque hoje e um **espelho de leitura do Omie ERP** (puxa estoque, NFs, posicoes). O objetivo final em 3 camadas:

1. **Copiar TODO o Omie** dentro do nosso sistema (faturamento, financeiro, CRM, relatorios, pedidos, producao). Hoje so temos estoque/NF.
2. **Desvincular do Omie** quando os certificados digitais chegarem: emitir NF-e/NFC-e direto no SEFAZ, sem intermediario. O Omie vira opcional, depois descartavel.
3. **Unificar com o Norte Vendas** (cardapio digital): cliente faz pedido no cardapio -> cozinha ve na tela (KDS) -> gera nota fiscal -> da baixa automatica no estoque do NTB via ficha tecnica (BOM). Sistema unico de ponta a ponta.

**Restricao fundadora:** tudo tem que rodar no **free tier** (Supabase gratis). Sem custo. O usuario confirmou: trabalham SO com texto e numeros, nenhum arquivo/imagem/PDF salvo no banco. Entao da pra otimizar e caber.

---

## REGRAS DE OURO (nunca violar)

1. **Bugs:** pode corrigir direto, afeta todo mundo, sem pedir permissao de area.
2. **Coisas novas (copia do Omie):** vao TODAS para a area **VTBstock Beta**, acessivel SOMENTE por **super admin total** (nao admin de loja). Botao separado no menu.
3. **Excecao publica:** a melhoria do **Resumo do Dia / auditoria de inventario** (erros visiveis + nao contados + periodicidade) vai pra todo mundo, num link que todos acessam. Isso o usuario liberou explicitamente.
4. **Free tier sempre.** Nunca propor solucao paga sem aprovacao. Banco gratis e inegociavel por enquanto.
5. **Nada destrutivo no banco sem ordem explicita.** O usuario deixou claro: "nao e pra fazer nada com o banco, so o plano" -- ate ele mandar executar.
6. **Sem travessao (--)** em texto visivel ao usuario.
7. **Testes ao vivo NUNCA na loja 4** (O SERTAO VAI VIRAR MAR, em producao). Usar loja 3 (Donana Rio Vermelho) ou 7 (VINHAS).
8. **Assinar trabalhos como "Joaquim Salles".**
9. **Migration:** `node scripts/aplicar-migration.mjs <arquivo.sql>` (passar SO o nome, sem path). Conexao: pooler aws-1-sa-east-1. Para queries: `node scripts/db.mjs "<SQL>"`.
10. **Next.js 16:** middleware e `proxy.ts`, nao `middleware.ts`. Ler `node_modules/next/dist/docs/` antes de mexer em coisa de framework.

---

## ACHADO CRITICO: BANCO -- SITUACAO ATUAL

**Medicao inicial (dashboard Supabase 2026-06-26):** 733 MB -- ja passou do limite free (500 MB).

**Diagnostico read-only 2026-06-26 (pg_database_size):** banco em **241 MB**. As tabelas publicas totalizam 229 MB.

A diferenca (733 vs 241 MB) e porque o dashboard Supabase inclui WAL, arquivos do pg_wal e overhead do sistema -- o PostgreSQL em si (pg_database_size) e 241 MB. Esse e o numero que realmente conta para o uso de disco.

**Maiores tabelas (pg_total_relation_size):**
- `ordens_producao`: 92 MB (279K linhas, full_object NULL em todas -- dado real)
- `movimentos_historico`: 62 MB (437K linhas, sem full_object)
- `nota_fiscal_items`: 44 MB (56K linhas; 17.7K tem full_object = 24 MB)
- `posicao_estoques`: 12 MB (40K linhas)
- demais tabelas: < 4 MB cada

**Conclusao:** banco esta em 241 MB, ABAIXO do limite 500 MB. Prioridade passou de critica para monitorar. Adicionar modulos novos e ok, mas monitorar crescimento (ordens_producao + movimentos_historico crescem com o tempo).

---

## BLOCO 0 -- BANCO DE DADOS (PRIORIDADE MAXIMA)

### 0.1 Diagnostico (so leitura, NAO executar ate o usuario mandar)

| # | O que medir | Status |
|---|---|---|
| 0.1.0 | Tamanho total do banco | ✅ 733 MB (acima do limite) |
| 0.1.1 | `pg_total_relation_size` por tabela | Pendente |
| 0.1.2 | Peso do `full_object` JSONB isolado por tabela | Pendente |
| 0.1.3 | Peso dos indices vs dados | Pendente |
| 0.1.4 | Linhas por tabela e por loja | Pendente |
| 0.1.5 | Peso de `posicao_estoques` (provavel maior ofensor) | Pendente |
| 0.1.6 | Bloat por falta de VACUUM | Pendente |

### 0.2 Quick Wins (liberar espaco sem perder dado util)

| # | O que | Ganho estimado |
|---|---|---|
| 0.2.1 | `VACUUM FULL` nas tabelas com mais bloat | Dezenas de MB na hora |
| 0.2.2 | Apagar `full_object` JSONB de `posicao_estoques` antigas (manter so n_cmc e n_saldo em colunas) | Provavel maior ganho |
| 0.2.3 | Manter so as 2 fotos recentes de posicao completas; consolidar historico antigo em 1 foto/semana | Grande |
| 0.2.4 | Truncar `response` TEXT em movimentos/inventario_items apos 30 dias | Medio |
| 0.2.5 | Remover indices duplicados/nao usados | Medio |

### 0.3 Arquivo Morto (rolling 12 meses)

| # | O que |
|---|---|
| 0.3.1 | Coluna `archived_at` nas tabelas de historico |
| 0.3.2 | Indices parciais `WHERE archived_at IS NULL` (queries nao varrem dado morto) |
| 0.3.3 | Script: serializa `full_object` >12 meses, gzip, sobe pro Supabase Storage (`arquivo/{loja}/{tabela}/{ano-mes}.json.gz`) |
| 0.3.4 | Apos upload: zera `full_object` no banco, mantem colunas-resumo |
| 0.3.5 | Restore on demand: baixa do Storage, deserializa, transparente |
| 0.3.6 | `pg_cron` mensal (free tier suporta) roda arquivamento sozinho |

### 0.4 Preparar para Escala (Norte Vendas + Financeiro + CRM virao)

| # | O que |
|---|---|
| 0.4.1 | Politica: nada de blob/imagem/PDF no banco -- so texto/numero (Storage p/ arquivos) |
| 0.4.2 | Colunas extraidas do JSONB pra query; JSONB so como backup que vira arquivo morto |
| 0.4.3 | Particionar tabelas grandes por loja_id (futuro, se preciso) |
| 0.4.4 | Tela `/beta/saude-banco` (super admin): tamanho, projecao ate 500MB, alerta em 400MB |

---

## BLOCO A -- PUBLICO (todos os usuarios)

### A.1 Bugs ✅ CORRIGIDOS (commitados e pushados)

| O que | Commit |
|---|---|
| Constraints TPQ/Sem CMC (migration 043 confirmada) | sessao 2026-06-26 |
| Auditoria fiscal so NFs etapa 60 e nao canceladas (migration 047) | cd559e1 |
| Busca fornecedor NF cobre c_razao_social E c_nome | cd559e1 |
| Motivo TPQ invalido no Omie -> mapeia TRF | 3380666 |

### A.2 UI Base ✅ FEITO (commitado)

| O que | Commit |
|---|---|
| Ordenacao por coluna em tabelas (Lista.tsx, server-safe via links) | b498b77 |
| Total de registros na paginacao "1-50 de 847" (Paginacao.tsx) | b498b77 |
| Combobox com busca inline (Combobox.tsx + FiltrosGaveta) | 2423f27 |
| Export produtos com CMC, saldo, minimo, sugestao, margem | dfc608b |

### A.3 UI Base -- FEITO (commit d647f76)

| # | O que | Status |
|---|---|---|
| A.3.1 | Chips de periodo (Este mes/3m/6m/Todos) no faturamento; migration 050 pendente (DNS) | ✅ |
| A.3.2 | Dashboard: card valor monetario total (SUM saldo*CMC posicao mais recente) | ✅ |
| A.3.3 | Dashboard: sync badge com data+hora, aviso "+24h" no badge e na fila de alertas | ✅ |
| A.3.4 | Lista "Repor estoque" com saldo atual / minimo lado a lado | ✅ |

> Migration 050 (`relatorio_faturamento_matriz` + p_mes_ini/p_mes_fim): DNS dos poolers Supabase sem resolucao nesta sessao. Filtro ja funciona no lado do servidor (JS). Aplicar quando DNS voltar: `node scripts/aplicar-migration.mjs 050_faturamento_filtro_mes.sql`

### A.4 Resumo do Dia -- Auditoria de Inventario ✅ FEITO (commit 45f77d4)

| # | O que | Status |
|---|---|---|
| A.4.1 | Erros no /resumo mostram mensagem real do Omie (coluna Mensagem Omie) | ✅ |
| A.4.2 | RPCs inventario_nao_contados e inventario_cobertura (migration 049) | ✅ |
| A.4.3 | Chips Diario/Semanal/Mensal no resumo/auditoria | ✅ |
| A.4.4 | Barra de cobertura % por periodo em /resumo?cat=auditoria | ✅ |
| A.4.5 | Lista de produtos sem contagem nos ultimos 30 dias em /resumo?cat=auditoria | ✅ |

---

## BLOCO B -- VTBstock Beta (SO super admin total)

### B.1 Estrutura da area Beta -- FEITO (commit ded9364)

| # | O que | Status |
|---|---|---|
| B.1.1 | Coluna `is_super_admin boolean` em `profiles` (migration 051) | ✅ |
| B.1.2 | Helper `isSuperAdmin()` em `lib/auth.ts` | ✅ |
| B.1.3 | Layout `/beta/layout.tsx` com guard + banner "VTBstock Beta" | ✅ |
| B.1.4 | Botao "VTBstock Beta" no menu lateral e mobile, badge laranja | ✅ |
| B.1.5 | Index `/beta` com 5 modulos planejados | ✅ |

### B.2 Faturamento Nativo -- BLOQUEADO (sem NF no Omie destas lojas)

> **Probe 2026-06-26:** todos os endpoints NFC-e (v1/pos, v1/pdv, v1/faturamento) retornam 404. `v1/produtos/nfe / ListarNFe` existe mas retorna 0 registros em todas as 6 lojas. Conclusao: os restaurantes emitem NFC-e via PDV proprio (nao pelo Omie) e nao emitem NF-e de saida. Faturamento continua vindo SO do import manual (MOV_DRV). Desbloquear quando: (a) integrar PDV externo ou (b) lojas comecar a emitir NF via Omie.

| # | O que | Status |
|---|---|---|
| B.2.1 | Probe NFC-e na loja 3 | BLOQUEADO |
| B.2.2 | Tabelas cupons_fiscais + cupom_fiscal_items + sync NFC-e | aguarda |
| B.2.3 | Tela /beta/faturamento por produto/familia | aguarda |
| B.2.4 | NF-e de saida: tabela + sync + tela | aguarda |
| B.2.5 | Download XML e DANFE | aguarda |

### B.3 Financeiro

| # | O que |
|---|---|
| B.3.1 | Contas a pagar: tabela + sync (ListarContasPagar) + tela com filtros venc/fornecedor/status |
| B.3.2 | Contas a receber: tabela + sync (ListarContasReceber) + tela |
| B.3.3 | Fluxo de caixa: extrato (ListarLancFinanceiros), entradas vs saidas por semana |
| B.3.4 | Cards: a pagar / a receber / saldo projetado / vencidas |

### B.4 CRM

| # | O que |
|---|---|
| B.4.1 | Clientes: tabela + sync (ListarClientes) + tela + detalhe (histo NF saida + a receber) |
| B.4.2 | Fornecedores: tabela + sync (ListarFornecedores) + tela + detalhe (histo NF entrada + ultimo preco) |

### B.5 Relatorios (espelho Omie/DRV do Ramon)

| # | O que |
|---|---|
| B.5.1 | DRE: Receita bruta, CMV, Margem bruta, Despesas, Resultado |
| B.5.2 | Estoque valorizado: valor total, evolucao diaria, giro, produtos parados >60d |
| B.5.3 | Margem por produto: ranking mais/menos rentaveis, alerta margem negativa |
| B.5.4 | Compras: preco atual vs menor historico, ranking fornecedores |
| B.5.5 | Export Excel em todos |

### B.6 Pedidos e Producao

| # | O que |
|---|---|
| B.6.1 | Gerar Pedido de Compra no Omie a partir da sugestao (IncluirPedCompra) |
| B.6.2 | Pedidos de venda: sync + tela |
| B.6.3 | Ordens de producao: status + progresso + alerta de atraso |

---

## BLOCO D -- INDEPENDENCIA DO OMIE (preparar desligamento)

> O sistema tem que conseguir viver SEM o Omie quando os certificados chegarem. Cada modulo do Bloco B ja espelha um pedaco do Omie localmente. Aqui o que fecha o ciclo.

| # | O que | Quando |
|---|---|---|
| D.1 | Camada de abstracao `lib/fonte-dados.ts`: decide se le do Omie ou do banco local (flag por loja) | Antes de migrar |
| D.2 | Upload de certificado digital por loja (Supabase Storage) | Quando tiver certificado |
| D.3 | Emissao propria de NF-e e NFC-e direto no SEFAZ (sem Omie) | Fase final |
| D.4 | Espelhar 100% dos cadastros localmente (produtos, clientes, fornecedores, fiscal) | Durante o Beta |
| D.5 | Modo "sombra": sistema calcula tudo local e compara com Omie pra validar antes de cortar o cordao | Transicao |

---

## BLOCO E -- UNIFICACAO COM NORTE VENDAS (cardapio + cozinha + PDV)

> **Norte Vendas** = cardapio digital. Cliente faz o pedido no cardapio, a cozinha ve na tela (KDS), gera nota fiscal. Vai UNIR com o NTB Estoque (controle de estoque). Quando vende no Norte Vendas, baixa o estoque no NTB automaticamente via ficha tecnica (BOM).

| # | O que |
|---|---|
| E.1 | Contrato de dados entre os 2 sistemas (produto, preco, estoque compartilhados) |
| E.2 | Pedido fechado no Norte Vendas -> baixa automatica no estoque do NTB (via BOM) |
| E.3 | Tela de cozinha (KDS): pedidos em tempo real, status preparando/pronto |
| E.4 | Geracao de NF-e/NFC-e do pedido (usa a emissao propria do Bloco D) |
| E.5 | Estoque unificado: o que vende no cardapio reflete no NTB na hora |
| E.6 | Decisao de arquitetura: banco compartilhado vs sincronizado entre os 2 sistemas |

---

## ORDEM DE EXECUCAO RECOMENDADA

| Ordem | Bloco | Por que |
|---|---|---|
| 1 | **0 -- Banco** | 733MB > 500MB limite. Pode travar escrita a qualquer momento. Resolver ANTES de adicionar dado. |
| 2 | **A.4 -- Resumo do Dia** | Usuario pediu, e publico, rapido, baixo risco (erros visiveis). |
| 3 | **A.3 -- UI Base restante** | Quick wins publicos (dashboard, faturamento filtros). |
| 4 | **B.1 -- Estrutura Beta** | Sem isso nenhum modulo novo entra seguro. Cria o "lugar trancado". |
| 5 | **B.2 -- Faturamento Nativo** | Maior impacto operacional + primeiro passo da independencia. |
| 6 | **B.3/B.4/B.5/B.6** | Resto da copia do Omie, dentro do Beta. |
| 7 | **D -- Independencia** | Em paralelo ao B, fecha quando certificados chegarem. |
| 8 | **E -- Norte Vendas** | Futuro, depois da base solida. |

---

## ESTADO ATUAL DO REPOSITORIO (commits desta sessao)

```
2423f27 feat: combobox com busca inline para filtros com muitas opcoes
b498b77 feat: ordenacao por coluna em tabelas e total de registros na paginacao
dfc608b feat: export de produtos inclui CMC, saldo, minimo, sugestao, margem
3380666 fix: transferencia TPQ enviava motivo='TPQ' ao Omie (invalido); mapeia TRF
cd559e1 fix: auditoria fiscal so conta NFs etapa 60; busca fornecedor c_razao_social+c_nome
3011ccb docs: plano de melhorias fase 1
d655e77 docs: expandir spec Omie com mapa completo de todos os endpoints
bbe9f60 docs: spec completo varredura API Omie (17 agentes)
```

**Migrations:** ultima aplicada = 049. Proxima disponivel = 050.

**Documentos de apoio neste repo:**
- `docs/superpowers/specs/2026-06-26-omie-varredura-spec.md` -- mapa COMPLETO de todos os endpoints da API Omie (calls, campos, status NTB, priorizacao)
- `docs/superpowers/plans/2026-06-26-ntb-melhorias-fase1.md` -- plano detalhado das 13 tasks de bugs/UI/faturamento (algumas ja feitas)
- `docs/superpowers/plans/2026-06-26-inventario-auditoria.md` -- plano detalhado das RPCs de nao-contados/cobertura (corrigir: e na tela /resumo, nao /inventario)
- `docs/superpowers/plans/2026-06-26-ROADMAP-MASTER.md` -- ESTE arquivo

---

## CONTEXTO TECNICO RAPIDO

- **Stack:** Next.js 16 + Supabase (projeto `waubqgkftwrufepwhctc`, free tier, migrado 2026-06-26) + Vercel + Omie ERP
- **6 lojas** em restaurantes/distribuidoras na Bahia, cada uma com AppKey Omie propria
- **Design system proprio:** `components/ui-kit/` (Linear/Vercel claro) -- usar o kit, nao classes antigas
- **RBAC:** `requirePermissao(lojaId, 'Nome Permissao')` nas server actions
- **Omie rate limit:** 240 req/min, 300ms entre leituras, 800ms entre escritas
- **CMC** (custo medio) vem do Omie, NAO escrevivel via API
- **Estoque minimo** vem da POSICAO (posicao_estoques), override local so no banco
- **c_etapa = '60'** = NF concluida/autorizada (unica valida)
- **Tipos de movimento:** TRF (transferencia), TPQ (perda/quebra). No Omie o `tipo` so aceita ENT/SAI/SLD/TRF; TPQ e so motivo interno -> mapeia pra TRF.
- **Nomes do Omie vem em CAIXA ALTA sem acento** -> `formatar-nome.ts`
- **Banco = rolling 12 meses** quente; >1 ano vai pro arquivo morto (Storage)
