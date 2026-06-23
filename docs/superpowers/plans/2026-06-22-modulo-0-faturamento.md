# Módulo 0 — Faturamento (NF de saída/NFC-e) — Plano de Implementação

> **For agentic workers:** implementar task a task. O Módulo 0 é GATEADO pela Task 1
> (spike): só faz sentido continuar se o Omie entregar a NFC-e/saída.

**Goal:** ter o faturamento (vendas/NFC-e) da loja no nosso banco, AGREGADO, para
destravar os relatórios de Faturamento, Margem e Indicadores Fat×Compras.

## RESULTADO DO SPIKE (Task 1) — 22/06: NO-GO via Omie
- `v1/produtos/nfconsultar` / `ListarNF` (`{pagina, registros_por_pagina, dEmiInicial,
  dEmiFinal}`) devolve **só NF-e de ENTRADA** (modelo 55, tpNF=0). Jan/2026 loja 3 = 215
  notas, todas entrada. **Zero saída.** O faturamento do PDV é **NFC-e (modelo 65)**, que
  esse endpoint NÃO lista; a API de cupom do Omie é só de import. → **Faturamento via Omie
  inviável; precisa do fallback** (importar o export FAT periodicamente, ou integrar o PDV).
- **BÔNUS:** o `nfconsultar` é uma fonte de Compras MUITO mais rica (toda a fiscal:
  Situação Tributária ICMS/ST, CFOP entrada × documento, "não deve se creditar",
  títulos/conta a pagar, total do documento) → **destrava o Módulo B (auditoria fiscal)**.
- **Decisão:** Módulo 0/C/D/E parados (dependem do fallback). Seguir por **A (Movimentação)**
  e/ou **B (Auditoria fiscal, via nfconsultar)**.

**Architecture:** mesmo padrão do sync de NF de entrada (`lib/omie/nota-fiscal.ts` +
cron), mas (1) lendo a NF de SAÍDA do Omie e (2) AGREGANDO no cliente antes de gravar
(resumo por produto/dia/forma de pgto), porque cupom a cupom não cabe no free tier.

**Tech Stack:** Next.js 16, Supabase (pg), Omie REST (`omieRequest`), cron via GitHub
Actions (rodízio 1 loja/hora).

## Global Constraints (verbatim do projeto)
- Custo zero (free tier): NÃO guardar cupom a cupom; só agregado.
- Nunca testar escrita ao vivo na loja 4 ("O SERTAO VAI VIRAR MAR"); usar loja 3
  (Donana Rio Vermelho). Spike é READ-ONLY.
- SQL acentuado nunca via PowerShell; migrations via `node scripts/aplicar-migration.mjs`.
- `tsc --noEmit` (nunca `npm run build`).

---

### Task 1: SPIKE — confirmar o endpoint de NF de saída/NFC-e no Omie (go/no-go)

**Files:**
- Create (temporário, apagar no fim): `scripts/_spike-fat.mjs`

**Objetivo:** descobrir se a API do Omie retorna as vendas (NFC-e/NF-e emitida) com
valor, item e forma de pagamento, para a loja 3.

- [ ] **Passo 1: achar o endpoint** — pesquisar a doc do Omie (notas emitidas / NF-e /
  NFC-e / "ListarNF" / DF-e). Candidatos: `v1/produtos/nfconsultar` (ListarNF/ConsultarNF),
  `v1/produtos/dfedocs`, módulo de cupom fiscal.
- [ ] **Passo 2: testar contra a loja 3 (read-only)** — script que lê as chaves do
  Omie da loja 3 (do banco) e chama o(s) candidato(s) com período curto (ex.: 01–07/01/2026),
  imprimindo a estrutura da resposta (campos de valor, item, forma de pgto, tipo SPED).
- [ ] **Passo 3: validar o número** — somar o faturamento de um mês e comparar com a
  aba "Fat vs tipo de produto" do FAT_DRV (jan/2026 ≈ R$861.600 total).
- [ ] **Passo 4: decisão**
  - **GO** (endpoint entrega): seguir Task 2 (definir o mapeamento de campos a partir
    da resposta real) → Task 3 (tabela) → Task 4 (sync agregado) → Task 5 (cron).
  - **NO-GO** (não entrega): registrar o motivo; pivotar para o fallback (import do
    export FAT) OU priorizar Módulos A/B (independentes). NÃO seguir Task 2+.
- [ ] **Passo 5:** apagar `scripts/_spike-fat.mjs`.

---

### Tasks 2–5 (detalhadas APÓS o GO da Task 1, com base na resposta real do Omie)

- **Task 2 — Mapeamento de campos:** a partir da resposta do spike, definir quais
  campos viram qtde/valor/tipo/forma de pgto (não dá pra escrever o código TDD antes
  de ver os nomes reais; por isso é gateado pela Task 1).
- **Task 3 — Migration `faturamento_dia`** (loja_id, data, n_cod_prod, tipo_item,
  descricao_familia, qtde, valor, forma_pagamento) + índices loja_id+data; RLS por loja.
- **Task 4 — `lib/omie/faturamento.ts`** (`syncFaturamento`, paginado, agrega no
  cliente, upsert no `faturamento_dia`), espelhando `nota-fiscal.ts`.
- **Task 5 — Cron** (`/api/cron/sync-faturamento` + rodízio no workflow) e `/api/sync/faturamento`.

> Estas tasks ficam propositalmente sem código até a Task 1 dar GO — escrever steps
> TDD com nomes de campo inventados seria placeholder. A Task 1 resolve isso.
