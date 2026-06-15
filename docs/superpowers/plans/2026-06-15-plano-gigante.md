# Plano Gigante — NTB Estoque (reunião 15/06 + tudo que a API do Omie destrava)

> **Execução:** superpowers:executing-plans (inline) ou subagent-driven. Passos com checkbox.

**Goal:** Levar o NTB Estoque a comunicar-se de forma completa e fiel com o Omie (todos os dados, com histórico e datas corretas), corrigir os bugs da reunião 15/06, e ampliar o sistema com tudo que a API permite (financeiro, relatórios, Sefaz, entrada de NF), deixando-o muito melhor que o Laravel original.

**Arquitetura:** Next.js 16 + Supabase + Vercel; integração Omie por API (mapa em `docs/superpowers/specs/2026-06-15-mapa-api-omie.md`). Sincronização por webhook + cron (GitHub Actions, 1 loja/run em rodízio). Tudo com histórico no Postgres.

**Regras travadas:** status no banco sem acento; sem travessão; acento no visível; nunca disparar finalização/escrita no Omie em teste sem o Ramon; datas em America/Bahia; certificado e segredos nunca em git/log; assinar Joaquim Salles.

---

## BLOCO 1 — Fundação: sincronização total + histórico fiel ao Omie
Garantir que **tudo** que o Omie tem chega ao nosso banco, com histórico, e que datas/registros funcionam de verdade.

- [ ] **1.1 Estoque mínimo da posição** — `lib/omie/posicao-estoque.ts`: o `estoque_minimo` vem em `ListarPosEstoque` (não no cadastro). Mapear `estoque_minimo` na `posicao_estoques` e expor por produto. Substitui o campo manual atual (`produtos.estoque_minimo` vira fallback/override). Backfill + sync.
- [ ] **1.2 Dados completos da empresa por loja** — migration: campos `razao_social, inscricao_estadual, inscricao_municipal, cnae, regime_tributario, csc_producao, csc_id_producao` em `lojas`; `lib/omie/empresa.ts` (novo) com `ListarEmpresas`; sync que preenche a loja com os dados do Omie.
- [ ] **1.3 Auditoria de cobertura de sync** — conferir produto/NF/OP/posição/movimentos: cada campo relevante do `full_object` está sendo persistido? Listar gaps e preencher (ex.: `adicionais_d_dt_inicio` da OP, etc.).
- [ ] **1.4 Histórico garantido** — confirmar que `posicao_estoques` (com `data_posicao`), `movimentos`, `inventarios`, `transferencias` guardam histórico e nada é sobrescrito sem registro. Onde faltar data/auditoria, adicionar.

## BLOCO 2 — Estoque mínimo + Sugestão de compra de verdade
- [ ] **2.1 Mínimo puxado do Omie** (depende 1.1) — coluna "Mínimo" mostra o valor real do Omie; manual vira override opcional.
- [ ] **2.2 Sugestão de compra completa** — `compra = mínimo + previsão de venda − saldo`. Previsão de venda: saídas do ano anterior (`ListarMovimentos`, já feito) **+** cruzar com `ConsultarPrevisao` (previsão nativa do Omie). Comparar e usar a melhor.
- [ ] **2.3 Alerta de reposição** — destacar/filtrar produtos abaixo do mínimo na tela de produtos (modo Compras).

## BLOCO 3 — Operação igual ao Omie (datas, histórico, lógica, bugs)
- [ ] **3.1 Inventário com data real** — `NovoInventario.tsx` + `createInventario`: campo de data (default hoje, permite retroativa/D-1), grava `inventarios.data`, e o ajuste no Omie usa essa data. Registro histórico.
- [ ] **3.2 Transferência com data** — `NovaTransferencia.tsx` + `createTransferencia`: campo de data (retroativa) gravando `transferencias.data`; confirmar nome do depósito + motivo TRF/TPQ no deploy.
- [ ] **3.3 Filtro "não concluído" da OP** — `ordem-producao/page.tsx`: corrigir `isConcluida` (considerar `adicionais_d_dt_conclusao` E `full_object.outrasInf.cConcluida`) e marcar visualmente.
- [ ] **3.4 Filtro de família completo** — produtos: trazer todas as famílias (hoje corta) e garantir aplicação.
- [ ] **3.5 Auditoria das lógicas vs Omie** — comparar nosso fluxo (tipos TRF/TPQ/INV/INI, origem AJU, datas, CMC, ajuste) com o comportamento real da API; corrigir divergências.

## BLOCO 4 — Ordem de Produção (UX e regras)
- [ ] **4.1 Layout da criação igual transferência** — busca fixa em cima, lista de produtos descendo.
- [ ] **4.2 Validade por produto** na lista (data de início igual; validade por item).
- [ ] **4.3 Status na listagem** — Prevista (futura) / Pendente / Atrasada / Concluída; esconder "Concluir" nas concluídas.
- [ ] **4.4 Bug visual da recorrência** — OP futura aparece com data de hoje; usar a data real da OP.
- [ ] **4.5 Ordenação + filtro mês corrente** — ordenar por A-Z/Z-A/código/qtd/validade; filtro default no mês corrente.

## BLOCO 5 — Loja/Empresa + Certificado + Sefaz
- [ ] **5.1 Cadastro de loja completo** (depende 1.2) — tela mostra/edita todos os dados da empresa, com botão "Puxar do Omie".
- [ ] **5.2 Certificado digital A1** — upload (.pfx) + senha, em Supabase Storage privado, senha **criptografada**; campo de validade. ⚠️ Dado sensível.
- [ ] **5.3 Manifestação Sefaz** — `lib/omie/dfe.ts` (novo) com `ListarDocumentos` (`dfedocs`): puxar notas recebidas do Sefaz para a entrada de NF.

## BLOCO 6 — Entrada de NF em 2 cliques
- [ ] **6.1 Listar notas pendentes de entrada** — `ListarRecebimentos` / `dfedocs`.
- [ ] **6.2 Validação automática** — CFOP correto, impostos, produtos cadastrados e associados internamente; apontar erros (ex.: ICMS 90 em CFOP de revenda).
- [ ] **6.3 Concluir recebimento em 2 cliques** — receber + conferir + concluir no Omie.

## BLOCO 7 — Financeiro + Relatórios (com as planilhas do Ramon)
Fonte: Contas a Receber (faturamento), Contas a Pagar (compras), Movimento Financeiro, NF.
- [ ] **7.1 Integração financeira** — `lib/omie/financeiro.ts` (novo): `ListarContasReceber`, `ListarContasPagar`, `ListarMovimentos` (mf); persistir com histórico + cron.
- [ ] **7.2 Relatórios** (seguindo as planilhas FAT/MOV/COMVSFAT/NFS_ENT/IND_PER): Faturamento (por tipo/família/forma de pagamento), Entrada de NF (por ICMS/CFOP/tipo), Movimentações (entradas/saídas/rejeito), **Faturamento × Compras** e **Faturamento × Rejeito** (indicadores com % real e % limite).
- [ ] **7.3 Dashboards** na tela + export **PDF**.
- [ ] **7.4 Automação** — cron diário atualiza os relatórios sozinho.
- [ ] **7.5 Validação fiscal** integrada à entrada de NF (Bloco 6).

## BLOCO 8 — Ampliações (o que a API destrava além do pedido)
- [ ] **8.1 Dashboard financeiro** — fluxo de caixa (`resumo`/`caixa`/`extrato`), DRE via categorias (têm `dadosDRE`).
- [ ] **8.2 Análises** — curva ABC, top produtos/famílias/fornecedores, sazonalidade (mesmo período ano anterior).
- [ ] **8.3 Fornecedores** — relatórios "compro mais de quem", por família/tipo (clientes/fornecedores: 3.350).
- [ ] **8.4 Armazenamento de histórico** — opção de exportar histórico antigo para Google Drive/OneDrive (ideia do Ramon, free tier).

---

## Ordem de execução sugerida
Bloco 1 (fundação) → 2 (mínimo/sugestão) → 3 (operação/bugs) → 4 (OP) → 5 (loja/certificado/Sefaz) → 6 (NF 2 cliques) → 7 (relatórios, quando as planilhas forem destrinchadas) → 8 (ampliações).

## Dependências / bloqueios
- Bloco 7 detalhado depende de **destrinchar as 5 planilhas** do Ramon (FAT_DRV, MOV_DRV, COMVSFAT, NFS_ENT, IND_PER) — formato exato dos relatórios.
- Bloco 5.2/6/7 que **escrevem ou puxam fiscal** precisam de teste **com o Ramon** (não disparar sozinho).
- Certificado: precisa do arquivo A1 + senha de cada loja (o Ramon fornece).
