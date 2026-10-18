# Fase B — Entrada de nota fiscal completa (estoque próprio) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A entrada de NF-e da loja de estoque próprio (`modo_estoque='proprio'`, hoje a ODARA, loja 15) faz tudo o que o cartão de recebimento do Omie faz: por item, custo de estoque com as 8 marcações (sugeridas e editáveis), quantidade recebida com unidade de estoque e fator, local de estoque, CFOP de entrada, "movimenta estoque" e "gera conta a pagar"; XML validado; manifestação do destinatário por botão; etapas do recebimento com histórico; CT-e de frete no custo; nota por chave digitada. As lojas Omie (2–7) não mudam de comportamento.

**Architecture:** A fonte da verdade de cada item é `compras_proprio_itens` (colunas tipadas novas, migration 184). Uma função SQL projeta o item no formato do Omie em `nota_fiscal_items.full_object` (`itensAjustes`, `itensCustoEstoque`, `itensICMS`…), para os relatórios da Fase A (Compras com valor de estoque, CFOP, local) e a tela da nota lerem a loja própria igual ao Omie. O custo da entrada no ledger usa a MESMA função SQL `custo_estoque_item_omie` (Fase A, regra N3) sobre essa projeção, dividida pela quantidade recebida; itens sem os campos novos (compras antigas e compra manual) seguem a fórmula da migration 135 sem mudança. Regras novas em módulos puros (`node --test`); escrita na SEFAZ só por botão.

**Tech Stack:** Next.js 16.2.9 (ler `node_modules/next/dist/docs/` antes de mexer em rotas), TypeScript, Supabase self-hosted (PostgREST + Postgres 17 no Contabo), supabase-js, `node:test` (Node 26), `xml-crypto` 6.3.3 (já é dependência), SOAP da SEFAZ (Ambiente Nacional) via `lib/estoque/sefaz-rede.ts`, SQL de teste em `scripts/testes-sql/`.

**Spec:** `docs/superpowers/plans/2026-10-18-plano-mestre-paridade-omie.md`, seção "Fase B" (itens 1–10, aqui B1–B10) + `~/Projects/omie-rea/telas/COM/etapas-pedidos-compra/FORM-RECEBIMENTO.md` (campos do cartão e do editor do item), `…/nf-*/` (13 recebimentos capturados), `~/Projects/omie-rea/regras/entrada-nf-fornecedor.md` (N1–N8; N3 corrigida), `regras/xml-para-recebimento.md` (X1–X8), `regras/evidencias-itens-recebimento.json`, `fluxos/README.md` (F1), `gaps/matriz-compras-estoque-producao.md` (A1–A6, B1, C3, C4, C6, C7, D3, D4, D14a–j, E2, F8, F9, F12, G1.2, G1.3, K14). Dados locais (só leitura) para os valores dos testes e das decisões: `~/Projects/omie-rea/bruto/nf_itens_loja5.csv.gz` (D1, 2.987 itens concluídos da loja 5) e `bruto/kardex_omie_loja5.csv.gz` (K1). Plano anterior (estilo, P-MIG/P-PROVA, numeração): `docs/superpowers/plans/2026-10-18-fase-a-correcoes-provadas.md`.

## Global Constraints

- Branch de trabalho: `paridade-omie` (HEAD `9d5cf73b` quando este plano foi escrito). Cada task termina num commit; a mensagem termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_0183b5mkJcQaRjgHoMxzahgr`. Push e merge na `main` só com OK do dono.
- **Pré-requisito:** Fase A em produção (migrations 175–183 aplicadas e código publicado). A 185 recria `custo_estoque_item_omie` (175) e `lancar_compra` (corpo da 181), e lê `sefaz_chaves_canceladas` (180) e `fornecedor_da_nota_sefaz` (182). Sem isso, parar (Task 0).
- **Modo Omie intocado:** nada muda para lojas `modo_estoque='omie'` (2–7) nem `'nenhum'`. Despacho por `modoDaLoja` no começo de cada action/rota (padrão de `lib/estoque/nf-despacho.test.ts`). Únicas mudanças visíveis no modo Omie, previstas no plano-mestre: o botão "Manifestar (marcar recebida)" passa a se chamar "Concluir recebimento" (só o texto; a função chamada é a mesma) e a lista de itens da nota mostra, só para leitura, CFOP de entrada, local, "gera conta a pagar" e "movimenta estoque" que o Omie já manda em `full_object`. Toda task que toca arquivo compartilhado tem teste de regressão do modo Omie.
- **Migrations aditivas e compatíveis com o código velho:** com a migration aplicada e o código antigo no ar, tudo funciona igual (colunas novas aceitam nulo ou têm padrão; funções existentes mantêm a assinatura e o resultado para entradas antigas; funções novas têm nome novo). Cada migration roda numa transação (`begin … commit`), sem `create index concurrently`. Ordem: 184 → 185 → 186, sempre ANTES de publicar o código que as usa.
- Deploy é manual (`ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`, síncrono), só depois de testado e com OK do dono no chat. Depois: `curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login` = `HTTP 200`. Build com cara de velho → `rm -rf .next` e build de novo.
- Procedimento **P-MIG** (toda migration deste plano): (1) `grep NEXT_PUBLIC_SUPABASE_URL /opt/ntb-estoque/.env.local` = `http://127.0.0.1:8100`; (2) backup: `bash /opt/ntb-estoque/scripts/backup-postgres-contabo.sh` + `pg_get_functiondef` de cada função que a migration recria salvo em `/root/backups-ntb-estoque/pre-NNN-<funcao>.sql`; (3) aplicar com `ssh … "docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres" < supabase/migrations/NNN_x.sql`; (4) `\df <cada função tocada>` = **1 overload**; (5) `notify pgrst, 'reload schema';` (se a tela não enxergar, `docker restart supabase-rest`); (6) no lote de deploy: `desktop/scripts/gerar-schema.sh` + versão nova do app desktop.
- Procedimento **P-PROVA**: prova só leitura, como usuário logado (conta QA `claude.qa@ntb-estoque.dev`, cookie `sb-127-auth-token`, `fetch` em `127.0.0.1:3002`) ou SQL `set role authenticated`; nunca concluir pelo `supabase_admin`. Comparar origem (XML/Omie/kardex) × destino (nosso), nunca o destino com ele mesmo.
- **SEFAZ:** a única escrita que já existia é a ciência (210210, automática pela configuração `sefaz_nsu.auto_ciencia`). A manifestação nova (210200/210220/210240) só sai por botão numa nota, com confirmação explícita; nunca em cron, sync ou lançamento automático. Nunca emitir nem cancelar nota. Só hosts `fazenda.gov.br`. Respeitar 137/656 = esperar 1 h (`bloqueado_ate`) e 1 consulta por chave por hora. Toda primeira chamada real é [OK do dono].
- **Não mexer na Central de correções**: nada em `lib/correcoes/**`, `lib/actions/central.ts`, `app/(app)/estoque/correcoes/**`, nem nas funções SQL das migrations 171/172.
- Módulo puro: sem alias `@/`, teste com `node --test <arquivo>.test.ts`. Importar valor de outro `.ts` só no padrão já usado em `lib/estoque/sefaz-distdfe.ts` (`// @ts-ignore` + import com extensão `.ts`); tipos sempre com `import type`.
- Todo `.range()` vem com `.order('id')` (ou outra coluna única). Todo `select` de `lojas` inclui `is_test`; consulta de `lojas` por coluna ≠ `id` inclui `.eq('is_test', false)`.
- Política RLS nova: `((select usuario_e_admin()) or loja_id in (select usuario_lojas()))` (initplan, migration 156). Escrita em tabela nova só pelo `service_role`. Índice único parcial: nunca `.upsert()`/`onConflict` do supabase-js; `insert` + tratar `23505`, ou RPC.
- Server action nova → `node scripts/inserir-via-desktop.mjs` e decidir a entrada em `lib/offline/politica.ts` (o que só mexe no banco = `local`; o que fala com a SEFAZ fica fora = "precisa de internet").
- CFOP e NCM guardados só com dígitos em `compras_proprio_itens` e formatados na tela (X3); a projeção em `full_object` usa o formato do Omie (`'1.102'`), porque é o que os relatórios comparam.
- Textos de tela em português, sem jargão; o produto se chama "Norte Estoque". Valores reais dos testes vêm das capturas (`nf-*`, D1, K1); o que não tem caso real leva `HIPÓTESE` no nome do teste.

## Review Focus

- **Fator ou unidade errados no item** (dado real do Omie: TEQUILA PRATA 1 UND8 → 1 ML a R$ 139,90, enquanto a TEQUILA OURO da mesma nota foi 1 → 750 ML; RUM 1 GFA8 → 1 ML): a nota não pode entrar sozinha nem ficar "Conferida" sem a pessoa confirmar o custo; espera-se o aviso "custo por ML 750× o custo médio". Testes: Task 4 (`fator suspeito e custo fora: TEQUILA PRATA da NF 189215`), Task 7 (`podeLancarSozinho: padrão ou alerta de item segura a nota`), Task 8 (`marcarConferidaNF recusa sem "Conferi os avisos" (TEQUILA PRATA) e aceita com`).
- **A mesma nota chegando de novo depois de o gerente mexer** (procNFe depois do resumo, XML enviado outra vez, NSU relido): local, CFOP, quantidade recebida e marcações configurados ficam; nada volta para a sugestão. Teste: Task 6, cenário F (`reimportar mantém a configuração manual e a projeção`).
- **NF complementar, item de valor zero e bonificação** (NF 7433: complementar de ICMS com 1 UN a R$ 0,00 e ICMS 305,23; Sukita da NF 110582 com CFOP 5.405 → 1.910): não pode criar entrada de 1 UN a custo zero nem diluir o custo médio; espera-se o item já marcado "não movimenta estoque" e a nota podendo ser concluída. Testes: Task 4 (`NF complementar e item de valor zero nascem sem movimentar estoque`), Task 6, cenário D.
- **CT-e que chega depois de a nota já ter entrado no estoque**: espera-se recusa clara ("desfaça a entrada, ligue o CT-e e confirme de novo"), nunca frete ignorado em silêncio nem custo trocado no histórico. Teste: Task 11 (`CT-e em compra com item lançado é recusado`).
- **Manifestação com duplo clique, dois gerentes ao mesmo tempo ou resposta da SEFAZ perdida (tempo esgotado)**: no máximo um envio em andamento por nota; reenvio só do envio que ficou sem resposta (a SEFAZ responde 573 se já tinha registrado). Teste: Task 10 (`decidirEnvioManifestacao: em andamento bloqueia, sem resposta reenvia o mesmo tipo`).

---

## Decisões de desenho (R1–R17)

Cada uma resolve um ponto que o plano-mestre deixa aberto. As que dependem de dado citam o número medido em D1/K1 (loja 5, só leitura, 18/10/2026).

- **R1 — Sugestão das 8 marcações (decisão do dono: sugerir como o Omie, editável item a item).** Medido em D1: as marcações **não** são função do regime/CFOP/CST (na NF 000000132, dois itens do mesmo fornecedor, CSOSN 102, CFOP 5.102 → 1.102: um `SSSSSSSS`, outro `NNNNNNNN`); 411 de 516 produtos (80 %) repetem sempre a mesma combinação, e a memória do produto acerta 84,9 % das marcações exatas quando há histórico. Por isso a sugestão é em camadas: (1) últimas marcações confirmadas daquele produto na loja; (2) últimas daquele código do fornecedor (CNPJ + cProd); (3) **regra Omie-like** por CRT do fornecedor + CST/CSOSN (tabela pela moda de D1; sozinha dá o mesmo valor de estoque do Omie em 83,2 % dos itens); (4) padrão `NNNNNNNN` (moda global de D1, 35,5 %). Camadas 1+3: 92,3 % dos itens com o mesmo valor de estoque do Omie. Ordem das letras = ordem da tela do Omie (cids 339–347): ICMS, ICMS-ST, IPI, Seguro, PIS, COFINS, Frete, Outras. Alíquotas de crédito de PIS/COFINS começam em 0 (2.987/2.987 itens de D1 com 0).
- **R2 — Modelo de dados: colunas tipadas em `compras_proprio_itens`, não jsonb.** Local, CFOP de entrada, quantidade recebida, unidade, marcações, alíquotas, "movimenta"/"gera conta a pagar" e os valores de IPI/ST/frete/seguro/outras são lidos pelo SQL do lançamento e dos relatórios, precisam de `check` (CFOP `^[123][0-9]{3}$`, quantidade > 0, alíquota 0–100, marcações todas ou nenhuma), de nulo com significado ("usar o comportamento antigo") e de tipo no TS. Só o detalhe fiscal informativo (CST/CSOSN, origem, BC, alíquotas, PIS/COFINS) vai em `fiscal jsonb`. `nota_fiscal_items.full_object` recebe uma **projeção** no formato do Omie, sempre regenerada a partir do item (`projetar_itens_compra_na_nota`): editar o item nunca grava direto no `full_object`.
- **R3 — Custo da entrada = regra N3 pela mesma função da Fase A.** `custo_estoque_item_omie(projeção, quantidade, valor_unitario)` ÷ quantidade recebida. A função ganha um ramo que só lê o bloco `sefaz` da projeção própria (frete, seguro e CT-e com as suas marcações; outras despesas = o resto). Item do Omie não tem bloco `sefaz` (chaves de `itensCabec` em D1: nenhuma de frete/seguro), então o resultado do Omie não muda (prova por checksum na Task 12/14). Item sem `valor_total_item` (compra antiga, compra manual) segue a fórmula da 135 exatamente (frete rateado − desconto da nota rateado − ICMS se `icms_recuperavel`).
- **R4 — Quantidade recebida em unidade de estoque; entrega parcial como o Omie.** Padrão = quantidade da nota × fator. Recebido menor que a nota: o valor de estoque inteiro do item entra sobre o que chegou (PROVADO: K1 × D1, 3/3 itens com mesma unidade e recebido < nota — NF 4010 PEIXE 40,9 KG → 37,888369 KG com R$ 3.063,41 inteiros; NF 4064 62,5 → 57,897875 KG). O resto não entra depois (não existe "segunda entrega" da mesma nota); aparece o aviso "recebeu X de Y". Pedido × nota × recebido é a Fase C.
- **R5 — Local por item:** `coalesce(item.codigo_local_estoque, compra.codigo_local_estoque)`. Sugestão = último local usado para o produto (memória), senão o local escolhido para a nota. No lançamento, item com local inexistente, excluído ou inativo fica pendente com motivo `local_invalido`; os outros entram.
- **R6 — CFOP de entrada:** guardado com dígitos (`'1102'`), projetado como `'1.102'`. Sugestão: (1) último CFOP de entrada do produto (acerta 94,9 % quando há histórico); (2) tabela pela moda de D1 (5101/5102/5103 → 1102, 5403 → 1403, **5405 → 1407**, 5656 → 1653, 5910 → 1910, 5929 → 1556; sozinha 73,7 %); (3) regra 5→1, 6→2, 7→3 com x101/x102/x103 → x102 e x401/x403/x405 → x403. Com CFOP de entrada, os relatórios da Fase A já tiram 908/910 (bonificação/comodato) também da loja própria.
- **R7 — "Movimenta estoque" falso** = o item não entra no estoque e conta como resolvido (a nota pode ficar "lançada" com ele de fora; cobre o "Ignorar item" do Omie, matriz C10). Nascem com falso: NF complementar/ajuste (`finNFe` 2 ou 3) e item com `valor_total_item` ≤ 0. "Gera conta a pagar" só é gravado e projetado agora (Fase E usa).
- **R8 — Categoria por item = coluna que já existe** (`nota_fiscal_items.categoria_contabil_id`, editável em `ItensNotaFiscal`); sem coluna nova.
- **R9 — Etapas:** reaproveitam a situação de `sincronizar_situacao_nota`: `resumo` → `a_conferir`/`divergente` → **`conferida`** (nova: `compras_proprio.conferida_em`) → `lancada`/`parcial`; fora do quadro: `estornada`, `recusada` (nova: manifestação negativa registrada) e cancelada. Mudar qualquer item depois de conferida volta para "a conferir". Lançamento automático continua com as regras de hoje e mais duas: nenhum item com marcações de origem `padrao` e nenhum aviso de item (fator, custo, valor zero).
- **R10 — Histórico de processamento (F9):** tabela append-only `compras_proprio_eventos`, gravada DENTRO das funções SQL (mesma transação), mais `sefaz_documentos`, `sefaz_manifestacoes` e `sefaz_chaves_canceladas`. Não usa `registrarAuditoria` (best-effort).
- **R11 — Validação do XML (B10):** erros bloqueiam o upload e, no caminho da SEFAZ, marcam o documento `ignorado` com o motivo: tamanho > 1.000.000 bytes, `<!DOCTYPE`/`<!ENTITY`, sem `protNFe`, `cStat` do protocolo fora de {100, 150}, chave do protocolo ≠ chave da nota, `tpAmb` 2, sem `Signature` (com `SignatureValue` e `X509Certificate`), emitente = CNPJ da loja, CNPJ da chave ≠ emitente, modelo ≠ 55. Avisos (nota fica "divergente"): assinatura que não confere criptograficamente (vira erro depois que a Task 13 medir as notas reais da ODARA) e destinatário ≠ loja (XML de terceiro é aceito, como a configuração "Permitir a importação de XMLs de terceiros" do Omie, matriz A6). `lerNfe` continua lendo XML sem protocolo (teste antigo fica); quem bloqueia é o validador.
- **R12 — Manifestação (B6, decisão do dono):** botão por nota, diálogo de confirmação com a caixa "Entendi que isto vai para a SEFAZ e não pode ser desfeito", permissão nova `Notas Fiscais - Manifestar na SEFAZ`. Uma manifestação conclusiva por nota (210200, 210220 ou 210240); 210240 exige justificativa de 15 a 255 caracteres (acentos tirados no XML, guardada como digitada). Depois de 210220/210240 registrada, `lancar_compra` recusa a entrada (situação `recusada`); entrada já feita não é desfeita sozinha (a tela avisa). Ciência segue como hoje. No modo Omie, só o texto do botão muda para "Concluir recebimento"; os nomes das funções (`manifestarNF`…) ficam, para não mexer no registro do desktop.
- **R13 — CT-e (B9):** modelo, XML enviado à mão ou valor digitado, rateio entre as notas pelo valor da nota e dentro da nota pelo valor líquido do item (HIPÓTESE N8: o Omie mostra "Frete Proporcional" e %, sem fórmula provada); entra no custo do item só com a marcação Frete = S. Só liga CT-e a compra sem nenhum item lançado (como o Omie, que exige reverter o recebimento). Sem amostra real (D1 sem frete; os 13 cartões com "Valor do Serviço de Transporte" 0): a captura automática do CT-e pela SEFAZ (`CTeDistribuicaoDFe`, outro serviço) fica para um plano posterior.
- **R14 — Nota por chave digitada (A4):** só NF-e (a distribuição de NF-e não entrega CT-e), pela consulta `consChNFe` que já existe, 1 tentativa por chave por hora (`sefaz_busca_chave`) e respeitando o 656.
- **R15 — Ponto de entrada único do custo no TS:** a prévia de custo na tela usa `custoEstoqueItemOmie` (Fase A) com as marcações do item; o teste SQL e o teste TS usam os mesmos números reais (NF 131055) para provar que tela e lançamento batem.
- **R16 — Tamanho:** cabe num plano (≈ 6 semanas). A captura automática do CT-e e o "Novo Recebimento" com várias notas por CT-e vindo da SEFAZ ficam fora (plano posterior); contas a pagar das parcelas é a Fase E.
- **R17 — Abas do cartão:** Transporte e Totais da loja própria passam a mostrar tudo o que o XML traz (transportadora com CNPJ/IE/UF, placa, RNTRC, volumes com marca/numeração/lacres, pesos; totais com as chaves do Omie, X7); Informações adicionais já vinha (`infCpl`); Observações vira texto editável da compra (`compras_proprio.obs`, que já existe). No modo Omie a tela fica como está (`DetalhesFiscaisNF` só mostra o bloco novo com `semOmie`). Parcelas editáveis, conta corrente e comprador são a Fase E; Departamentos e Projeto, a Fase G.

## Mapa de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `lib/estoque/nfe-xml.ts` (+ `.test.ts`), `lib/estoque/fixtures/nfe-crbs-131055.ts` — novo | Leitura completa do item (X1, impostos, CRT, finalidade, protocolo, assinatura); fixture com valores reais | 1 |
| `lib/estoque/nfe-validacao.ts` (+ teste) — novo, puro; `lib/estoque/nfe-assinatura.ts` — novo (servidor, `xml-crypto`) | Validação do XML (R11) | 2 |
| `lib/compras/custo-estoque-item.ts` (+ teste) | Frete/seguro/CT-e separados só no bloco `sefaz`; custo unitário pela quantidade recebida | 3 |
| `lib/estoque/nf-item-regras.ts` (+ teste) — novo, puro | Marcações, CFOP de entrada, unidades e fator, avisos do item, configuração inicial, validação da configuração | 4 |
| `supabase/migrations/184_entrada_nf_schema.sql` + `scripts/testes-sql/184_entrada_nf_schema.sql` | Colunas, tabelas de eventos/manifestações/CT-e/busca por chave, permissão | 5 |
| `supabase/migrations/185_entrada_nf_funcoes.sql` + `scripts/testes-sql/185_entrada_nf_funcoes.sql` | Projeção, memória, `lancar_compra` por item, configurar/conferir item, situação | 6 |
| `lib/estoque/nf-sefaz-mapa.ts` (+ teste), `lib/estoque/nf-sefaz.ts`, `lib/estoque/nf-memoria.ts` — novo, `lib/estoque/sefaz-sync.ts`, `lib/actions/compras-proprio.ts` | Nota gravada com sugestões, validação no upload e na SEFAZ, lançamento automático com as regras novas | 7 |
| `components/nota-fiscal/EditorItemNF.tsx` — novo, `ConferenciaNF.tsx`, `ItensNotaFiscal.tsx`, `DetalhesFiscaisNF.tsx`, `app/(app)/nota-fiscal/[id]/dados-proprio.ts`, `components/compras-proprio/ImportarXml.tsx`, `lib/actions/nota-fiscal-proprio.ts`, `lib/offline/politica.ts` | Editor do item, conferência, abas Transporte/Totais/Observações, colunas só leitura no modo Omie, local por item no upload | 8 |
| `lib/estoque/nf-etapas.ts`, `lib/estoque/nf-historico.ts` (+ testes) — novos, puros; `components/nota-fiscal/QuadroEtapasNF.tsx`, `components/nota-fiscal/HistoricoProcessamentoNF.tsx` — novos; `app/(app)/nota-fiscal/etapas/page.tsx` — novo; `lib/nf-status.ts` (+ teste) | Quadro de etapas e histórico de processamento | 9 |
| `lib/estoque/sefaz-manifestacao.ts` (+ teste) — novo, puro; `lib/estoque/sefaz-rede.ts`; `components/nota-fiscal/ManifestacaoNF.tsx` — novo; `components/nota-fiscal/AcoesNF.tsx`; `components/nota-fiscal/HistoricoStatusNF.tsx` | Manifestação do destinatário; "Concluir recebimento" | 10 |
| `lib/estoque/cte-xml.ts` (+ teste) — novo, puro; `supabase/migrations/186_cte_frete_funcoes.sql` + teste SQL; `components/nota-fiscal/FreteCteNF.tsx`, `components/nota-fiscal/BuscarPorChave.tsx` — novos | CT-e no custo; nota por chave digitada | 11 |
| `lib/estoque/fase-b-omie-intacto.test.ts` — novo; `scripts/testes-sql/185_omie_intacto.sql` — novo | Regressão do modo Omie | 12 |
| `AGENTS.md` | Registro da fase e do resultado ao vivo da SEFAZ | 13, 14 |

---

### Task 0: Portão — Fase A em produção (só leitura)

**Files:** nenhum.

**Interfaces:**
- Consumes: migrations 175–183 aplicadas; `custo_estoque_item_omie(jsonb, numeric, numeric)`, `item_movimenta_estoque(jsonb)`, `lancar_compra(jsonb, bigint, text)` (corpo da 181), `sefaz_marcar_cancelada(bigint, text)` (180), `fornecedor_da_nota_sefaz(bigint, text, text, text, text)` (182).
- Produces: autorização para as Tasks 5, 6 e 14 (que recriam funções da Fase A).

- [ ] **Step 1: Conferir no Postgres de produção**

Run: `\df custo_estoque_item_omie`, `\df lancar_compra`, `select pg_get_functiondef('lancar_compra(jsonb,bigint,text)'::regprocedure) like '%chave_idempotencia%';`, `select to_regclass('public.sefaz_chaves_canceladas');`, `\df fornecedor_da_nota_sefaz`, e `git log origin/main --oneline | grep -c "migration 18[0-3]"` (código da Fase A na `main`).
Expected: 1 overload em cada; `t`; tabela existe; commits da Fase A na `main` e deploy feito. Qualquer falta → parar e terminar a Fase A antes.

---

### Task 1: Leitura completa do item da NF-e (X1, impostos, CRT, finalidade, protocolo, assinatura) [B1, B2, B10]

Hoje `lerNfe` lê só `vProd`, `vDesc` e `vICMS` do item e junta frete + seguro + outras do total; IPI, ST, FCP-ST, PIS/COFINS e as despesas do item não são lidos (matriz D9–D11, D14b/c).

**Files:**
- Modify: `lib/estoque/nfe-xml.ts` (tipos `ItemNfe`, `NfeLida`; laço de `det`; bloco de totais)
- Create: `lib/estoque/fixtures/nfe-crbs-131055.ts`
- Modify: `lib/estoque/nfe-xml.test.ts` (o `deepEqual` do 1º teste ganha os campos novos)

**Interfaces:**
- Produces:
  - `type FiscalItemNfe = { origem: string | null; cst: string | null; csosn: string | null; bcIcms: number; aliqIcms: number; icms: number; credIcmsSn: number; aliqCredSn: number; bcSt: number; st: number; fcpSt: number; cstIpi: string | null; ipi: number; cstPis: string | null; pis: number; cstCofins: string | null; cofins: number; frete: number; seguro: number; outras: number }`
  - `ItemNfe` ganha `valorTotalItem: number` (X1) e `fiscal: FiscalItemNfe`. `icms` fica (compatibilidade).
  - `NfeLida` ganha `crt: string | null`, `finalidade: string | null` (`ide/finNFe`), `ambiente: '1' | '2' | null` (`ide/tpAmb`), `protocolo: { cStat: string; nProt: string | null; chave: string | null; tpAmb: string | null } | null`, `assinatura: { presente: boolean }`; `transporte` ganha `ie, uf, placa, ufPlaca, rntc, marca, numeracao: string | null` e `lacres: string[]`; `valores` ganha `vFrete, vSeg, vOutro, ipi, st, fcpSt, pis, cofins, icmsDesonerado` (cada um do `ICMSTot`). `valores.frete` continua = vFrete + vSeg + vOutro do total (caminho antigo).
  - `export const XML_CRBS_131055: string` e `export const CHAVE_CRBS = '29260956228356015244550220001310551123456788'` na fixture: 3 itens reais da NF 131055 (CRBS S/A, CNPJ 56228356015244, `CRT` 3, `finNFe` 1, `tpAmb` 1, CFOP 5405, ICMS de cada item = `<ICMS60><orig>0</orig><CST>60</CST></ICMS60>`), `dest` = 66764497000122, `ICMSTot` com vProd 831.68, vIPI 20.80, vOutro 70.15, vPIS 11.29, vCOFINS 51.82, vNF 922.63; `protNFe/infProt` com cStat 100, tpAmb 1, nProt 129260000000001 e a mesma chave; `transp` com modFrete 0, `transporta` (CNPJ 56228356015244, xNome CRBS S/A, IE 117782932, UF BA), `veicTransp` (placa ABC1D23, UF BA, RNTC 123456), `vol` (qVol 77, esp CX, marca AMBEV, nVol 1-77, pesoL 820.5, pesoB 860.2, `lacres/nLacre` L001); `Signature` com `SignatureValue` e `X509Certificate` de mentira (não confere: serve para presença).

- [ ] **Step 1: Escrever os testes que falham**

```ts
import { XML_CRBS_131055, CHAVE_CRBS } from './fixtures/nfe-crbs-131055.ts'
// Fixture (valores do Omie para a NF 131055, itens 0, 6 e 7):
// 1 Água Mineral   qCom 10 CX vUnCom 16.2995160000 vProd 163.00 vOutro 13.41                     → vTotalItem 176.41
// 2 Long Corona    qCom 4  CX vUnCom 158.1491010000 vProd 632.60 vIPI 20.04 vOutro 53.71 PIS 10.67 COFINS 48.98 → 706.35
// 3 Tônica Diet    qCom 1  CX vUnCom 36.0755500000 vProd 36.08 vIPI 0.76 vOutro 3.03 PIS 0.62 COFINS 2.84     → 39.87
test('X1: vTotalItem = vProd − vDesc + vIPI + vICMSST + vFCPST + vOutro + vFrete + vSeg (NF 131055)', () => {
  const n = lerNfe(XML_CRBS_131055)
  assert.deepEqual(n.itens.map((i) => i.valorTotalItem), [176.41, 706.35, 39.87])
})
test('impostos e despesas do item (CST 60, IPI, PIS/COFINS, outras)', () => {
  const f = lerNfe(XML_CRBS_131055).itens[1].fiscal
  assert.equal(f.cst, '60'); assert.equal(f.csosn, null); assert.equal(f.ipi, 20.04); assert.equal(f.outras, 53.71)
  assert.equal(f.pis, 10.67); assert.equal(f.cofins, 48.98); assert.equal(f.st, 0); assert.equal(f.frete, 0)
})
test('CRT, finalidade, ambiente, protocolo e assinatura', () => {
  const n = lerNfe(XML_CRBS_131055)
  assert.equal(n.crt, '3'); assert.equal(n.finalidade, '1'); assert.equal(n.ambiente, '1')
  assert.deepEqual(n.protocolo, { cStat: '100', nProt: '129260000000001', chave: CHAVE_CRBS, tpAmb: '1' })
  assert.equal(n.assinatura.presente, true)
  assert.equal(lerNfe(XML_CRBS_131055.replace(/<protNFe>[\s\S]*<\/protNFe>/, '')).protocolo, null)
})
test('Simples: CSOSN 102 (NF 000000132) e crédito do Simples no CSOSN 101 (HIPÓTESE: sem caso real em D1)', () => {
  const x = XML_CRBS_131055.replace('<ICMS60><orig>0</orig><CST>60</CST></ICMS60>', '<ICMSSN101><orig>0</orig><CSOSN>101</CSOSN><pCredSN>2.50</pCredSN><vCredICMSSN>4.08</vCredICMSSN></ICMSSN101>')
  const f = lerNfe(x).itens[0].fiscal
  assert.equal(f.csosn, '101'); assert.equal(f.cst, null); assert.equal(f.credIcmsSn, 4.08); assert.equal(f.aliqCredSn, 2.5)
})
test('transporte completo (aba Transporte do Omie)', () => {
  const t = lerNfe(XML_CRBS_131055).transporte
  assert.equal(t.ie, '117782932'); assert.equal(t.placa, 'ABC1D23'); assert.equal(t.rntc, '123456'); assert.equal(t.marca, 'AMBEV')
  assert.equal(t.numeracao, '1-77'); assert.deepEqual(t.lacres, ['L001']); assert.equal(t.volumes, '77')
})
test('legado: valores.frete continua frete + seguro + outras do total', () => {
  assert.equal(lerNfe(XML).valores.frete, 30) // fixture antiga do arquivo
})
```
E no 1º teste existente, o `deepEqual` do item 1 passa a incluir `valorTotalItem: 190` e `fiscal: { origem: '0', cst: null, csosn: '102', bcIcms: 0, aliqIcms: 0, icms: 0, credIcmsSn: 0, aliqCredSn: 0, bcSt: 0, st: 0, fcpSt: 0, cstIpi: null, ipi: 0, cstPis: null, pis: 0, cstCofins: null, cofins: 0, frete: 0, seguro: 0, outras: 0 }`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/estoque/nfe-xml.test.ts`
Expected: FAIL (`valorTotalItem` indefinido; fixture inexistente).

- [ ] **Step 3: Implementar em `lib/estoque/nfe-xml.ts`**

Ler por item `prod/vFrete`, `vSeg`, `vOutro`; em `imposto`: o primeiro filho de `ICMS` (`orig`, `CST` ou `CSOSN`, `vBC`, `pICMS`, `vICMS`, `pCredSN`, `vCredICMSSN`, `vBCST`, `vICMSST`, `vFCPST`), `IPI/IPITrib` ou `IPI/IPINT` (`CST`, `vIPI`), `PIS/*` e `COFINS/*` (primeiro filho: `CST`, `vPIS`/`vCOFINS`). `valorTotalItem = r2(vProd − vDesc + vIPI + vICMSST + vFCPST + vOutro + vFrete + vSeg)`. `crt` = `emit/CRT`; `protocolo` = `protNFe/infProt` (`cStat`, `nProt`, `chNFe`, `tpAmb`); `assinatura.presente` = existe `Signature` com `SignatureValue` e `X509Certificate` não vazios. Totais novos do `ICMSTot` (`vIPI`, `vST`, `vFCPST`, `vSeg`, `vOutro`, `vFrete`, `vPIS`, `vCOFINS`, `vICMSDeson`).

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/estoque/nfe-xml.test.ts lib/estoque/nf-sefaz-mapa.test.ts lib/estoque/sefaz-distdfe.test.ts && npx tsc --noEmit`
Expected: PASS; `tsc` limpo.

- [ ] **Step 5: Commit**

```bash
git add lib/estoque/nfe-xml.ts lib/estoque/nfe-xml.test.ts lib/estoque/fixtures/nfe-crbs-131055.ts
git commit -m "feat(estoque-proprio): leitura completa do item da NF-e (impostos, vTotalItem, protocolo, assinatura)"
```

---

### Task 2: Validação do XML importado [B10, matriz A6]

**Files:**
- Create: `lib/estoque/nfe-validacao.ts`, `lib/estoque/nfe-validacao.test.ts`, `lib/estoque/nfe-assinatura.ts`

**Interfaces:**
- Consumes: `NfeLida` (Task 1, `import type`).
- Produces:
  - `export const TAMANHO_MAX_XML_BYTES = 1_000_000`
  - `validarXmlBruto(xml: string): string[]` (erros antes de ler: tamanho em bytes UTF-8, `<!DOCTYPE`, `<!ENTITY`)
  - `type ContextoValidacao = { cnpjLoja: string | null; assinaturaConfere: boolean | null }`
  - `validarNfeImportada(nfe: NfeLida, ctx: ContextoValidacao): { erros: string[]; avisos: string[] }`
  - `assinaturaConfere(xml: string): boolean | null` em `nfe-assinatura.ts` (servidor): `new SignedXml({ publicCert })` com o `X509Certificate` do próprio XML, `loadSignature`, `checkSignature(xml)`; `null` quando não há certificado para conferir; nunca lança.
- Textos exatos (erros): `'O arquivo passa de 1 MB.'`, `'O XML tem DOCTYPE/ENTITY: não é uma NF-e válida.'`, `'Este XML não tem o protocolo de autorização da SEFAZ (baixe o XML autorizado, procNFe).'`, `'A SEFAZ não autorizou esta nota (situação <cStat>).'`, `'O protocolo é de outra chave de acesso.'`, `'Nota de homologação (teste): não entra no estoque.'`, `'O XML não tem a assinatura digital do emitente.'`, `'Esta nota foi emitida pela própria loja.'`, `'A chave de acesso não é do CNPJ do emitente.'`, `'Não é NF-e (modelo <mod>): só notas modelo 55 entram aqui.'`. Avisos: `'A assinatura digital não confere com o conteúdo do XML.'`, `'O destinatário da nota não é o CNPJ desta loja.'`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
import { XML_CRBS_131055 } from './fixtures/nfe-crbs-131055.ts'
const ODARA = '66764497000122'
const ok = lerNfe(XML_CRBS_131055)
test('nota autorizada, assinada, de terceiro para a loja: sem erro', () => {
  assert.deepEqual(validarNfeImportada(ok, { cnpjLoja: ODARA, assinaturaConfere: true }), { erros: [], avisos: [] })
})
test('sem protocolo, situação 302 (denegada), protocolo de outra chave', () => {
  assert.ok(validarNfeImportada({ ...ok, protocolo: null }, { cnpjLoja: ODARA, assinaturaConfere: true }).erros[0].startsWith('Este XML não tem o protocolo'))
  assert.deepEqual(validarNfeImportada({ ...ok, protocolo: { ...ok.protocolo!, cStat: '302' } }, { cnpjLoja: ODARA, assinaturaConfere: true }).erros, ['A SEFAZ não autorizou esta nota (situação 302).'])
  assert.ok(validarNfeImportada({ ...ok, protocolo: { ...ok.protocolo!, cStat: '150' } }, { cnpjLoja: ODARA, assinaturaConfere: true }).erros.length === 0)
  assert.ok(validarNfeImportada({ ...ok, protocolo: { ...ok.protocolo!, chave: '1'.repeat(44) } }, { cnpjLoja: ODARA, assinaturaConfere: true }).erros.includes('O protocolo é de outra chave de acesso.'))
})
test('homologação, sem assinatura, emitida pela própria loja, chave de outro CNPJ, NFC-e', () => {
  const c = { cnpjLoja: ODARA, assinaturaConfere: true }
  assert.ok(validarNfeImportada({ ...ok, ambiente: '2' }, c).erros.includes('Nota de homologação (teste): não entra no estoque.'))
  assert.ok(validarNfeImportada({ ...ok, assinatura: { presente: false } }, c).erros.includes('O XML não tem a assinatura digital do emitente.'))
  assert.ok(validarNfeImportada({ ...ok, fornecedor: { ...ok.fornecedor, cnpj: ODARA } }, c).erros.includes('Esta nota foi emitida pela própria loja.'))
  assert.ok(validarNfeImportada({ ...ok, fornecedor: { ...ok.fornecedor, cnpj: '11222333000144' } }, c).erros.includes('A chave de acesso não é do CNPJ do emitente.'))
  assert.ok(validarNfeImportada({ ...ok, modelo: '65' }, c).erros.some((e) => e.startsWith('Não é NF-e (modelo 65)')))
})
test('avisos: assinatura que não confere e XML de terceiro', () => {
  assert.deepEqual(validarNfeImportada(ok, { cnpjLoja: ODARA, assinaturaConfere: false }).avisos, ['A assinatura digital não confere com o conteúdo do XML.'])
  assert.deepEqual(validarNfeImportada(ok, { cnpjLoja: '11111111000111', assinaturaConfere: null }).avisos, ['O destinatário da nota não é o CNPJ desta loja.'])
})
test('validarXmlBruto: DOCTYPE com ENTITY e tamanho', () => {
  assert.deepEqual(validarXmlBruto('<!DOCTYPE x [<!ENTITY a "b">]><nfeProc/>'), ['O XML tem DOCTYPE/ENTITY: não é uma NF-e válida.'])
  assert.deepEqual(validarXmlBruto('<a>' + 'é'.repeat(500_001) + '</a>'), ['O arquivo passa de 1 MB.'])
  assert.deepEqual(validarXmlBruto(XML_CRBS_131055), [])
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/estoque/nfe-validacao.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `nfe-validacao.ts` e `nfe-assinatura.ts`**

CNPJ da chave = `chave.slice(6, 20)`; modelo = `nfe.modelo ?? chave.slice(20, 22)`. Ordem dos erros = ordem da lista de textos acima. A ligação nas telas e no sync é a Task 7.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/estoque/nfe-validacao.test.ts && npx tsc --noEmit`
Expected: PASS (5 testes); `tsc` limpo.

- [ ] **Step 5: Commit**

```bash
git add lib/estoque/nfe-validacao.ts lib/estoque/nfe-validacao.test.ts lib/estoque/nfe-assinatura.ts
git commit -m "feat(estoque-proprio): validação do XML importado (protocolo, assinatura, ambiente, emitente)"
```

---

### Task 3: Custo do item com frete, seguro e CT-e separados, sem mudar o Omie [B1, B9; R3]

**Files:**
- Modify: `lib/compras/custo-estoque-item.ts`, `lib/compras/custo-estoque-item.test.ts`

**Interfaces:**
- Produces:
  - `EntradaCustoItem` ganha `vFrete?: number; vSeguro?: number; freteExterno?: number` (opcionais).
  - `entradaCustoDoItem` lê esses três de `fullObject.sefaz.vFrete`, `.vSeg`, `.freteCte` só quando `sefaz` é objeto (item do Omie não tem: os três ficam `undefined`).
  - Regra nova (só quando algum dos três vem definido): `outras = max(0, despesas − vFrete − vSeguro)`; tira `vFrete` se `cFreteCusto='N'`, `vSeguro` se `cSeguroCusto='N'`, `outras` se `cOutrosDespCusto='N'`; soma `freteExterno` se `cFreteCusto='S'`. Sem os três: exatamente o cálculo da Fase A.
  - `custoUnitarioEntrada(valorEstoque: number, quantidadeRecebida: number): number | null` (6 casas; `null` se quantidade ≤ 0).

- [ ] **Step 1: Escrever os testes que falham** (os 11 da Fase A ficam como estão)

```ts
const N8 = { ...N } // N da Fase A: tudo 'N', alíquotas 0
test('Omie: sem bloco sefaz, Frete/Seguro não mudam nada (ÁGUA 131055, kardex 120 × 1,358333)', () => {
  const base = { itensCabec: { vTotalItem: 176.41, vDesconto: 0 }, itensCustoEstoque: N8 }
  assert.equal(custoEstoqueItemOmie(entradaCustoDoItem(base, 10, 16.299516)).valorEstoque, 163)
  assert.equal(custoEstoqueItemOmie(entradaCustoDoItem({ ...base, itensCustoEstoque: { ...N8, cFreteCusto: 'S', cSeguroCusto: 'S' } }, 10, 16.299516)).valorEstoque, 163)
})
test('próprio: frete e seguro do item seguem as suas marcações; outras despesas = o resto (HIPÓTESE N3b)', () => {
  const fo = { itensCabec: { vTotalItem: 115, vDesconto: 0 }, itensCustoEstoque: { ...N8, cFreteCusto: 'S' }, sefaz: { vFrete: 10, vSeg: 2 } }
  assert.equal(custoEstoqueItemOmie(entradaCustoDoItem(fo, 1, 100)).valorEstoque, 110) // tira seguro 2 e outras 3
})
test('CT-e entra só com Frete = S (HIPÓTESE N8)', () => {
  const fo = (f: string) => ({ itensCabec: { vTotalItem: 100, vDesconto: 0 }, itensCustoEstoque: { ...N8, cFreteCusto: f }, sefaz: { vFrete: 0, vSeg: 0, freteCte: 12.5 } })
  assert.equal(custoEstoqueItemOmie(entradaCustoDoItem(fo('S'), 1, 100)).valorEstoque, 112.5)
  assert.equal(custoEstoqueItemOmie(entradaCustoDoItem(fo('N'), 1, 100)).valorEstoque, 100)
})
test('custo unitário = valor de estoque ÷ quantidade recebida (NF 131055 e entrega parcial da NF 4010)', () => {
  assert.equal(custoUnitarioEntrada(163, 120), 1.358333)
  assert.equal(custoUnitarioEntrada(632.6, 96), 6.589583)
  assert.equal(custoUnitarioEntrada(39.87, 12), 3.3225)
  assert.equal(custoUnitarioEntrada(3063.41, 37.888369), 80.853573)
  assert.equal(custoUnitarioEntrada(10, 0), null)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/compras/custo-estoque-item.test.ts`
Expected: os 11 antigos PASS; os 4 novos FAIL.

- [ ] **Step 3: Implementar** (regra da seção Interfaces; comentário no código citando R3 e a hipótese N3b/N8).

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/compras/custo-estoque-item.test.ts lib/relatorio-compras-visoes.test.ts lib/notas-compras.test.ts && npx tsc --noEmit`
Expected: PASS (15 testes no arquivo); `tsc` limpo.

- [ ] **Step 5: Commit**

```bash
git add lib/compras/custo-estoque-item.ts lib/compras/custo-estoque-item.test.ts
git commit -m "feat(compras): custo do item com frete, seguro e CT-e separados só na nota própria; custo pela quantidade recebida"
```

---

### Task 4: Regras do item — marcações, CFOP de entrada, unidade e fator, avisos [B1, B2, B4, B5; R1, R4, R6, R7]

**Files:**
- Create: `lib/estoque/nf-item-regras.ts`, `lib/estoque/nf-item-regras.test.ts`

**Interfaces:**
- Consumes: `custoEstoqueItemOmie`, `custoUnitarioEntrada` (Task 3) e `unidadeCanonica` (`nf-conferencia.ts`) pelo padrão `// @ts-ignore` + `.ts`; `type FlagsCustoOmie`.
- Produces:
  - `type FlagsCusto = { icms: boolean; icmsSt: boolean; ipi: boolean; seguro: boolean; pis: boolean; cofins: boolean; frete: boolean; outras: boolean }`; `ORDEM_FLAGS` (essa ordem); `flagsDeTexto(s: string): FlagsCusto | null` (`'NSSNNNNN'`; `'-'` = N); `flagsParaTexto(f: FlagsCusto): string`; `flagsParaOmie(f: FlagsCusto, aliqPis: number, aliqCofins: number): FlagsCustoOmie`.
  - `type OrigemFlags = 'produto' | 'fornecedor' | 'regra' | 'padrao' | 'manual'`
  - `REGRA_FLAGS_CST = { '00': 'NNNNNNNN', '10': 'SSSSSSSS', '20': 'SSSSSSSS', '40': 'NSSNNNNN', '41': 'NNNNNNNN', '60': 'NNNNNNNN', '61': 'NNNNNNNN', '90': 'SSSNSSNN' }`, `REGRA_FLAGS_CSOSN = { '102': 'SSSNSSNN', '103': 'NNNNNNNN', '300': 'NSSNNNNN', '400': 'NSSNNNNN', '900': 'NNNNNNNN' }`, `FLAGS_PADRAO = 'NNNNNNNN'` (moda de D1 por código; comentário com as contagens: CST 60 462/587, 40 576/1035, 00 233/608, 20 116/347, 41 52/101, 90 16/33; CSOSN 102 36/87, 400 28/67, 300 47/66; 10, 103 e 900 de um recebimento capturado cada: NF 360369, 115, 7433).
  - `sugerirFlagsCusto(e: { memoriaProduto: string | null; memoriaFornecedor: string | null; crt: string | null; cst: string | null; csosn: string | null }): { flags: FlagsCusto; origem: OrigemFlags }` — CRT 1/2/4 usa CSOSN; CRT 3 usa CST; sem CRT, o código que vier.
  - `CFOP_ENTRADA_TABELA = { '5101': '1102', '5102': '1102', '5103': '1102', '5403': '1403', '5405': '1407', '5656': '1653', '5910': '1910', '5929': '1556' }`; `sugerirCfopEntrada(e: { cfopNota: string | null; memoriaProduto: string | null }): { cfop: string | null; origem: 'produto' | 'tabela' | 'regra' | null }`; `cfopValido(s: string): boolean` (`^[123]\d{3}$`); `formatarCfop(d: string | null): string | null`.
  - `UNIDADES_ESTOQUE: readonly { sigla: string; nome: string; grupo: 'contagem' | 'massa' | 'volume' | 'embalagem' }[]` (UN, KG, G, L, ML, CX, FD, PCT, DZ, BD, SC, GL, LATA, GF, PC, RL, BN — nomes da lista do Omie, cid 72); `grupoUnidade(u: string | null): string | null` (ignora dígitos no fim da sigla, como os `UND9`, `KG9`, `GFA8` do Omie; `GF`/`GFA` = garrafa, contagem); `fatorConhecido(de: string, para: string): number | null` (mesma unidade 1; KG→G 1000; G→KG 0,001; L→ML 1000; ML→L 0,001; DZ→UN 12).
  - `type AlertaItem = { tipo: 'fator_suspeito' | 'custo_fora' | 'recebido_menor' | 'recebido_maior' | 'valor_zero' | 'complementar'; texto: string }`
  - `alertasDoItem(e: { unidadeNota: string; unidadeEstoque: string | null; fator: number; quantidadeNota: number; quantidadeRecebida: number; custoUnitario: number | null; cmcAtual: number | null; valorTotalItem: number; finalidade: string | null }): AlertaItem[]` — `fator_suspeito`: fator 1 entre grupos diferentes, ou fator ≠ `fatorConhecido`; `custo_fora`: `cmcAtual > 0` e custo ≥ 20× ou ≤ 1/20 dele, ou custo ≥ R$ 1.000 (mesmos limites da Central); `recebido_menor`/`maior`: recebida ≠ nota × fator (tolerância 1e-6); `valor_zero`: `valorTotalItem ≤ 0`; `complementar`: finalidade 2 ou 3.
  - `type ConfigInicialItem = { flags: FlagsCusto; origemFlags: OrigemFlags; cfopEntrada: string | null; origemCfop: 'produto' | 'tabela' | 'regra' | null; movimentaEstoque: boolean; geraContaPagar: boolean; unidadeEstoque: string | null; codigoLocal: number | null; aliqCredPis: 0; aliqCredCofins: 0 }`; `configInicialItem(e: { item: { cfop: string | null; valorTotalItem: number; fiscal: { cst: string | null; csosn: string | null } }; crt: string | null; finalidade: string | null; memoriaProduto: MemoriaItem | null; memoriaFornecedor: MemoriaItem | null; unidadeProduto: string | null; localNota: number | null }): ConfigInicialItem`, com `type MemoriaItem = { flags: string | null; cfopEntrada: string | null; codigoLocal: number | null }`.
  - `type ConfigItemNF = { codigoLocal?: number | null; cfopEntrada?: string | null; quantidadeRecebida?: number | null; unidadeEstoque?: string | null; flags?: FlagsCusto; aliqCredPis?: number; aliqCredCofins?: number; movimentaEstoque?: boolean; geraContaPagar?: boolean }`; `validarConfigItem(c: ConfigItemNF): string | null`.
  - `previaCustoItem(e: { quantidadeNota: number; precoUnit: number; valorTotalItem: number; desconto: number; ipi: number; st: number; icms: number; frete: number; seguro: number; freteCte: number; flags: FlagsCusto; aliqCredPis: number; aliqCredCofins: number; quantidadeRecebida: number }): { valorEstoque: number; custoUnitario: number | null }` (monta a entrada e chama `custoEstoqueItemOmie`).

- [ ] **Step 1: Escrever os testes que falham** (valores das capturas `nf-*`)

```ts
test('memória do produto vence a regra: BATATA FLORÃO (NF 947490 e 956433, SSSSSSSS) com CST 40', () => {
  const r = sugerirFlagsCusto({ memoriaProduto: 'SSSSSSSS', memoriaFornecedor: 'NSSNNNNN', crt: '3', cst: '40', csosn: null })
  assert.equal(flagsParaTexto(r.flags), 'SSSSSSSS'); assert.equal(r.origem, 'produto')
  assert.equal(sugerirFlagsCusto({ memoriaProduto: null, memoriaFornecedor: 'SSSNSSNN', crt: '3', cst: '40', csosn: null }).origem, 'fornecedor')
})
test('regra pela moda de D1', () => {
  const t = (cst: string | null, csosn: string | null, crt: string | null) => { const r = sugerirFlagsCusto({ memoriaProduto: null, memoriaFornecedor: null, crt, cst, csosn }); return [flagsParaTexto(r.flags), r.origem] }
  assert.deepEqual(t('60', null, '3'), ['NNNNNNNN', 'regra'])   // ÁGUA da CRBS, NF 131055
  assert.deepEqual(t('40', null, '3'), ['NSSNNNNN', 'regra'])   // ABOBRINHA, NF 956433
  assert.deepEqual(t(null, '102', '1'), ['SSSNSSNN', 'regra'])
  assert.deepEqual(t('20', null, '3'), ['SSSSSSSS', 'regra'])
  assert.deepEqual(t('51', null, '3'), ['NNNNNNNN', 'padrao'])  // sem caso em D1
  assert.deepEqual(t(null, null, null), ['NNNNNNNN', 'padrao'])
})
test('flagsDeTexto / flagsParaOmie', () => {
  assert.equal(flagsDeTexto('NNN-NN--')!.seguro, false); assert.equal(flagsDeTexto('xx'), null)
  assert.deepEqual(flagsParaOmie(flagsDeTexto('NSSNNNNN')!, 0, 0), { cICMSCusto: 'N', cICMSSTCusto: 'S', cIPICusto: 'S', cSeguroCusto: 'N', cPISCusto: 'N', cCOFINSCusto: 'N', cFreteCusto: 'N', cOutrosDespCusto: 'N', nAliqCredPISCusto: 0, nAliqCredCOFINSCusto: 0 })
})
test('CFOP de entrada: memória, tabela (moda D1), regra', () => {
  assert.deepEqual(sugerirCfopEntrada({ cfopNota: '5405', memoriaProduto: '1403' }), { cfop: '1403', origem: 'produto' }) // CRBS NF 131055
  assert.deepEqual(sugerirCfopEntrada({ cfopNota: '5405', memoriaProduto: null }), { cfop: '1407', origem: 'tabela' })
  assert.deepEqual(sugerirCfopEntrada({ cfopNota: '5102', memoriaProduto: null }), { cfop: '1102', origem: 'tabela' })
  assert.deepEqual(sugerirCfopEntrada({ cfopNota: '6102', memoriaProduto: null }), { cfop: '2102', origem: 'regra' })
  assert.equal(formatarCfop('1403'), '1.403'); assert.equal(cfopValido('5102'), false); assert.equal(cfopValido('1910'), true)
})
test('fator suspeito e custo fora: TEQUILA PRATA da NF 189215 (1 UND8 → 1 ML a R$ 139,90)', () => {
  const prata = alertasDoItem({ unidadeNota: 'UND8', unidadeEstoque: 'ML', fator: 1, quantidadeNota: 1, quantidadeRecebida: 1, custoUnitario: 139.9, cmcAtual: 0.186533, valorTotalItem: 139.9, finalidade: '1' })
  assert.deepEqual(prata.map((a) => a.tipo), ['fator_suspeito', 'custo_fora'])
  const ouro = alertasDoItem({ unidadeNota: 'UND8', unidadeEstoque: 'ML', fator: 750, quantidadeNota: 1, quantidadeRecebida: 750, custoUnitario: 0.186533, cmcAtual: 0.186533, valorTotalItem: 139.9, finalidade: '1' })
  assert.deepEqual(ouro, [])
  assert.equal(alertasDoItem({ unidadeNota: 'KG', unidadeEstoque: 'G', fator: 1, quantidadeNota: 2, quantidadeRecebida: 2, custoUnitario: 4, cmcAtual: null, valorTotalItem: 8, finalidade: '1' })[0].tipo, 'fator_suspeito')
  assert.deepEqual(alertasDoItem({ unidadeNota: 'CX', unidadeEstoque: 'UN', fator: 12, quantidadeNota: 10, quantidadeRecebida: 120, custoUnitario: 1.358333, cmcAtual: 1.35, valorTotalItem: 176.41, finalidade: '1' }), [])
})
test('entrega parcial: PEIXE 40,9 KG → 37,888369 KG (NF 4010)', () => {
  const a = alertasDoItem({ unidadeNota: 'KG', unidadeEstoque: 'KG', fator: 1, quantidadeNota: 40.9, quantidadeRecebida: 37.888369, custoUnitario: 80.853573, cmcAtual: 76, valorTotalItem: 3063.41, finalidade: '1' })
  assert.deepEqual(a.map((x) => x.tipo), ['recebido_menor'])
})
test('NF complementar e item de valor zero nascem sem movimentar estoque (NF 7433: 1 UN, R$ 0,00, ICMS 305,23)', () => {
  const c = configInicialItem({ item: { cfop: '5101', valorTotalItem: 0, fiscal: { cst: null, csosn: '900' } }, crt: '1', finalidade: '2', memoriaProduto: null, memoriaFornecedor: null, unidadeProduto: 'UN', localNota: 10 })
  assert.equal(c.movimentaEstoque, false); assert.equal(c.geraContaPagar, true); assert.equal(c.cfopEntrada, '1102')
  assert.equal(configInicialItem({ item: { cfop: '5405', valorTotalItem: 77.27, fiscal: { cst: '60', csosn: null } }, crt: '3', finalidade: '1', memoriaProduto: null, memoriaFornecedor: null, unidadeProduto: 'UN', localNota: 10 }).movimentaEstoque, true)
})
test('configInicialItem usa o local da memória do produto (bar × cozinha) e cai no da nota', () => {
  const m = { flags: 'NSSNNNNN', cfopEntrada: '1102', codigoLocal: 2746972605 }
  assert.equal(configInicialItem({ item: { cfop: '5102', valorTotalItem: 33, fiscal: { cst: '00', csosn: null } }, crt: '3', finalidade: '1', memoriaProduto: m, memoriaFornecedor: null, unidadeProduto: 'KG', localNota: 2746972551 }).codigoLocal, 2746972605)
  assert.equal(configInicialItem({ item: { cfop: '5102', valorTotalItem: 33, fiscal: { cst: '00', csosn: null } }, crt: '3', finalidade: '1', memoriaProduto: null, memoriaFornecedor: null, unidadeProduto: 'KG', localNota: 2746972551 }).codigoLocal, 2746972551)
})
test('validarConfigItem', () => {
  assert.equal(validarConfigItem({ cfopEntrada: '1403', quantidadeRecebida: 120, aliqCredPis: 1.65 }), null)
  assert.ok(validarConfigItem({ cfopEntrada: '5102' })); assert.ok(validarConfigItem({ quantidadeRecebida: 0 })); assert.ok(validarConfigItem({ aliqCredCofins: 101 }))
})
test('previaCustoItem bate com o kardex do Omie (NF 131055, Long Corona: 96 × 6,589583)', () => {
  const p = previaCustoItem({ quantidadeNota: 4, precoUnit: 158.149101, valorTotalItem: 706.35, desconto: 0, ipi: 20.04, st: 0, icms: 0, frete: 0, seguro: 0, freteCte: 0, flags: flagsDeTexto('NNNNNNNN')!, aliqCredPis: 0, aliqCredCofins: 0, quantidadeRecebida: 96 })
  assert.deepEqual(p, { valorEstoque: 632.6, custoUnitario: 6.589583 })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/estoque/nf-item-regras.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `lib/estoque/nf-item-regras.ts`** (assinaturas e tabelas acima; regra do CFOP: troca o 1º dígito 5→1, 6→2, 7→3 e os finais 101/102/103 → 102, 401/403/405 → 403).

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/estoque/nf-item-regras.test.ts lib/estoque/nf-conferencia.test.ts && npx tsc --noEmit`
Expected: PASS (11 testes); `tsc` limpo.

- [ ] **Step 5: Commit**

```bash
git add lib/estoque/nf-item-regras.ts lib/estoque/nf-item-regras.test.ts
git commit -m "feat(estoque-proprio): regras do item da nota (marcações sugeridas, CFOP de entrada, fator, avisos)"
```

---

### Task 5: Migration 184 — esquema (só aditivo) [B1–B9]

**Files:**
- Create: `supabase/migrations/184_entrada_nf_schema.sql`, `scripts/testes-sql/184_entrada_nf_schema.sql`

**Interfaces:**
- Produces (SQL, tudo `if not exists`, numa transação):
  - `compras_proprio_itens` + `valor_total_item numeric(18,4)` (nulo = item antigo/manual), `ipi_valor`, `st_valor`, `fcp_st_valor`, `frete_valor`, `seguro_valor`, `outras_valor`, `frete_cte` (`numeric(18,4) not null default 0`), `fiscal jsonb`, `codigo_local_estoque bigint`, `cfop_entrada text check (cfop_entrada is null or cfop_entrada ~ '^[123][0-9]{3}$')`, `origem_cfop text check (in 'produto','tabela','regra','manual')`, `quantidade_recebida numeric(18,6) check (null or > 0)`, `unidade_estoque text`, `custo_icms`, `custo_icms_st`, `custo_ipi`, `custo_seguro`, `custo_pis`, `custo_cofins`, `custo_frete`, `custo_outras boolean` (nulo = sem marcações), `aliq_cred_pis`, `aliq_cred_cofins numeric(7,4) not null default 0 check (0..100)`, `origem_flags text check (in 'produto','fornecedor','regra','padrao','manual')`, `movimenta_estoque boolean not null default true`, `gera_conta_pagar boolean not null default true`; constraint `compras_proprio_itens_flags_todas` (as 8 nulas juntas ou preenchidas juntas).
  - `compras_proprio` + `conferida_em timestamptz`, `conferida_por text`.
  - `compras_proprio_eventos (id bigint identity pk, loja_id bigint not null references lojas, compra_id bigint not null references compras_proprio on delete cascade, tipo text not null check (tipo in ('criada','item_configurado','item_vinculado','conferida','lancada','estornada','cte_vinculado','cte_desvinculado','cancelada','recusada','observacao')), linha int, detalhe jsonb, user_id text, criado_em timestamptz not null default now())` + índice `(compra_id, id)`.
  - `sefaz_manifestacoes (id bigint identity pk, loja_id, chave text not null check (chave ~ '^[0-9]{44}$'), tp_evento text not null check (in '210200','210210','210220','210240'), status text not null check (in 'enviando','registrada','recusada','incerta'), cstat text, xmotivo text, protocolo text, justificativa text, user_id text, criado_em timestamptz default now(), respondido_em timestamptz)` + `unique index sefaz_manifestacoes_conclusiva_uq on (loja_id, chave) where tp_evento <> '210210' and status in ('enviando','registrada')`.
  - `sefaz_busca_chave (loja_id bigint references lojas, chave text, ultima_em timestamptz not null, cstat text, primary key (loja_id, chave))`.
  - `compras_proprio_cte (id bigint identity pk, loja_id, chave text check (null or 44 dígitos), numero text, serie text, emissao date, transportadora_cnpj text, transportadora_nome text, valor numeric(18,2) not null check (valor > 0), icms numeric(18,2) not null default 0, cfop text, origem text not null check (in 'xml','manual'), xml text, user_id text, criado_em timestamptz default now(), unique (loja_id, chave))` e `compras_proprio_cte_compra (cte_id bigint references compras_proprio_cte on delete cascade, compra_id bigint references compras_proprio on delete cascade, loja_id bigint not null, valor numeric(18,2) not null, percentual numeric(7,4) not null, primary key (cte_id, compra_id))`.
  - RLS nas 5 tabelas novas: `select` no padrão initplan, `revoke all … from anon, authenticated`, `grant select … to authenticated`, `grant all … to service_role`.
  - `insert into permissoes (nome) values ('Notas Fiscais - Manifestar na SEFAZ') on conflict (nome) do nothing`.

- [ ] **Step 1: Escrever o teste SQL que falha** (cópia local: Postgres 17 em Docker com `pg_dump --schema-only -n public` da produção, com a Fase A já dentro)

`scripts/testes-sql/184_entrada_nf_schema.sql` (`do $$ … $$`, `raise exception` na 1ª diferença): (a) o `insert` em `compras_proprio_itens` só com as colunas da 135 funciona e deixa `movimenta_estoque = true`, `custo_icms is null`, `valor_total_item is null`; (b) `cfop_entrada = '5102'` falha com `check_violation`; (c) só `custo_icms` preenchido falha (`compras_proprio_itens_flags_todas`); (d) duas linhas `('enviando', '210200')` para a mesma chave falham com `unique_violation`, e `('registrada','210210')` + `('enviando','210200')` passam; (e) `select count(*) from pg_policies where tablename in (<as 5>)` = 5. `raise notice '184 OK'`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `docker exec -i pg-teste psql -v ON_ERROR_STOP=1 -U postgres < scripts/testes-sql/184_entrada_nf_schema.sql`
Expected: FAIL (`column "movimenta_estoque" does not exist`).

- [ ] **Step 3: Escrever a 184** (comentário no topo: aditiva, código velho não muda; aplicar antes da 185; `begin; … commit; notify pgrst, 'reload schema';`).

- [ ] **Step 4: Rodar e ver passar**

Run: aplicar a 184 na cópia local e rodar o teste do Step 1; rodar também `scripts/testes-sql/181_compra_manual_idempotente.sql` e `180_nf_cancelada_proprio.sql`.
Expected: `NOTICE: 184 OK`; os testes da Fase A continuam OK.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/184_entrada_nf_schema.sql scripts/testes-sql/184_entrada_nf_schema.sql
git commit -m "feat(estoque-proprio): esquema da entrada de nota completa (item, eventos, manifestação, CT-e) — migration 184"
```

---

### Task 6: Migration 185 — projeção, memória e lançamento por item [B1–B5, B8; R2–R7, R9, R10, R12]

**Files:**
- Create: `supabase/migrations/185_entrada_nf_funcoes.sql`, `scripts/testes-sql/185_entrada_nf_funcoes.sql`

**Interfaces:**
- Consumes: esquema da 184 (Task 5); `custo_estoque_item_omie`, `lancar_compra` (corpo de produção da 181, por `pg_get_functiondef`), `registrar_compra_sefaz`, `vincular_item_compra`, `estornar_compra`, `sincronizar_situacao_nota` (corpos de produção).
- Produces (SQL, numa transação; funções existentes com a MESMA assinatura):
  - `custo_estoque_item_omie(p_fo jsonb, p_qtde numeric, p_preco numeric) returns numeric` — corpo da 175 + o ramo da Task 3 lendo `p_fo->'sefaz'->>'vFrete'`, `'vSeg'`, `'freteCte'` (ausentes = cálculo da 175).
  - `item_compra_full_object(i compras_proprio_itens, p_local_compra bigint) returns jsonb` (stable). Saída (só para item com `valor_total_item` não nulo):
    ```
    itensCabec { vTotalItem: valor_total_item, vDesconto: desconto }
    itensICMS { cSitTrib: fiscal->>'cst', cOrigem, nBC, nAliq, nValor: coalesce(icms, crédito do Simples quando CSOSN 101/201 — HIPÓTESE) }
    itensICMSSN { cSitTribSN: fiscal->>'csosn' }   (só quando há CSOSN)
    itensICMSST { nBCST, nValorST: st_valor + fcp_st_valor }   (FCP-ST junto da ST: HIPÓTESE)
    itensIPI { cSitTribIPI, nValIPI: ipi_valor }  itensPIS { cSitTribPIS, nValPIS }  itensCOFINS { cSitTribCOFINS, nValCOFINS }
    itensAjustes { nQtdeRecebida: coalesce(quantidade_recebida, quantidade*fator), cUnidade: unidade_estoque,
                   cCFOPEntrada: '1.102' (formatado), codigo_local_estoque: coalesce(item, p_local_compra),
                   cNaoGerarFinanceiro: S/N, cNaoGerarMovEstoque: S/N }
    itensCustoEstoque { cICMSCusto … cOutrosDespCusto: S/N, nAliqCredPISCusto, nAliqCredCOFINSCusto }   (só se as marcações existem)
    sefaz { icms: icms_valor, vFrete: frete_valor, vSeg: seguro_valor, vOutro: outras_valor, freteCte: frete_cte, origemFlags: origem_flags }
    ```
  - `projetar_itens_compra_na_nota(p_compra bigint) returns int` — para cada item com `valor_total_item` e a linha de `nota_fiscal_items` da nota da compra (`n_sequencia = linha`): `full_object` = antigo com cada bloco da projeção substituído, menos `itensCabec`, que é `antigo->itensCabec || novo->itensCabec`. Devolve linhas tocadas. Compra sem nota: 0.
  - `memoria_itens_compra(p_loja bigint, p_cnpj text, p_produtos bigint[], p_cprods text[]) returns table(tipo text, chave text, flags text, cfop_entrada text, codigo_local_estoque bigint)` — último item LANÇADO com marcações, por produto (`tipo='produto'`, `chave = codigo_produto::text`) e por código do fornecedor (`tipo='fornecedor'`, `chave = c_prod`), `distinct on (…) order by … , i.id desc`; `flags` = as 8 colunas em texto `S/N` na ordem R1.
  - `registrar_compra_sefaz(jsonb, bigint) returns jsonb` — corpo de produção + os campos novos do item (`valor_total_item`, `ipi_valor`, `st_valor`, `fcp_st_valor`, `frete_valor`, `seguro_valor`, `outras_valor`, `fiscal`, `codigo_local_estoque`, `cfop_entrada`, `origem_cfop`, `unidade_estoque`, `custo_flags` texto, `aliq_cred_pis`, `aliq_cred_cofins`, `origem_flags`, `movimenta_estoque`, `gera_conta_pagar`); no conflito `(compra_id, linha)` de item não lançado: valores fiscais vêm da nota nova, configuração fica `coalesce(atual, nova)`; evento `criada` na compra nova; no fim `projetar_itens_compra_na_nota`.
  - `configurar_item_compra(p_loja bigint, p_item bigint, p_cfg jsonb, p_user text default null) returns jsonb` (nova) — trava o item; recusa item lançado; valida local (da loja, sem `deleted_at`, ativo), CFOP, quantidade, alíquotas; grava só as chaves presentes em `p_cfg` (`codigo_local_estoque`, `cfop_entrada`, `quantidade_recebida`, `unidade_estoque`, `custo_flags`, `aliq_cred_pis`, `aliq_cred_cofins`, `movimenta_estoque`, `gera_conta_pagar`); marcações → `origem_flags='manual'`, CFOP → `origem_cfop='manual'`; zera `compras_proprio.conferida_em`; evento `item_configurado` com `{de, para}`; projeta; devolve `{ok, compra_id, nota_id}`.
  - `marcar_compra_conferida(p_loja bigint, p_compra bigint, p_user text default null, p_detalhe jsonb default '{}') returns jsonb` (nova) — compra `pendente`/`parcial`; pendências por item não lançado que movimenta estoque: `sem_produto`, `local_invalido`, `quantidade_zero`; com pendência devolve `{ok:false, pendencias:[{linha, motivo}]}` sem gravar; senão grava `conferida_em/por`, evento `conferida` com `p_detalhe` (avisos aceitos), `sincronizar_situacao_nota`.
  - `vincular_item_compra(bigint,bigint,bigint,numeric,text)` — corpo de produção + `unidade_estoque = coalesce(unidade_estoque, produtos.unidade)`, zera `conferida_em`, evento `item_vinculado`, projeta.
  - `lancar_compra(jsonb, bigint, text)` — corpo da 181 com o laço abaixo, o guarda de manifestação negativa e os eventos.
  - `estornar_compra(bigint, text)` — corpo de produção + evento `estornada` + projeção.
  - `sincronizar_situacao_nota(bigint, bigint) returns text` — corpo de produção com a ordem: cancelada/`estornada` → `lancada` → `parcial` → `recusada` (210220/210240 registrada) → `conferida` (`conferida_em` não nulo) → `divergente` → `a_conferir`; `resumo` como hoje.

Laço de itens do novo `lancar_compra` (o resto do corpo da 181 fica igual):
```
-- 185: manifestação negativa registrada = não entra (antes do laço)
if v_comp.chave_acesso is not null and exists (select 1 from sefaz_manifestacoes where loja_id = v_loja
     and chave = v_comp.chave_acesso and tp_evento in ('210220','210240') and status = 'registrada') then
  return {ok:false, compra_id, status:'recusada', lancados:0, pendentes:0, duplicado:false, motivo:'operação recusada na SEFAZ'}
for it in itens order by linha:
  if it.lancado: v_ja++; continue
  if not it.movimenta_estoque: v_ign++; saída {linha, ok:true, ignorado:true}; continue
  v_local := coalesce(it.codigo_local_estoque, p_local)
  if v_local não é local ativo da loja: v_pend++; motivo 'local_invalido'; continue
  v_qtd := coalesce(it.quantidade_recebida, it.quantidade * it.fator)
  (sem produto / quantidade zero / produto inexistente: como na 181)
  if it.valor_total_item is null:                      -- caminho antigo (compra antiga, manual): fórmula da 181, intacta
    v_custo_total := (valor_total − desconto) + valor_frete·share − valor_desconto·share − (icms_recuperavel ? icms_valor : 0)
  else
    v_custo_total := custo_estoque_item_omie(item_compra_full_object(it, p_local), it.quantidade, it.valor_unitario)
  v_custo_unit := round(v_custo_total / v_qtd, 6)
  r := registrar_movimento(v_loja, v_local, it.codigo_produto, 'ENT', 'COMPRA', v_ref, v_qtd, v_custo_unit>0 ? v_custo_unit : null, p_user, 'Compra '||numero, it.linha, null, null, null)
  (update do item, de-para e saída: como na 181)
status: resolvidos = v_lanc + v_ja + v_ign
  'pendente' se (v_lanc + v_ja) = 0 e v_ign < v_nitens; 'lancada' se resolvidos = v_nitens; senão 'parcial'
evento 'lancada' {lancados, ignorados, pendentes} quando v_lanc > 0; projetar_itens_compra_na_nota; devolve também 'ignorados'
```

- [ ] **Step 1: Escrever o teste SQL que falha** (cópia local com 184 e 185; loja `proprio` de teste com os locais 2746972551 "01 - BAR" e 2746972605 "02 - COZINHA" e produtos com unidade UN/KG)

Cenários (`raise exception` na 1ª diferença):
- **A — NF 131055 por item:** compra SEFAZ com 3 itens (Água: 10 CX, 16,299516, `valor_total_item` 176,41, `outras_valor` 13,41, marcações `NNNNNNNN`, recebida 120; Corona: 4 CX, 158,149101, 706,35, IPI 20,04, outras 53,71, `NNNNNNNN`, recebida 96; Tônica Diet: 1 CX, 36,07555, 39,87, IPI 0,76, outras 3,03, `SSSSSSSS`, recebida 12, local COZINHA); `lancar_compra(…, p_local => BAR)` → `custo_unitario` 1.358333, 6.589583, 3.3225 em `estoque_movimentos`; saldo 120 e 96 no BAR, 12 na COZINHA; `status='lancada'`; `nota_fiscal_items.full_object->'itensAjustes'->>'cCFOPEntrada'` = `'1.403'` e `codigo_local_estoque` da Tônica = 2746972605.
- **B — entrega parcial (NF 4010):** 40,9 KG a 74,9 com `valor_total_item` 3063,41, recebida 37,888369 → movimento de 37,888369 a 80.853573.
- **C — caminho antigo igual à 181:** compra com os 2 itens da fixture antiga de `nfe-xml.test.ts` sem `valor_total_item` (190 e 100 líquidos, frete 30, desconto da nota 5, fator 1) → custos 103.189655 e 108.62069 (os mesmos da 181).
- **D — complementar/valor zero:** item `movimenta_estoque=false` (NF 7433) sozinho → 0 movimentos, `status='lancada'`, `ignorados=1`; com outro item normal → os dois resolvidos.
- **E — local inválido:** item com local excluído (`deleted_at`) → pendente `local_invalido`; o outro entra; `status='parcial'`.
- **F — reimportar mantém a configuração manual:** `configurar_item_compra` (local COZINHA, CFOP `1102`, marcações `SSSSSSSS`), depois `gravar_nota_sefaz` + `registrar_compra_sefaz` da mesma chave com sugestões diferentes → colunas do item iguais às do `configurar`, `origem_flags='manual'`, e `nota_fiscal_items.full_object->'itensCustoEstoque'->>'cICMSCusto' = 'S'` de novo.
- **G — manifestação negativa:** linha `('210240','registrada')` na chave → `lancar_compra` devolve `status='recusada'` e 0 movimentos; `sincronizar_situacao_nota` = `'recusada'`.
- **H — conferência:** `marcar_compra_conferida` com item sem produto → `ok=false`, `pendencias=[{linha:2, motivo:'sem_produto'}]`; ligado o produto → `ok=true` e situação `'conferida'`; `configurar_item_compra` depois → `conferida_em` nulo e situação `'a_conferir'`.
- **I — Omie intacto:** os 7 casos `jsonb` do `scripts/testes-sql/175_custo_estoque_item_omie.sql` dão os mesmos valores com a função nova.
- **J — eventos:** a compra do cenário A tem eventos `criada`, `lancada` nessa ordem; o de H tem `item_vinculado`, `conferida`, `item_configurado`.
`raise notice '185 OK'`.

- [ ] **Step 2: Rodar e ver falhar**

Run: o teste na cópia local com só a 184 aplicada.
Expected: FAIL (`function item_compra_full_object(...) does not exist`).

- [ ] **Step 3: Escrever a 185** — partir de `pg_get_functiondef` de produção de cada função recriada (não do arquivo do repositório); `begin; … commit; notify pgrst, 'reload schema';`; `revoke all … from public, anon, authenticated` + `grant execute … to service_role` nas novas (`custo_estoque_item_omie` mantém o `grant` a `authenticated` da 175).

- [ ] **Step 4: Rodar e ver passar**

Run: aplicar a 185 na cópia local; rodar o teste do Step 1 e os da Fase A (`175_*`, `180_*`, `181_*`, `182_*`) e `validade_lotes.sql`.
Expected: `NOTICE: 185 OK`; os demais OK (a compra manual com lotes continua igual).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/185_entrada_nf_funcoes.sql scripts/testes-sql/185_entrada_nf_funcoes.sql
git commit -m "feat(estoque-proprio): entrada por item (custo N3, local, quantidade recebida, CFOP, movimenta) e projeção no formato do Omie — migration 185"
```

---

### Task 7: Nota gravada com sugestões e validação (SEFAZ, upload de XML) [B1–B5, B10; R9, R11]

**Files:**
- Modify: `lib/estoque/nf-sefaz-mapa.ts` (+ `.test.ts`), `lib/estoque/nf-sefaz.ts`, `lib/estoque/sefaz-sync.ts:39-55` (`processarDocumento`, ramo `procNFe`), `lib/actions/compras-proprio.ts` (`previaXml`, `lancarCompraXml`, `Mapeamento`)
- Create: `lib/estoque/nf-memoria.ts`
- Modify: `lib/estoque/nf-item-regras.ts` (+ teste) — `podeLancarSozinho`

**Interfaces:**
- Consumes: Tasks 1–4; RPCs `memoria_itens_compra`, `registrar_compra_sefaz` (Task 6).
- Produces:
  - `nf-sefaz-mapa.ts`: `itensComDespesasDoTotal(nfe: NfeLida): { itens: ItemNfe[]; aviso: string | null }` (o que o total traz a mais que a soma dos itens — `vFrete`, `vSeg`, `vOutro` e o desconto, cada um separado — é rateado nos itens pelo valor líquido, centavo de sobra no maior item, e entra em `fiscal.frete/seguro/outras`, `desconto` e `valorTotalItem`; aviso `'Frete/despesas só no total da nota: rateados pelo valor dos itens.'`); `totalEsperadoDaNota(nfe: NfeLida): number` (Σ `valorTotalItem` + despesas só do total − desconto só do total − `vICMSDeson`), usado por `alertasDaNota`; `itemCompraSefaz(i: ItemNfe, c: { codigoProduto: number | null; fator: number; origem: string | null; score: number | null; sugestao: number | null }, cfg: ConfigInicialItem): Record<string, unknown>` (payload do item para `registrar_compra_sefaz`, com `custo_flags` em texto e `cfop_entrada` só dígitos).
  - `cabecalhoDaNota` (mesma assinatura) grava `totais` com as chaves do Omie (X7: `vTotalNFe`, `vTotalProdutos`, `bcICMS`, `vICMS`, `bcICMSST`, `vICMSSubstituicao`, `vTotalIPI`, `vTotalDescontos`, `vOutrasDespesas`, `vTotalPIS`, `vTotalCOFINS`, `vFrete`, `vAproxTributos`; seguro em `vSeguro`, nome HIPÓTESE: não aparece nas notas de D1) e o transporte completo (`cInscricaoTransp`, `cUFTransp`, `cPlaca`, `cUFPlaca`, `cRNTRC`, `cMarcaVolume`, `cNumeracaoVolume`, `cLacres`).
  - `nf-memoria.ts`: `carregarMemoria(lojaId: number, cnpj: string | null, produtos: number[], cProds: string[]): Promise<{ porProduto: Map<number, MemoriaItem>; porCodigoFornecedor: Map<string, MemoriaItem> }>` (uma chamada à RPC) e `carregarCmc(lojaId: number, produtos: number[]): Promise<Map<number, number>>` (`estoque_custos`, `buscarTodosPorIds`).
  - `nf-item-regras.ts`: `podeLancarSozinho(e: { casamentosSeguros: boolean; alertasNota: number; origensFlags: OrigemFlags[]; alertasItens: AlertaItem[]; autoLancar: boolean }): boolean`.
  - `gravarNotaCompleta(lojaId, nfe, opts)` (mesma assinatura; `opts.mapeamentos` aceita `{ codigoProduto, fator, codigoLocal?: number | null }`): monta `configInicialItem` por item com memória, unidade do produto e local da nota; usa `itensComDespesasDoTotal`; lança sozinho só com `podeLancarSozinho`. `ResultadoNota` ganha `alertasItens: { linha: number; alertas: AlertaItem[] }[]`.
  - `previaXml` devolve também `validacao: { erros: string[]; avisos: string[] }` e, por item, `config: ConfigInicialItem` e `alertas: AlertaItem[]`; com erros, devolve `{ error }` com os erros juntos. `lancarCompraXml` recusa com erro de validação antes de gravar.
  - `processarDocumento` (procNFe): `validarXmlBruto` + `validarNfeImportada` (com `assinaturaConfere`); com erro → `marcarDoc(…, { processado: true, ignorado: <1º erro>, chave })` e `r.ignorados++`; avisos entram nos alertas da nota.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// nf-sefaz-mapa.test.ts
test('total esperado com IPI e outras despesas no item: nota da CRBS não fica divergente', () => {
  const n = lerNfe(XML_CRBS_131055) // vNF da fixture = 176,41 + 706,35 + 39,87 = 922,63
  assert.equal(totalEsperadoDaNota(n), 922.63); assert.deepEqual(alertasDaNota(n, '66764497000122'), [])
})
test('frete, seguro, outras e desconto só no total são rateados nos itens (fixture antiga: 20 + 5 + 5, desconto 5)', () => {
  const { itens, aviso } = itensComDespesasDoTotal(lerNfe(XML))
  assert.deepEqual(itens.map((i) => [i.fiscal.frete, i.fiscal.seguro, i.fiscal.outras]), [[13.1, 3.28, 3.28], [6.9, 1.72, 1.72]])
  assert.deepEqual(itens.map((i) => i.valorTotalItem), [206.38, 108.62])
  assert.ok(aviso)
  assert.equal(itensComDespesasDoTotal(lerNfe(XML_CRBS_131055)).aviso, null) // NF-e 4.0: o total é a soma dos itens
})
test('cabeçalho com os totais no formato do Omie (X7)', () => {
  const fo = cabecalhoDaNota(lerNfe(XML_CRBS_131055), { ambiente: '1', origem: 'sefaz', alertas: [] }).full_object as any
  assert.equal(fo.totais.vTotalNFe, 922.63); assert.equal(fo.totais.vTotalIPI, 20.8); assert.equal(fo.totais.vOutrasDespesas, 70.15); assert.equal(fo.transporte.cPlaca, 'ABC1D23')
})
test('itemCompraSefaz leva a configuração inicial e os valores fiscais', () => {
  const i = lerNfe(XML_CRBS_131055).itens[1]
  const cfg = { flags: flagsDeTexto('NNNNNNNN')!, origemFlags: 'regra', cfopEntrada: '1407', origemCfop: 'tabela', movimentaEstoque: true, geraContaPagar: true, unidadeEstoque: 'UN', codigoLocal: 2746972551, aliqCredPis: 0, aliqCredCofins: 0 } as const
  const p = itemCompraSefaz(i, { codigoProduto: 3258506483, fator: 24, origem: 'depara', score: 1, sugestao: null }, cfg)
  assert.equal(p.valor_total_item, 706.35); assert.equal(p.ipi_valor, 20.04); assert.equal(p.outras_valor, 53.71)
  assert.equal(p.custo_flags, 'NNNNNNNN'); assert.equal(p.cfop_entrada, '1407'); assert.equal(p.codigo_local_estoque, 2746972551); assert.equal(p.fator, 24)
})
// nf-item-regras.test.ts
test('podeLancarSozinho: padrão ou alerta de item segura a nota', () => {
  const b = { casamentosSeguros: true, alertasNota: 0, origensFlags: ['produto', 'regra'] as const, alertasItens: [], autoLancar: true }
  assert.equal(podeLancarSozinho({ ...b, origensFlags: [...b.origensFlags] }), true)
  assert.equal(podeLancarSozinho({ ...b, origensFlags: ['padrao'] }), false)
  assert.equal(podeLancarSozinho({ ...b, origensFlags: ['regra'], alertasItens: [{ tipo: 'fator_suspeito', texto: 'x' }] }), false)
  assert.equal(podeLancarSozinho({ ...b, origensFlags: ['regra'], autoLancar: false }), false)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/estoque/nf-sefaz-mapa.test.ts lib/estoque/nf-item-regras.test.ts`
Expected: FAIL (funções inexistentes).

- [ ] **Step 3: Implementar** (assinaturas acima; os testes antigos de `alertasDaNota` continuam passando; `carregarMemoria` sem resultado = mapas vazios, nunca erro que derrube a nota; a leitura de `lojas` em `lancarCompraXml` passa a ser `select('cnpj, is_test')`).

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/estoque/nf-sefaz-mapa.test.ts lib/estoque/nf-item-regras.test.ts lib/estoque/nf-despacho.test.ts lib/estoque/nfe-validacao.test.ts && npx tsc --noEmit`
Expected: PASS; `tsc` limpo.

- [ ] **Step 5: Commit**

```bash
git add lib/estoque/nf-sefaz-mapa.ts lib/estoque/nf-sefaz-mapa.test.ts lib/estoque/nf-sefaz.ts lib/estoque/nf-memoria.ts lib/estoque/sefaz-sync.ts lib/estoque/nf-item-regras.ts lib/estoque/nf-item-regras.test.ts lib/actions/compras-proprio.ts
git commit -m "feat(estoque-proprio): nota gravada com sugestões por item e XML validado (upload e SEFAZ)"
```

---

### Task 8: Editor do item e conferência na tela [B1–B5; D2, D18; colunas só leitura no modo Omie]

**Files:**
- Create: `components/nota-fiscal/EditorItemNF.tsx`
- Modify: `components/nota-fiscal/DetalhesFiscaisNF.tsx`, `components/nota-fiscal/ConferenciaNF.tsx` (tipo `ItemConferencia`, `LinhaItem`, botão "Marcar como conferida"), `app/(app)/nota-fiscal/[id]/dados-proprio.ts`, `app/(app)/nota-fiscal/[id]/page.tsx`, `components/nota-fiscal/ItensNotaFiscal.tsx`, `components/compras-proprio/ImportarXml.tsx`, `lib/actions/nota-fiscal-proprio.ts`, `lib/offline/politica.ts`, `lib/offline/registro-acoes.ts` (gerado)
- Test: `lib/estoque/nf-item-regras.test.ts` (`decidirConferencia`); `lib/estoque/fase-b-omie-intacto.test.ts` recebe o teste de `ItensNotaFiscal` na Task 12
- Modify: `lib/estoque/nf-item-regras.ts`

**Interfaces:**
- Consumes: `ConfigItemNF`, `validarConfigItem`, `alertasDoItem`, `previaCustoItem`, `flagsDeTexto`, `formatarCfop`, `UNIDADES_ESTOQUE` (Task 4); RPCs `configurar_item_compra`, `marcar_compra_conferida` (Task 6); `carregarCmc` (Task 7).
- Produces:
  - `configurarItemNF(compraItemId: number, cfg: ConfigItemNF): Promise<{ ok: true } | { error: string }>` (permissão `Notas Fiscais - Manifestar`, valida com `validarConfigItem`, chama a RPC, `atualizarSituacao`).
  - `marcarConferidaNF(notaId: number, opts: { aceitarAvisos: boolean }): Promise<{ ok: true } | { error: string; pendencias?: { linha: number; motivo: string }[] }>` — recalcula os avisos dos itens no servidor e decide por `decidirConferencia`; passa os avisos aceitos em `p_detalhe`.
  - Em `nf-item-regras.ts`: `decidirConferencia(alertas: { linha: number; alertas: AlertaItem[] }[], aceitarAvisos: boolean): { ok: true; aceitos: { linha: number; tipo: AlertaItem['tipo'] }[] } | { error: string }` — com aviso dos tipos `fator_suspeito`, `custo_fora`, `valor_zero` e `aceitarAvisos=false`: `{ error: 'Há avisos de custo ou quantidade: confira e marque "Conferi os avisos".' }`; `recebido_menor`/`maior` e `complementar` só informam.
  - `ItemConferencia` ganha `config: { codigoLocal: number | null; cfopEntrada: string | null; origemCfop: string | null; quantidadeRecebida: number; unidadeEstoque: string | null; flags: string | null; origemFlags: string | null; aliqCredPis: number; aliqCredCofins: number; movimentaEstoque: boolean; geraContaPagar: boolean }`, `fiscal` (CST/CSOSN, ICMS, ST, IPI, PIS, COFINS, frete, seguro, outras), `previa: { valorEstoque: number; custoUnitario: number | null }`, `alertas: AlertaItem[]`, `saldoAtual: number | null` (D2, `estoque_saldos` do produto no local).
  - `Mapeamento` (upload) ganha `codigoLocal?: number | null`; a prévia do upload mostra o local por item (padrão = sugestão), e a caixa "ICMS recuperável" vira "Tirar o ICMS do custo em todos os itens" (preenche a marcação de cada item).

- [ ] **Step 1: Teste que falha de `decidirConferencia`** (em `lib/estoque/nf-item-regras.test.ts`)

```ts
test('marcarConferidaNF recusa sem "Conferi os avisos" (TEQUILA PRATA) e aceita com', () => {
  const a = [{ linha: 5, alertas: [{ tipo: 'fator_suspeito' as const, texto: 'x' }, { tipo: 'custo_fora' as const, texto: 'y' }] }, { linha: 1, alertas: [{ tipo: 'recebido_menor' as const, texto: 'z' }] }]
  assert.deepEqual(decidirConferencia(a, false), { error: 'Há avisos de custo ou quantidade: confira e marque "Conferi os avisos".' })
  assert.deepEqual(decidirConferencia(a, true), { ok: true, aceitos: [{ linha: 5, tipo: 'fator_suspeito' }, { linha: 5, tipo: 'custo_fora' }] })
  assert.deepEqual(decidirConferencia([a[1]], false), { ok: true, aceitos: [] })
})
```
Run: `node --test lib/estoque/nf-item-regras.test.ts` → FAIL; implementar; → PASS.

- [ ] **Step 2: Ligar o servidor**

`dados-proprio.ts` lê as colunas novas de `compras_proprio_itens`, os nomes dos locais, `carregarCmc` e `estoque_saldos`, e calcula `previa` e `alertas` com as funções da Task 4. Ações novas em `nota-fiscal-proprio.ts` (assinaturas acima); `node scripts/inserir-via-desktop.mjs`; em `politica.ts`, `nota-fiscal-proprio#configurarItemNF` e `#marcarConferidaNF` em `local` (só mexem no banco, como `vincularItemNF`).

- [ ] **Step 3: Editor do item (`EditorItemNF.tsx`)**

Por item, abaixo do produto (aberto por "Detalhes do item"): "Quantidade recebida" + "Unidade" (lista `UNIDADES_ESTOQUE`) com a linha "1 CX = 12 UN"; "Local de estoque" (locais ativos, com o saldo do produto ali); "CFOP de entrada" (texto, mostra `formatarCfop` e "sugerido: mesmo produto na última nota" / "tabela" / "regra"); caixas "Movimenta estoque" e "Gera conta a pagar"; bloco "Custo de estoque" com as 8 caixas na ordem do Omie ("ICMS é custo de estoque" … "Outras despesas são custo de estoque"), "Alíquota de crédito do PIS (%)" e "do COFINS (%)", e o selo da origem ("sugerido: mesmo produto na última nota", "mesmo código do fornecedor", "regra do Omie para CST 60", "padrão — confira"); bloco "Impostos da nota" só leitura (CST/CSOSN, ICMS, ST, IPI, PIS, COFINS, frete, seguro, outras); linha final "Entra no estoque: 96 UN a R$ 6,589583 (valor de estoque R$ 632,60)". Salvar = `configurarItemNF` com só os campos mudados. Avisos do item em amarelo, com o texto de `alertasDoItem`.

- [ ] **Step 4: Conferência e rodapé**

`ConferenciaNF`: botão "Marcar como conferida" (antes de "Confirmar entrada"), com a caixa "Conferi os avisos" quando há aviso; rodapé com Mercadorias, Desconto, IPI, ST, Frete/despesas e Total da nota (D18). Itens "não movimenta estoque" aparecem riscados com "fica fora do estoque".

- [ ] **Step 5: Abas Transporte, Totais e Observações (R17)**

`DetalhesFiscaisNF` (com `semOmie`): bloco Transporte com todos os campos novos e Totais com BC ICMS, ICMS, BC ST, ST, IPI, frete, seguro, outras, descontos, PIS, COFINS e total; no modo Omie o componente fica como está. Observações: campo de texto na nota própria (até 2.000 caracteres) com `salvarObservacaoNF(notaId: number, obs: string): Promise<{ ok: true } | { error: string }>` (grava `compras_proprio.obs` + evento `observacao`; `politica.ts`: `local`).

- [ ] **Step 6: Colunas só leitura nos itens (os dois modos)**

`ItensNotaFiscal.tsx`: colunas "CFOP de entrada", "Local", "Gera conta a pagar", "Movimenta estoque" lidas de `full_object.itensAjustes` (o Omie já manda; a loja própria recebe pela projeção). Nada de consulta nova, nada editável aqui.

- [ ] **Step 7: Conferir**

Run: `npx tsc --noEmit && node --test lib/estoque/nf-item-regras.test.ts lib/estoque/nf-despacho.test.ts`
Expected: limpo; PASS. QA de tela fica para a Task 14 (ODARA, com OK).

- [ ] **Step 8: Commit**

```bash
git add lib/estoque/nf-item-regras.ts lib/estoque/nf-item-regras.test.ts components/nota-fiscal/EditorItemNF.tsx components/nota-fiscal/ConferenciaNF.tsx components/nota-fiscal/DetalhesFiscaisNF.tsx components/nota-fiscal/ItensNotaFiscal.tsx "app/(app)/nota-fiscal/[id]" components/compras-proprio/ImportarXml.tsx lib/actions/nota-fiscal-proprio.ts lib/offline/politica.ts lib/offline/registro-acoes.ts
git commit -m "feat(estoque-proprio): editor do item da nota (custo, quantidade recebida, local, CFOP) e conferência"
```

---

### Task 9: Quadro de etapas e histórico de processamento [B8, F9; R9, R10]

**Files:**
- Create: `lib/estoque/nf-etapas.ts`, `lib/estoque/nf-etapas.test.ts`, `lib/estoque/nf-historico.ts`, `lib/estoque/nf-historico.test.ts`, `components/nota-fiscal/QuadroEtapasNF.tsx`, `components/nota-fiscal/HistoricoProcessamentoNF.tsx`, `app/(app)/nota-fiscal/etapas/page.tsx`
- Modify: `lib/nf-status.ts` (+ `lib/estoque/nf-status.test.ts`), `app/(app)/nota-fiscal/page.tsx` (link "Etapas do recebimento" só em loja própria), `app/(app)/nota-fiscal/[id]/page.tsx` (loja própria: `HistoricoProcessamentoNF` no lugar de `HistoricoStatusNF`)

**Interfaces:**
- Produces:
  - `type EtapaNF = 'aguardando_xml' | 'a_conferir' | 'conferida' | 'lancada' | 'fora'`; `etapaDaNota(situacao: string | null, cancelada: boolean): EtapaNF` (`resumo` → aguardando_xml; `a_conferir`, `divergente` → a_conferir; `conferida`; `lancada`, `parcial` → lancada; `estornada`, `recusada`, cancelada → fora); `ROTULO_ETAPA` = `{ aguardando_xml: 'Aguardando o XML', a_conferir: 'A conferir', conferida: 'Conferida', lancada: 'Lançada no estoque', fora: 'Canceladas e desfeitas' }`; `agruparPorEtapa<T extends { situacao: string | null; cancelada: boolean }>(notas: T[]): Record<EtapaNF, T[]>`.
  - `nf-historico.ts`: `type FontesHistorico = { documentos: { tipo: string; recebido_em: string; ciencia_em: string | null; ciencia_cstat: string | null; busca_chave_em: string | null; erro: string | null; ignorado: string | null }[]; eventos: { tipo: string; linha: number | null; detalhe: Record<string, unknown> | null; autor: string | null; criado_em: string }[]; manifestacoes: { tp_evento: string; status: string; cstat: string | null; protocolo: string | null; autor: string | null; criado_em: string; respondido_em: string | null }[]; canceladaEm: string | null }`; `type EventoHistorico = { ts: string; grupo: 'sefaz' | 'conferencia' | 'estoque' | 'manifestacao'; texto: string; autor: string | null; tom: 'ok' | 'warn' | 'err' | null }`; `montarHistoricoNF(f: FontesHistorico): EventoHistorico[]` (ordem cronológica; empate pela ordem das fontes).
  - `lib/nf-status.ts`: `ROTULO_SEFAZ` ganha `conferida: { label: 'Conferida', tom: 'warn' }` e `recusada: { label: 'Recusada na SEFAZ', tom: 'err' }`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
test('etapas reaproveitam a situação da conferência', () => {
  assert.equal(etapaDaNota('resumo', false), 'aguardando_xml'); assert.equal(etapaDaNota('divergente', false), 'a_conferir')
  assert.equal(etapaDaNota('conferida', false), 'conferida'); assert.equal(etapaDaNota('parcial', false), 'lancada')
  assert.equal(etapaDaNota('lancada', true), 'fora'); assert.equal(etapaDaNota('recusada', false), 'fora'); assert.equal(etapaDaNota(null, false), 'a_conferir')
})
test('histórico da nota: SEFAZ, conferência, estoque e manifestação em ordem', () => {
  const h = montarHistoricoNF({
    documentos: [{ tipo: 'resNFe', recebido_em: '2026-10-19T12:00:00Z', ciencia_em: '2026-10-19T12:05:00Z', ciencia_cstat: '135', busca_chave_em: null, erro: null, ignorado: null },
                 { tipo: 'procNFe', recebido_em: '2026-10-19T12:20:00Z', ciencia_em: null, ciencia_cstat: null, busca_chave_em: null, erro: null, ignorado: null }],
    eventos: [{ tipo: 'item_configurado', linha: 3, detalhe: { de: { codigo_local_estoque: 2746972551 }, para: { codigo_local_estoque: 2746972605 } }, autor: 'Ramon', criado_em: '2026-10-19T13:00:00Z' },
              { tipo: 'conferida', linha: null, detalhe: {}, autor: 'Ramon', criado_em: '2026-10-19T13:05:00Z' },
              { tipo: 'lancada', linha: null, detalhe: { lancados: 3, ignorados: 0, pendentes: 0 }, autor: 'Ramon', criado_em: '2026-10-19T13:06:00Z' }],
    manifestacoes: [{ tp_evento: '210200', status: 'registrada', cstat: '135', protocolo: '891260000000123', autor: 'Ramon', criado_em: '2026-10-19T13:10:00Z', respondido_em: '2026-10-19T13:10:02Z' }],
    canceladaEm: null,
  })
  assert.deepEqual(h.map((e) => e.texto), [
    'Resumo da nota recebido da SEFAZ', 'Ciência da operação registrada na SEFAZ (135)', 'XML completo recebido da SEFAZ',
    'Item 3 alterado', 'Conferida', 'Entrada no estoque: 3 itens', 'Confirmação da operação registrada na SEFAZ (135, protocolo 891260000000123)'])
  assert.equal(h[4].autor, 'Ramon'); assert.equal(h[6].tom, 'ok')
})
test('nota do Omie: rótulos de sempre; nota própria ganha Conferida e Recusada', () => {
  assert.equal(statusNF('40', {}).label, 'Pendente (etapa 40)')
  assert.equal(statusNF('40', { sefaz: { situacao: 'conferida' } }).label, 'Conferida')
  assert.equal(statusNF('40', { sefaz: { situacao: 'recusada' } }).label, 'Recusada na SEFAZ')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/estoque/nf-etapas.test.ts lib/estoque/nf-historico.test.ts lib/estoque/nf-status.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Puros pelas assinaturas. `/nota-fiscal/etapas` (loja Omie → `redirect('/nota-fiscal')`): mesmo `PeriodoBar` da lista (padrão últimos 30 dias), 4 colunas (Aguardando o XML, A conferir, Conferida, Lançada) com cartões (fornecedor, nº, valor, emissão, selo "divergente"/"parcial") que abrem `/nota-fiscal/[id]`, e o contador "Canceladas e desfeitas" ao lado; sem arrastar (as mudanças de etapa são as ações da nota). `HistoricoProcessamentoNF` (servidor) lê `sefaz_documentos` (pela chave), `compras_proprio_eventos`, `sefaz_manifestacoes`, `sefaz_chaves_canceladas` (sessão, RLS), troca `user_id` por `profiles.name` e chama `montarHistoricoNF`. Textos de `item_configurado` nomeiam o campo mudado na linha seguinte ("local: 01 - BAR → 02 - COZINHA").

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/estoque/nf-etapas.test.ts lib/estoque/nf-historico.test.ts lib/estoque/nf-status.test.ts && npx tsc --noEmit`
Expected: PASS; `tsc` limpo.

- [ ] **Step 5: Commit**

```bash
git add lib/estoque/nf-etapas.ts lib/estoque/nf-etapas.test.ts lib/estoque/nf-historico.ts lib/estoque/nf-historico.test.ts lib/nf-status.ts lib/estoque/nf-status.test.ts components/nota-fiscal/QuadroEtapasNF.tsx components/nota-fiscal/HistoricoProcessamentoNF.tsx "app/(app)/nota-fiscal"
git commit -m "feat(estoque-proprio): etapas do recebimento e histórico de processamento da nota"
```

---

### Task 10: Manifestação do destinatário e "Concluir recebimento" [B6, F8; R12]

**Files:**
- Create: `lib/estoque/sefaz-manifestacao.ts`, `lib/estoque/sefaz-manifestacao.test.ts`, `components/nota-fiscal/ManifestacaoNF.tsx`
- Modify: `lib/estoque/sefaz-rede.ts` (`enviarManifestacao`), `lib/actions/nota-fiscal-proprio.ts` (`manifestarNotaSefaz`), `app/(app)/nota-fiscal/[id]/page.tsx`, `components/nota-fiscal/AcoesNF.tsx`, `components/nota-fiscal/HistoricoStatusNF.tsx` (rótulos), `lib/estoque/nf-despacho.test.ts`

**Interfaces:**
- Consumes: `dataHoraSaoPaulo` (`sefaz-distdfe.ts`, padrão `@ts-ignore`), `postSoap`/`assinarEvento`/`urlEventoNacional`/`soapEvento`/`lerRetornoEvento` (já em `sefaz-rede.ts`/`sefaz-distdfe.ts`); tabela `sefaz_manifestacoes` e permissão `Notas Fiscais - Manifestar na SEFAZ` (Task 5); guarda de `lancar_compra` (Task 6).
- Produces:
  - `type TipoManifestacao = '210200' | '210220' | '210240'`; `MANIFESTACOES: Record<TipoManifestacao, { desc: string; rotulo: string; exigeJustificativa: boolean }>` = `{ '210200': { desc: 'Confirmacao da Operacao', rotulo: 'Confirmar a operação', exigeJustificativa: false }, '210220': { desc: 'Desconhecimento da Operacao', rotulo: 'Desconhecer a operação', exigeJustificativa: false }, '210240': { desc: 'Operacao nao Realizada', rotulo: 'Operação não realizada', exigeJustificativa: true } }`.
  - `validarJustificativa(tipo: TipoManifestacao, j: string | null | undefined): string | null` (210240: 15–255 caracteres depois do `trim`).
  - `montarEventoManifestacao(p: { chave: string; cnpj: string; tpAmb: 1 | 2; tipo: TipoManifestacao; justificativa?: string | null; agora?: Date }): { xml: string; id: string }` — mesmo molde do `montarEventoCiencia` (órgão 91, `nSeqEvento` 1, `verEvento` 1.00, `Id = 'ID' + tipo + chave + '01'`), `xJust` depois de `descEvento`, sem acentos e com `& < > " '` escapados.
  - `type EstadoManifestacao = { tp_evento: string; status: 'enviando' | 'registrada' | 'recusada' | 'incerta'; criado_em: string }`; `decidirEnvioManifestacao(estados: EstadoManifestacao[], tipo: TipoManifestacao, agora: Date): { acao: 'enviar' } | { acao: 'reenviar' } | { acao: 'bloquear'; motivo: string }` — conclusiva registrada → bloquear `'Esta nota já foi manifestada na SEFAZ: <rótulo>.'`; `enviando` há menos de 5 min → bloquear `'Já há um envio em andamento para esta nota.'`; `enviando` há 5 min ou mais ou `incerta` do MESMO tipo → reenviar; `incerta` de outro tipo → bloquear `'Há um envio sem resposta (<rótulo>): repita esse primeiro.'`; senão enviar.
  - `resultadoManifestacao(cStat: string | null): 'registrada' | 'recusada'` (135, 136, 573 = registrada).
  - `enviarManifestacao(p: { chave: string; cnpj: string; tpAmb: 1 | 2; tipo: TipoManifestacao; justificativa?: string | null; cred: CredencialLoja }): Promise<{ cStat: string | null; xMotivo: string | null; protocolo: string | null }>` em `sefaz-rede.ts`.
  - `manifestarNotaSefaz(notaId: number, tipo: TipoManifestacao, justificativa?: string | null): Promise<{ ok: true; status: 'registrada' | 'recusada'; cStat: string | null; xMotivo: string | null } | { error: string }>` — loja própria + permissão nova; nota com chave; `decidirEnvioManifestacao`; `insert` da linha `enviando` (`23505` = "Já há um envio em andamento"; reenviar = `update` da linha); rede; grava `registrada`/`recusada` + `cstat`, `xmotivo`, `protocolo`, `respondido_em`; falha de rede/tempo esgotado = `incerta`; depois `sincronizar_situacao_nota` + `espelharNotaNoFrio`. **Fora** de `politica.ts` (precisa de internet).
  - Modo Omie: `AcoesNF` mostra "Concluir recebimento" (confirmação `'Concluir o recebimento desta nota no Omie? Ela passa para Concluída.'`, aviso `'Recebimento concluído.'`); `HistoricoStatusNF`: `concluir` → `'Recebimento concluído'`, tópico `Concluido` → `'Recebimento concluído'`, `Revertido` → `'Conclusão revertida'`. A função chamada continua `manifestarNF`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
const CH = '29260956228356015244550220001310551123456788', ODARA = '66764497000122', T0 = new Date('2026-10-19T13:00:00Z')
test('evento 210240 com justificativa sem acento e escapada', () => {
  const { xml, id } = montarEventoManifestacao({ chave: CH, cnpj: ODARA, tpAmb: 1, tipo: '210240', justificativa: 'Mercadoria não foi entregue & devolvida', agora: T0 })
  assert.equal(id, `ID210240${CH}01`)
  assert.ok(xml.includes('<tpEvento>210240</tpEvento>') && xml.includes('<dhEvento>2026-10-19T10:00:00-03:00</dhEvento>'))
  assert.ok(xml.includes('<detEvento versao="1.00"><descEvento>Operacao nao Realizada</descEvento><xJust>Mercadoria nao foi entregue &amp; devolvida</xJust></detEvento>'))
})
test('confirmação e desconhecimento sem xJust; justificativa curta recusada', () => {
  assert.ok(!montarEventoManifestacao({ chave: CH, cnpj: ODARA, tpAmb: 1, tipo: '210200', agora: T0 }).xml.includes('xJust'))
  assert.ok(montarEventoManifestacao({ chave: CH, cnpj: ODARA, tpAmb: 1, tipo: '210220', agora: T0 }).xml.includes('<descEvento>Desconhecimento da Operacao</descEvento>'))
  assert.ok(validarJustificativa('210240', 'não veio')); assert.equal(validarJustificativa('210240', 'Mercadoria nao foi entregue'), null); assert.equal(validarJustificativa('210200', null), null)
})
test('decidirEnvioManifestacao: em andamento bloqueia, sem resposta reenvia o mesmo tipo', () => {
  const e = (tp: string, status: EstadoManifestacao['status'], min: number) => ({ tp_evento: tp, status, criado_em: new Date(T0.getTime() - min * 60000).toISOString() })
  assert.deepEqual(decidirEnvioManifestacao([], '210200', T0), { acao: 'enviar' })
  assert.deepEqual(decidirEnvioManifestacao([e('210210', 'registrada', 600)], '210200', T0), { acao: 'enviar' })
  assert.equal(decidirEnvioManifestacao([e('210200', 'enviando', 1)], '210200', T0).acao, 'bloquear')
  assert.deepEqual(decidirEnvioManifestacao([e('210200', 'enviando', 6)], '210200', T0), { acao: 'reenviar' })
  assert.deepEqual(decidirEnvioManifestacao([e('210240', 'incerta', 1)], '210240', T0), { acao: 'reenviar' })
  assert.equal(decidirEnvioManifestacao([e('210240', 'incerta', 1)], '210200', T0).acao, 'bloquear')
  assert.deepEqual(decidirEnvioManifestacao([e('210200', 'registrada', 60)], '210240', T0), { acao: 'bloquear', motivo: 'Esta nota já foi manifestada na SEFAZ: Confirmar a operação.' })
  assert.deepEqual(decidirEnvioManifestacao([e('210220', 'recusada', 60)], '210220', T0), { acao: 'enviar' })
})
test('573 (duplicidade) conta como registrada', () => {
  assert.equal(resultadoManifestacao('573'), 'registrada'); assert.equal(resultadoManifestacao('596'), 'recusada'); assert.equal(resultadoManifestacao(null), 'recusada')
})
// nf-despacho.test.ts
test('manifestação só por botão: nenhum cron, sync ou lançamento chama enviarManifestacao/manifestarNotaSefaz', () => {
  for (const f of ['lib/estoque/sefaz-sync.ts', 'lib/estoque/nf-sefaz.ts', 'app/api/cron/sync-sefaz/route.ts', 'app/api/sync/notas-fiscais/route.ts', 'lib/actions/compras-proprio.ts'])
    assert.ok(!/enviarManifestacao|manifestarNotaSefaz/.test(semComentarios(ler(f))), f)
})
test('modo Omie: o botão diz "Concluir recebimento" e continua chamando manifestarNF', () => {
  const src = ler('components/nota-fiscal/AcoesNF.tsx')
  assert.ok(src.includes('Concluir recebimento') && !src.includes('Manifestar (marcar recebida)') && src.includes('manifestarNF(notaId)'))
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/estoque/sefaz-manifestacao.test.ts lib/estoque/nf-despacho.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Puros e rede pelas assinaturas. `ManifestacaoNF` (só loja própria, só com a permissão nova): mostra a ciência (data/cStat) e a conclusiva (nenhuma / qual, quando, protocolo); menu "Manifestar na SEFAZ" com os 3 tipos; o diálogo explica em uma frase o efeito de cada um ("Confirmar: você recebeu a mercadoria." / "Desconhecer: esta compra não é sua." / "Não realizada: a compra existiu mas a mercadoria não veio; diga o motivo."), pede a justificativa no 210240 e só habilita "Enviar à SEFAZ" com a caixa "Entendi que isto vai para a SEFAZ e não pode ser desfeito" marcada. Depois de 210220/210240 com a entrada já lançada: aviso `'A entrada desta nota continua no estoque. Se a mercadoria não chegou, use "Desfazer entrada no estoque".'`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/estoque/sefaz-manifestacao.test.ts lib/estoque/nf-despacho.test.ts lib/estoque/sefaz-distdfe.test.ts lib/estoque/sefaz-rede.test.ts && npx tsc --noEmit`
Expected: PASS (o teste antigo "nunca emite nem cancela" continua passando); `tsc` limpo.

- [ ] **Step 5: Commit**

```bash
git add lib/estoque/sefaz-manifestacao.ts lib/estoque/sefaz-manifestacao.test.ts lib/estoque/sefaz-rede.ts lib/actions/nota-fiscal-proprio.ts components/nota-fiscal/ManifestacaoNF.tsx "app/(app)/nota-fiscal/[id]/page.tsx" components/nota-fiscal/AcoesNF.tsx components/nota-fiscal/HistoricoStatusNF.tsx lib/estoque/nf-despacho.test.ts lib/offline/registro-acoes.ts
git commit -m "feat(estoque-proprio): manifestação do destinatário por botão; no Omie o botão vira 'Concluir recebimento'"
```

- [ ] **Step 6: [OK do dono] Primeira manifestação real (depois do Lote 3 em produção e da Task 13)**

Run: na ODARA, numa nota real já recebida e lançada, "Confirmar a operação"; depois `select tp_evento, status, cstat, xmotivo, protocolo from sefaz_manifestacoes where loja_id = 15 order by id desc limit 1;`
Expected: `210200 | registrada | 135 | … | <protocolo>`; o histórico da nota mostra a linha. Recusada → registrar `cStat`/`xMotivo`, não repetir, avisar o dono.

---

### Task 11: CT-e de frete no custo e nota por chave digitada [B9, A4; R13, R14]

**Files:**
- Create: `lib/estoque/cte-xml.ts`, `lib/estoque/cte-xml.test.ts`, `supabase/migrations/186_cte_frete_funcoes.sql`, `scripts/testes-sql/186_cte_frete_funcoes.sql`, `components/nota-fiscal/FreteCteNF.tsx`, `components/nota-fiscal/BuscarPorChave.tsx`
- Modify: `lib/estoque/sefaz-sync.ts` (`importarNotaPorChave`), `lib/actions/nota-fiscal-proprio.ts`, `app/(app)/nota-fiscal/[id]/page.tsx`, `app/(app)/nota-fiscal/page.tsx` (botão "Buscar nota pela chave" junto de "Importar XML", só loja própria), `lib/offline/politica.ts`

**Interfaces:**
- Consumes: `parseXml`, `validarChave`, `dvChave` (`nfe-xml.ts`, padrão `@ts-ignore`); tabelas CT-e e `sefaz_busca_chave` (Task 5); `frete_cte` no custo (Tasks 3 e 6); `consultarPorChave`/`processarDocumento` (`sefaz-sync.ts`).
- Produces:
  - `type CteLido = { chave: string; numero: string; serie: string; emissao: string | null; modelo: string | null; ambiente: string | null; protocolo: { cStat: string } | null; emitente: { cnpj: string; nome: string }; tomadorCnpj: string | null; valorPrestacao: number; icms: number; cfop: string | null; chavesNfe: string[] }`; `lerCte(xml: string): CteLido` (`cteProc`/`CTe`; tomador por `toma3`/`toma4` → CNPJ de rem/exped/receb/dest/outro); `validarCteImportado(c: CteLido, cnpjLoja: string | null): string[]` (modelo 57, protocolo 100/150, `tpAmb` 1, tomador = loja: `'Este CT-e não é pago por esta loja (tomador <cnpj>).'`).
  - `ratearFreteCte(valor: number, notas: { compraId: number; valorNota: number }[]): { compraId: number; valor: number; percentual: number }[]` e `ratearFreteItens(valor: number, itens: { linha: number; base: number }[]): { linha: number; valor: number }[]` (proporcional, centavos de sobra no maior; HIPÓTESE N8).
  - SQL 186 (transação): `vincular_cte_compra(p_loja bigint, p_cte bigint, p_rateio jsonb, p_user text default null) returns jsonb` (`p_rateio` = `[{compra_id, valor}]`; todas as compras da loja e sem item lançado — senão `raise exception 'A nota % já entrou no estoque: desfaça a entrada, ligue o CT-e e confirme de novo.'`; Σ valor = valor do CT-e ± 0,01; grava `compras_proprio_cte_compra`; recalcula `frete_cte` dos itens que movimentam estoque pela base `valor_total − desconto`, centavo no maior; zera `conferida_em`; evento `cte_vinculado`; projeta) e `desvincular_cte_compra(p_loja bigint, p_cte bigint, p_user text default null) returns jsonb` (mesmas travas; zera `frete_cte`; evento `cte_desvinculado`).
  - Ações: `importarCteNF(notaId: number, xml: string)` (lê, valida, grava `compras_proprio_cte` com `origem='xml'` — mesma chave = reaproveita —, propõe o rateio entre as notas da loja cujas chaves estão no CT-e e liga), `informarFreteNF(notaId: number, dados: { valor: number; transportadora?: string; numero?: string })` (`origem='manual'`, só esta nota), `desvincularCteNF(notaId: number, cteId: number)`, `buscarNotaPorChaveNF(chave: string)` (permissão `Notas Fiscais - Sincronizar`). Em `politica.ts`: as três de CT-e em `local`; `buscarNotaPorChaveNF` fora (SEFAZ).
  - `importarNotaPorChave(lojaId: number, chave: string): Promise<{ ok: true; situacao: 'completa' | 'resumo' | 'nao_encontrada'; notaId: number | null } | { error: string }>` — chave com DV certo, modelo 55, emitente ≠ loja; 1 tentativa por chave por hora em `sefaz_busca_chave` (`'Esta chave já foi consultada há menos de 1 hora.'`); `bloqueado_ate` da loja só barra a consulta por NSU (igual a hoje); 656 grava a espera; `procNFe` → `processarDocumento`; só `resNFe` → grava o resumo (a ciência segue a configuração da loja).

- [ ] **Step 1: Escrever os testes que falham**

```ts
const CTE = '29261011222333000144570010000043211112233440'
// fixture inline: cteProc com ide/mod 57, tpAmb 1, emit CNPJ 11222333000144, toma3 toma=3 (destinatário), dest CNPJ 66764497000122,
// vPrest/vTPrest 120.00, ICMS00 vICMS 8.40, CFOP 5353, infNFe/chave = CHAVE_CRBS, protCTe cStat 100
test('lê o CT-e: valor, tomador e notas transportadas', () => {
  const c = lerCte(XML_CTE)
  assert.equal(c.chave, CTE); assert.equal(c.valorPrestacao, 120); assert.equal(c.icms, 8.4); assert.equal(c.tomadorCnpj, '66764497000122')
  assert.deepEqual(c.chavesNfe, ['29260956228356015244550220001310551123456788'])
  assert.deepEqual(validarCteImportado(c, '66764497000122'), [])
  assert.deepEqual(validarCteImportado(c, '11111111000111'), ['Este CT-e não é pago por esta loja (tomador 66764497000122).'])
})
test('rateio do CT-e entre notas e entre itens fecha no centavo (HIPÓTESE N8)', () => {
  assert.deepEqual(ratearFreteCte(120, [{ compraId: 1, valorNota: 922.63 }, { compraId: 2, valorNota: 300 }]), [{ compraId: 1, valor: 90.56, percentual: 75.4627 }, { compraId: 2, valor: 29.44, percentual: 24.5373 }])
  assert.deepEqual(ratearFreteItens(90.56, [{ linha: 1, base: 163 }, { linha: 2, base: 632.6 }, { linha: 3, base: 36.08 }]), [{ linha: 1, valor: 17.75 }, { linha: 2, valor: 68.88 }, { linha: 3, valor: 3.93 }])
})
```
SQL `186_cte_frete_funcoes.sql`: (a) compra do cenário A da Task 6 ainda não lançada + CT-e com 90,56 para ela → `frete_cte` 17,75 / 68,88 / 3,93; com marcação Frete = S no Corona e lançamento → `custo_unitario` = (632,60 + 68,88) / 96 = 7.307083; os itens com Frete = N entram com o custo de sempre (1.358333 e 3.3225); (b) **`CT-e em compra com item lançado é recusado`**: `vincular_cte_compra` numa compra com 1 item lançado levanta `A nota … já entrou no estoque: desfaça a entrada, ligue o CT-e e confirme de novo.`; (c) Σ do rateio ≠ valor do CT-e → erro; (d) `desvincular` zera `frete_cte`. `raise notice '186 OK'`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/estoque/cte-xml.test.ts` e o SQL na cópia local com 184/185.
Expected: FAIL.

- [ ] **Step 3: Implementar** (assinaturas acima; `FreteCteNF` na nota própria: "Frete (CT-e)" com "Enviar XML do CT-e" e "Informar frete sem XML", lista dos CT-e ligados com o valor que coube nesta nota e "Desligar"; texto `'O frete entra no custo só dos itens com "Frete é custo de estoque" marcado.'`. `BuscarPorChave`: campo de 44 dígitos com a mensagem do resultado: completa → abre a nota; resumo → `'A SEFAZ mandou só o resumo: o XML completo chega depois da ciência da operação.'`).

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/estoque/cte-xml.test.ts lib/compras/custo-estoque-item.test.ts && npx tsc --noEmit` + SQL `186_*` e `185_*`.
Expected: PASS; `NOTICE: 186 OK`, `185 OK`.

- [ ] **Step 5: Commit**

```bash
git add lib/estoque/cte-xml.ts lib/estoque/cte-xml.test.ts supabase/migrations/186_cte_frete_funcoes.sql scripts/testes-sql/186_cte_frete_funcoes.sql components/nota-fiscal/FreteCteNF.tsx components/nota-fiscal/BuscarPorChave.tsx lib/estoque/sefaz-sync.ts lib/actions/nota-fiscal-proprio.ts "app/(app)/nota-fiscal" lib/offline/politica.ts lib/offline/registro-acoes.ts
git commit -m "feat(estoque-proprio): CT-e de frete no custo do item e nota pela chave digitada (migration 186)"
```

- [ ] **Step 6: [OK do dono] Prova (depois da 186 + deploy)**

Run: com o primeiro CT-e real da ODARA (XML do transportador), ligar à nota antes de lançar e comparar `estoque_movimentos.custo_unitario × quantidade` de cada item com (valor de estoque do item + parte do CT-e) calculado à mão a partir dos dois XMLs.
Expected: diferença ≤ R$ 0,01 por item. Sem CT-e real na ODARA até o fim da fase: registrar no AGENTS.md que a regra segue HIPÓTESE N8 e não marcar B9 como provado.

---

### Task 12: Regressão do modo Omie [Global Constraints]

**Files:**
- Create: `lib/estoque/fase-b-omie-intacto.test.ts`, `scripts/testes-sql/185_omie_intacto.sql`

**Interfaces:**
- Consumes: tudo das Tasks 1–11.
- Produces: testes que falham se algum caminho do modo Omie mudar.

- [ ] **Step 1: Escrever os testes**

```ts
// lê o código-fonte; helpers ler, semComentarios e corpoDe copiados de nf-despacho.test.ts
test('ações novas da nota recusam loja que não é própria antes de tudo', () => {
  const src = ler('lib/actions/nota-fiscal-proprio.ts')
  for (const fn of ['configurarItemNF', 'marcarConferidaNF', 'salvarObservacaoNF', 'manifestarNotaSefaz', 'importarCteNF', 'informarFreteNF', 'desvincularCteNF', 'buscarNotaPorChaveNF'])
    assert.ok(/await contexto\(/.test(corpoDe(src, fn)), `${fn} sem contexto() (despacho por modo)`)
})
test('peças novas nunca importam nem chamam o Omie', () => {
  for (const f of ['lib/estoque/nf-item-regras.ts', 'lib/estoque/nf-memoria.ts', 'lib/estoque/nfe-validacao.ts', 'lib/estoque/nfe-assinatura.ts', 'lib/estoque/sefaz-manifestacao.ts', 'lib/estoque/cte-xml.ts', 'lib/estoque/nf-etapas.ts', 'lib/estoque/nf-historico.ts'])
    assert.ok(!/@\/lib\/omie\/|omieRequest|Recebimento\(/.test(semComentarios(ler(f))), f)
})
test('manifestarNF do Omie continua chamando concluirRecebimento depois do despacho por modo', () => {
  const corpo = corpoDe(ler('lib/actions/nota-fiscal.ts'), 'manifestarNF')
  assert.ok(corpo.includes('concluirRecebimento(nf.loja, Number(nf.n_id_receb))') && corpo.includes("modoDaLoja("))
})
test('ItensNotaFiscal: colunas novas só leem full_object.itensAjustes (sem consulta, sem edição)', () => {
  const src = ler('components/nota-fiscal/ItensNotaFiscal.tsx')
  assert.ok(src.includes('cCFOPEntrada') && src.includes('cNaoGerarMovEstoque') && !/from\(['"]compras_proprio/.test(src))
})
test('etapas e histórico novos só aparecem em loja própria', () => {
  assert.ok(ler('app/(app)/nota-fiscal/etapas/page.tsx').includes("redirect('/nota-fiscal')"))
  assert.ok(/proprio \?[\s\S]*HistoricoProcessamentoNF[\s\S]*HistoricoStatusNF/.test(ler('app/(app)/nota-fiscal/[id]/page.tsx')))
})
```
`scripts/testes-sql/185_omie_intacto.sql` (cópia local com os itens de NF da loja 5 de set/2026 copiados por `copy … to stdout`): guarda `md5(string_agg(custo_estoque_item_omie(full_object, n_qtde_nfe, n_preco_unit)::text, ',' order by id))` e `relatorio_compras_total(5, '2026-09-01', '2026-09-30')` ANTES de aplicar a 185, aplica, recalcula e `raise exception` se mudou. Mesma consulta vai para o P-MIG da 185 em produção (Task 14).

- [ ] **Step 2: Rodar**

Run: `node --test lib/estoque/fase-b-omie-intacto.test.ts lib/estoque/nf-despacho.test.ts lib/estoque/modo-despacho.test.ts` + o SQL na cópia local.
Expected: PASS; `NOTICE: Omie intacto (md5 igual, Compras set/2026 igual)`.

- [ ] **Step 3: Commit**

```bash
git add lib/estoque/fase-b-omie-intacto.test.ts scripts/testes-sql/185_omie_intacto.sql
git commit -m "test(estoque): regressão do modo Omie na Fase B (código e custo da Fase A)"
```

---

### Task 13: [OK do dono] Validar a captura da SEFAZ ao vivo com a ODARA [B7, A2]

Nunca rodou contra a SEFAZ real (AGENTS.md, "Ainda NÃO validado ao vivo"). Operação, sem código; pode correr em paralelo às Tasks 1–12 (código já no ar desde 06/10). Fora de 00:00–07:00 Bahia não é exigência aqui (não é o Omie), mas fazer em horário de expediente com o dono acompanhando.

**Files:** `AGENTS.md` (registro).

**Interfaces:**
- Consumes: `sincronizarSefaz` (`lib/estoque/sefaz-sync.ts`), certificado A1 da ODARA (`lojas.certificado_path`).
- Produces: R11 decidido com dado (assinatura de aviso para erro ou não) e o primeiro NSU real.

- [ ] **Step 1: Conferir a configuração (só leitura)**

Run: `select id, nome, is_test, modo_estoque, cnpj, uf, certificado_path is not null as cert from lojas where id = 15;` e `select * from sefaz_nsu where loja_id = 15;`
Expected: `proprio`, `is_test = false`, CNPJ com 14 dígitos, `uf` certo, `cert = t`; `sefaz_nsu` vazio ou `ult_nsu = '0'`.

- [ ] **Step 2: [OK] Primeira consulta só de leitura**

Run: `update sefaz_nsu set auto_ciencia = false, auto_lancar = false, ambiente = 1, ativo = true where loja_id = 15;` (ou `insert` se não existir) e, como usuário logado da ODARA, "Buscar na SEFAZ" (`/api/sync/notas-fiscais`) UMA vez.
Expected: `ultimo_cstat` 138 (documentos) ou 137 (nada novo), `ult_nsu` avançou, `sefaz_documentos` com os NSU recebidos, resumos como notas "Recebida (aguardando XML)". 656 → registrar `bloqueado_ate`, esperar 1 h, não repetir antes. Erro de certificado/TLS → registrar e parar.

- [ ] **Step 3: [OK] Primeira ciência**

Run: `update sefaz_nsu set auto_ciencia = true where loja_id = 15;` e uma nova execução (o cron também faz).
Expected: `ciencia_cstat` 135 (ou 573) nos resumos; em seguida a busca por chave traz o `procNFe` e a nota fica completa e "A conferir". 225 ou outro → registrar e parar.

- [ ] **Step 4: Medir a assinatura das notas reais (só leitura)**

Run: no servidor, `node` lendo os `xml` de `sefaz_documentos` `tipo='procNFe'` da loja 15 e chamando `assinaturaConfere` (Task 2).
Expected: registrar quantas conferem. Todas → promover "assinatura não confere" de aviso para erro (mudança de 1 linha em `nfe-validacao.ts`, com teste) no Lote 3; alguma não → manter aviso e anotar o caso.

- [ ] **Step 5: [OK] Religar o lançamento automático, se o dono quiser**

Run: `update sefaz_nsu set auto_lancar = true where loja_id = 15;` só depois do Lote 3 no ar (as regras novas de R9 valem para o automático).

- [ ] **Step 6: Registrar no AGENTS.md** (troca o parágrafo "Ainda NÃO validado ao vivo" pelos números: cStat de cada passo, NSU, quantas notas, assinatura) e commit `docs: SEFAZ validada ao vivo na ODARA`.

---

### Task 14: [OK do dono] Lote 3 em produção e provas

**Files:** `AGENTS.md` (seção "Paridade com o Omie — Fase B").

**Interfaces:** Consumes Tasks 0–12 (Task 11 vai no Lote 5 se ainda não estiver pronta).

- [ ] **Step 1: Medir antes (só leitura)**

Run: em produção, a consulta de checksum de `scripts/testes-sql/185_omie_intacto.sql` para as lojas 2–7 (set/2026) e `relatorio_compras_total(<loja>, '2026-09-01', '2026-09-30')` de cada uma; `select status, count(*) from compras_proprio where loja_id = 15 group by 1;`.
Expected: números guardados no relatório da task.

- [ ] **Step 2: [OK] P-MIG 184, depois 185**

Expected: `\df` 1 overload em `custo_estoque_item_omie`, `lancar_compra`, `registrar_compra_sefaz`, `vincular_item_compra`, `estornar_compra`, `sincronizar_situacao_nota`, `configurar_item_compra`, `marcar_compra_conferida`, `memoria_itens_compra`, `item_compra_full_object`, `projetar_itens_compra_na_nota`. Logo depois da 185, a consulta do Step 1 de novo: **checksum e totais de Compras iguais nas lojas 2–7** (se não, restaurar as funções de `/root/backups-ntb-estoque/pre-185-*.sql` e parar). O código antigo segue no ar e funciona (R2/R3).

- [ ] **Step 3: [OK] Merge, deploy, desktop**

Run: merge `paridade-omie` → `main`, push, deploy síncrono, `curl` = `HTTP 200`; `desktop/scripts/gerar-schema.sh` + versão nova do app desktop.

- [ ] **Step 4: Prova na ODARA (P-PROVA)**

Run: na próxima nota real da ODARA (SEFAZ ou XML): abrir, conferir as sugestões de cada item, marcar conferida, confirmar entrada; depois
```sql
select i.linha, i.quantidade, i.valor_total_item, i.origem_flags, i.cfop_entrada, m.codigo_local_estoque, m.quantidade, m.custo_unitario, round(m.quantidade * m.custo_unitario, 2) as entrou,
       custo_estoque_item_omie(nfi.full_object, nfi.n_qtde_nfe, nfi.n_preco_unit) as valor_estoque_relatorio
from compras_proprio_itens i join compras_proprio c on c.id = i.compra_id
join estoque_movimentos m on m.id = i.movimento_id
join nota_fiscal_items nfi on nfi.nota_fiscal_id = c.nota_fiscal_id and nfi.n_sequencia = i.linha
where c.loja_id = 15 and c.id = <compra>;
```
e o mesmo cálculo à mão a partir do XML (vTotalItem − o que as marcações tiram).
Expected: `entrou` = `valor_estoque_relatorio` = cálculo à mão (± R$ 0,01 por item); local e CFOP de entrada como configurados; `/relatorio-compras` da ODARA mostra a nota com o CFOP de entrada e o valor de estoque; histórico da nota com criada → conferida → lançada; quadro de etapas com a nota em "Lançada".

- [ ] **Step 5: Lote 4 (Task 10) e Lote 5 (Task 11)** — cada um: [OK] deploy (e P-MIG da 186 no Lote 5), depois o Step 6 da própria task.

- [ ] **Step 6: Registrar no AGENTS.md e commit**

Seção nova "Paridade com o Omie — Fase B": migrations 184–186 e ordem, R1–R17 resumidas, o que é hipótese (N3b frete/seguro, N8 CT-e, FCP-ST junto da ST, crédito do Simples), números das provas. `git commit -m "docs: Fase B da paridade com o Omie no AGENTS.md"`.

---

## Ordem de execução e portões

Legenda: **[OK]** = precisa do OK explícito do dono no chat antes de executar aquele passo. Todo deploy, toda migration em produção, toda mudança em `sefaz_nsu` e toda chamada que escreve na SEFAZ é **[OK]**, sem exceção. Leitura (SQL só leitura, `\df`, consulta de distribuição já ligada pelo cron) não precisa.

| Lote | Tasks | Portões [OK] | Observação |
|---|---|---|---|
| 0 | 0 | — | Fase A (175–183) aplicada e publicada. Faltou algo → parar. |
| 1 | 13 (B7) | mudar `sefaz_nsu` da ODARA; 1ª consulta; 1ª ciência; religar `auto_lancar` (só depois do Lote 3) | Em paralelo ao código. O resultado da assinatura decide R11 antes do Lote 3. |
| 2 | 1 → 2 → 3 → 4 | nenhum | Só código puro e testes. |
| 3 | 5 → 6 → 7 → 8 → 9 → 12 → 14 | migration 184; migration 185 (checksum do modo Omie antes/depois); merge + deploy; versão do desktop | Migrations antes do código. Se o checksum do Omie mudar, restaurar as funções da 185 e parar. |
| 4 | 10 (B6) | deploy; **1ª manifestação real** (ODARA, uma nota já recebida, "Confirmar a operação") | Nunca automática. Recusa da SEFAZ → registrar, não repetir. |
| 5 | 11 (B9, A4) | migration 186; deploy; versão do desktop; 1ª busca por chave real; prova com o 1º CT-e real | Captura automática do CT-e = plano posterior (R13). |

Dentro de cada lote: implementar e testar todas as tasks (sem produção) → pedir o OK mostrando os testes e o que vai mudar → P-MIG de cada migration na ordem numérica → deploy → P-PROVA. Falhou uma prova: parar o lote, não seguir para o próximo.
