# Sync contínuo de NF/OP pro Contabo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer `notas_fiscais`, `nota_fiscal_items` e `ordens_producao` ganharem escrita contínua pro Postgres do Contabo (hoje é só uma cópia única congelada desde 07-12), sem reintroduzir o bug de duplicação por `id` divergente que acabou de ser corrigido em `movimentos`.

**Architecture:** Mesmo padrão do dual-write de `movimentos` (2026-07-18): índice único por chave natural no Contabo, endpoint `POST .../_bulk` novo no `server.js` (upsert transacional), chamada fire-and-forget depois do upsert no Supabase, backfill retroativo lendo direto do Supabase (que ainda tem tudo). Inclui, como parte do mesmo projeto, a correção de `lib/historico-contabo.ts` pra deduplicar por chave natural em vez de `.id` nas 3 tabelas — sem isso o dual-write reintroduz a duplicação assim que ligado.

**Tech Stack:** Node/Express + `pg` (servidor Contabo), Next.js Server Actions/cron (app), Postgres (Supabase + Contabo).

## Global Constraints

- Servidor Contabo: SSH `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240`. Arquivo do servidor: `/opt/ntb-frio-api/server.js` (fora deste repo git — editar só via SSH, nunca existe cópia local). Serviço: `systemctl restart ntb-frio-api` depois de qualquer edição no `server.js`.
- Autenticação dos endpoints novos: header `X-Api-Key` == `process.env.API_KEY`, middleware `checkAuth` já existe no `server.js` — reusar, não duplicar.
- Tipos: `types.setTypeParser(20, ...)` (bigint→Number) e `types.setTypeParser(1082, ...)` (date→string crua) já configurados globalmente no topo do `server.js` — cobre as colunas novas automaticamente.
- Chaves naturais: `notas_fiscais` → `(loja_id, n_id_receb)`; `nota_fiscal_items` → `(loja_id, n_id_receb, n_sequencia)`; `ordens_producao` → `(loja_id, identificacao_n_cod_op)` (essa já tem índice único no Contabo, `uq_op_loja_cod` — confirmado via `\d ordens_producao`, nada a criar ali).
- Lote de escrita: 200 linhas por request pros bulks de NF (mesmo tamanho de `/movimentos_bulk`/`/fat_cupons_bulk`); 100 pro de OP (mesmo tamanho de página já usado em `syncOrdensProducao`).
- Sem suite automatizada neste repo — verificação manual (`curl`, `node scripts/db.mjs`, `psql` via SSH, contagens `select count(*)`).
- `.env.local` e `scripts/.pooler-host` não são copiados automaticamente pra worktrees — copiar manualmente se for usar uma.
- Ação em banco/servidor de produção real requer confirmação explícita do usuário antes de aplicar: Task 1 (DDL no Contabo), Task 2 (edita `server.js` em produção), Task 6 (backfill, escreve no Contabo com dado real das 6 lojas).
- Nenhuma mudança de comportamento no upsert do Supabase existente — o dual-write é sempre uma chamada A MAIS, fire-and-forget, depois do upsert já ter sucesso. Falha no Contabo nunca lança nem bloqueia o fluxo principal (só `console.error`).

---

### Task 1: Índices únicos em `notas_fiscais`/`nota_fiscal_items` no Contabo

**Files:** nenhum (DDL aplicado direto via SSH, schema do Contabo não é gerenciado pelas migrations do Supabase).

**Interfaces:**
- Produces: índices únicos `notas_fiscais_loja_receb_unique` e `nota_fiscal_items_loja_receb_seq_unique` em `ntb_frio`. Task 2 (endpoints) depende deles pra usar `ON CONFLICT`.

- [ ] **Step 1: Escrever o DDL num arquivo local**

Criar `/private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/nf-indices.sql` com:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS notas_fiscais_loja_receb_unique
  ON public.notas_fiscais (loja_id, n_id_receb);

CREATE UNIQUE INDEX IF NOT EXISTS nota_fiscal_items_loja_receb_seq_unique
  ON public.nota_fiscal_items (loja_id, n_id_receb, n_sequencia);
```

- [ ] **Step 2: Pedir confirmação e aplicar via SSH**

DDL em banco de produção real — confirmar com o usuário antes de rodar. Depois de confirmado:

```bash
cat /private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/nf-indices.sql | ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "sudo -u postgres psql -d ntb_frio"
```

Se der erro de linhas duplicadas na chave (não deveria — a cópia de 07-12 nunca duplicou `n_id_receb`/`n_sequencia` por loja), parar e investigar antes de continuar — não usar `CREATE INDEX ... WHERE` pra contornar sem entender a causa.

- [ ] **Step 3: Verificar**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "sudo -u postgres psql -d ntb_frio -tAc \"select indexname from pg_indexes where tablename in ('notas_fiscais','nota_fiscal_items') and indexname like '%unique%'\""
```
Esperado: as duas linhas `notas_fiscais_loja_receb_unique` e `nota_fiscal_items_loja_receb_seq_unique`.

---

### Task 2: Endpoints novos `POST /notas_fiscais_bulk` e `POST /ordens_producao_bulk` na `ntb-frio-api`

**Files:**
- Modify (via SSH, fora deste repo git): `/opt/ntb-frio-api/server.js`

**Interfaces:**
- Consumes: `checkAuth` e `pool` já existentes no `server.js`; índices da Task 1; `uq_op_loja_cod` (já existe).
- Produces: `POST /notas_fiscais_bulk` (body `{ loja_id, notas: [{ n_id_receb, n_id_fornecedor, c_pessoa_fisica, c_nome, c_razao_social, c_inscricao, c_cnpj_cpf, c_chave_nfe, c_etapa, c_numero_nfe, c_serie_nfe, c_modelo_nfe, d_emissao_nfe, n_valor_nfe, c_ambiente_nfe, c_natureza_operacao, full_object, itens: [{ n_sequencia, n_id_item, n_id_pedido, n_id_it_pedido, n_id_produto, c_codigo_produto, c_descricao_produto, c_ignorar_item, c_adicionar_novo, c_associar_existente, c_item_devolvido, c_ncm, c_ean, c_cfop, n_qtde_nfe, c_unidade_nfe, n_preco_unit, full_object }] }] }`) e `POST /ordens_producao_bulk` (body `{ loja_id, ordens: [{ num_ordem, identificacao_n_cod_op, identificacao_c_cod_int_op, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_d_dt_previsao, identificacao_n_qtde, identificacao_codigo_local_estoque, concluida, dt_conclusao_real, dt_inclusao, full_object }] }`). Tasks 3, 4 e 6 consomem.

- [ ] **Step 1: Confirmar a estrutura atual do `server.js` antes de editar**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "grep -n \"app.get\\|app.post\" /opt/ntb-frio-api/server.js"
```
Confirmar que `POST /movimentos_bulk` e `GET /health` existem (a rota nova entra **antes** de `app.get('/health', ...)`, mesmo padrão de `movimentos_bulk`/`fat_cupons_bulk`).

- [ ] **Step 2: Escrever o bloco das 2 rotas novas num arquivo local**

Criar `/private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/nf-op-bulk-routes.js` com:

```js
app.post('/notas_fiscais_bulk', checkAuth, async (req, res) => {
  const { loja_id, notas } = req.body || {};
  if (!loja_id || !Array.isArray(notas)) {
    return res.status(400).json({ error: 'loja_id e notas (array) sao obrigatorios' });
  }
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const nf of notas) {
      const cabecResult = await client.query(
        `insert into notas_fiscais (loja_id, n_id_receb, n_id_fornecedor, c_pessoa_fisica, c_nome, c_razao_social, c_inscricao, c_cnpj_cpf, c_chave_nfe, c_etapa, c_numero_nfe, c_serie_nfe, c_modelo_nfe, d_emissao_nfe, n_valor_nfe, c_ambiente_nfe, c_natureza_operacao, full_object)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         on conflict (loja_id, n_id_receb) do update set
           n_id_fornecedor = excluded.n_id_fornecedor, c_pessoa_fisica = excluded.c_pessoa_fisica,
           c_nome = excluded.c_nome, c_razao_social = excluded.c_razao_social,
           c_inscricao = excluded.c_inscricao, c_cnpj_cpf = excluded.c_cnpj_cpf,
           c_chave_nfe = excluded.c_chave_nfe, c_etapa = excluded.c_etapa,
           c_numero_nfe = excluded.c_numero_nfe, c_serie_nfe = excluded.c_serie_nfe,
           c_modelo_nfe = excluded.c_modelo_nfe, d_emissao_nfe = excluded.d_emissao_nfe,
           n_valor_nfe = excluded.n_valor_nfe, c_ambiente_nfe = excluded.c_ambiente_nfe,
           c_natureza_operacao = excluded.c_natureza_operacao, full_object = excluded.full_object,
           updated_at = now()
         returning id`,
        [loja_id, nf.n_id_receb, nf.n_id_fornecedor, nf.c_pessoa_fisica, nf.c_nome, nf.c_razao_social,
         nf.c_inscricao, nf.c_cnpj_cpf, nf.c_chave_nfe, nf.c_etapa, nf.c_numero_nfe, nf.c_serie_nfe,
         nf.c_modelo_nfe, nf.d_emissao_nfe, nf.n_valor_nfe, nf.c_ambiente_nfe, nf.c_natureza_operacao,
         nf.full_object ? JSON.stringify(nf.full_object) : null]
      );
      const notaFiscalId = cabecResult.rows[0].id;
      for (const it of (nf.itens || [])) {
        await client.query(
          `insert into nota_fiscal_items (loja_id, nota_fiscal_id, n_id_receb, n_sequencia, n_id_item, n_id_pedido, n_id_it_pedido, n_id_produto, c_codigo_produto, c_descricao_produto, c_ignorar_item, c_adicionar_novo, c_associar_existente, c_item_devolvido, c_ncm, c_ean, c_cfop, n_qtde_nfe, c_unidade_nfe, n_preco_unit, full_object)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           on conflict (loja_id, n_id_receb, n_sequencia) do update set
             nota_fiscal_id = excluded.nota_fiscal_id, n_id_item = excluded.n_id_item,
             n_id_pedido = excluded.n_id_pedido, n_id_it_pedido = excluded.n_id_it_pedido,
             n_id_produto = excluded.n_id_produto, c_codigo_produto = excluded.c_codigo_produto,
             c_descricao_produto = excluded.c_descricao_produto, c_ignorar_item = excluded.c_ignorar_item,
             c_adicionar_novo = excluded.c_adicionar_novo, c_associar_existente = excluded.c_associar_existente,
             c_item_devolvido = excluded.c_item_devolvido, c_ncm = excluded.c_ncm, c_ean = excluded.c_ean,
             c_cfop = excluded.c_cfop, n_qtde_nfe = excluded.n_qtde_nfe, c_unidade_nfe = excluded.c_unidade_nfe,
             n_preco_unit = excluded.n_preco_unit, full_object = excluded.full_object, updated_at = now()`,
          [loja_id, notaFiscalId, nf.n_id_receb, it.n_sequencia, it.n_id_item, it.n_id_pedido, it.n_id_it_pedido,
           it.n_id_produto, it.c_codigo_produto, it.c_descricao_produto, it.c_ignorar_item, it.c_adicionar_novo,
           it.c_associar_existente, it.c_item_devolvido, it.c_ncm, it.c_ean, it.c_cfop, it.n_qtde_nfe,
           it.c_unidade_nfe, it.n_preco_unit, it.full_object ? JSON.stringify(it.full_object) : null]
        );
      }
    }
    await client.query('commit');
    res.json({ ok: true, notas: notas.length });
  } catch (e) {
    await client.query('rollback');
    console.error('Erro POST /notas_fiscais_bulk:', e);
    res.status(500).json({ error: 'internal error' });
  } finally {
    client.release();
  }
});

app.post('/ordens_producao_bulk', checkAuth, async (req, res) => {
  const { loja_id, ordens } = req.body || {};
  if (!loja_id || !Array.isArray(ordens)) {
    return res.status(400).json({ error: 'loja_id e ordens (array) sao obrigatorios' });
  }
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const op of ordens) {
      await client.query(
        `insert into ordens_producao (loja_id, num_ordem, identificacao_n_cod_op, identificacao_c_cod_int_op, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_d_dt_previsao, identificacao_n_qtde, identificacao_codigo_local_estoque, concluida, dt_conclusao_real, dt_inclusao, full_object)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (loja_id, identificacao_n_cod_op) do update set
           num_ordem = excluded.num_ordem, identificacao_c_cod_int_op = excluded.identificacao_c_cod_int_op,
           identificacao_c_num_op = excluded.identificacao_c_num_op,
           identificacao_n_cod_produto = excluded.identificacao_n_cod_produto,
           identificacao_d_dt_previsao = excluded.identificacao_d_dt_previsao,
           identificacao_n_qtde = excluded.identificacao_n_qtde,
           identificacao_codigo_local_estoque = excluded.identificacao_codigo_local_estoque,
           concluida = excluded.concluida, dt_conclusao_real = excluded.dt_conclusao_real,
           dt_inclusao = excluded.dt_inclusao, full_object = excluded.full_object, updated_at = now()`,
        [loja_id, op.num_ordem, op.identificacao_n_cod_op, op.identificacao_c_cod_int_op, op.identificacao_c_num_op,
         op.identificacao_n_cod_produto, op.identificacao_d_dt_previsao, op.identificacao_n_qtde,
         op.identificacao_codigo_local_estoque, op.concluida, op.dt_conclusao_real, op.dt_inclusao,
         op.full_object ? JSON.stringify(op.full_object) : null]
      );
    }
    await client.query('commit');
    res.json({ ok: true, ordens: ordens.length });
  } catch (e) {
    await client.query('rollback');
    console.error('Erro POST /ordens_producao_bulk:', e);
    res.status(500).json({ error: 'internal error' });
  } finally {
    client.release();
  }
});
```

- [ ] **Step 3: Pedir confirmação e inserir o bloco no `server.js` do servidor, antes de `app.get('/health', ...)`**

Edita `server.js` de produção real — confirmar com o usuário antes. Depois de confirmado:

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cp /opt/ntb-frio-api/server.js /opt/ntb-frio-api/server.js.bak-$(date +%Y%m%d-%H%M)"
python3 -c "
import subprocess
route = open('/private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/nf-op-bulk-routes.js').read()
remote = subprocess.run(['ssh', '-i', '$HOME/.ssh/notebook_contabo_key', 'root@185.193.66.240', 'cat /opt/ntb-frio-api/server.js'], capture_output=True, text=True).stdout
marker = \"app.get('/health'\"
idx = remote.index(marker)
novo = remote[:idx] + route + '\n' + remote[idx:]
subprocess.run(['ssh', '-i', '$HOME/.ssh/notebook_contabo_key', 'root@185.193.66.240', 'cat > /opt/ntb-frio-api/server.js'], input=novo, text=True, check=True)
print('OK, arquivo atualizado')
"
```

- [ ] **Step 4: Validar sintaxe e reiniciar o serviço**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "node -c /opt/ntb-frio-api/server.js && echo SINTAXE-OK && systemctl restart ntb-frio-api && sleep 1 && systemctl is-active ntb-frio-api"
```
Esperado: `SINTAXE-OK` seguido de `active`. Se `node -c` falhar, **restaurar o backup** (`cp server.js.bak-... server.js`) antes de investigar.

- [ ] **Step 5: Testar com 1 NF fake + 1 OP fake e depois limpar**

```bash
API_KEY=$(ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "grep '^API_KEY=' /opt/ntb-frio-api/.env | cut -d= -f2")
curl -s -X POST "https://frio-api.norteparanegocios.com.br/notas_fiscais_bulk" \
  -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"loja_id": 999999, "notas": [{"n_id_receb": "TESTE-999", "n_id_fornecedor": 1, "c_pessoa_fisica": "N", "c_nome": "teste", "c_razao_social": "teste", "c_inscricao": "", "c_cnpj_cpf": "", "c_chave_nfe": "", "c_etapa": "60", "c_numero_nfe": "0", "c_serie_nfe": "1", "c_modelo_nfe": "55", "d_emissao_nfe": "2026-07-26", "n_valor_nfe": 1.5, "c_ambiente_nfe": "1", "c_natureza_operacao": "teste", "full_object": null, "itens": [{"n_sequencia": 1, "n_id_item": 1, "n_id_pedido": 0, "n_id_it_pedido": 0, "n_id_produto": 1, "c_codigo_produto": "T1", "c_descricao_produto": "teste", "c_ignorar_item": "N", "c_adicionar_novo": "N", "c_associar_existente": "N", "c_item_devolvido": "N", "c_ncm": "0", "c_ean": "", "c_cfop": "0", "n_qtde_nfe": 1, "c_unidade_nfe": "UN", "n_preco_unit": 1.5, "full_object": null}]}]}'
curl -s -X POST "https://frio-api.norteparanegocios.com.br/ordens_producao_bulk" \
  -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"loja_id": 999999, "ordens": [{"num_ordem": "TESTE-999", "identificacao_n_cod_op": 999999999, "identificacao_c_cod_int_op": "T999", "identificacao_c_num_op": "T999", "identificacao_n_cod_produto": 1, "identificacao_d_dt_previsao": "2026-07-26", "identificacao_n_qtde": 1, "identificacao_codigo_local_estoque": 1, "concluida": false, "dt_conclusao_real": null, "dt_inclusao": "2026-07-26", "full_object": null}]}'
```
Esperado: `{"ok":true,"notas":1}` e `{"ok":true,"ordens":1}`. Depois confirmar e limpar:
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "sudo -u postgres psql -d ntb_frio -c \"delete from nota_fiscal_items where loja_id=999999\" -c \"delete from notas_fiscais where loja_id=999999\" -c \"delete from ordens_producao where loja_id=999999\""
```

---

### Task 3: Dual-write em `lib/omie/nota-fiscal.ts`

**Files:**
- Modify: `lib/omie/nota-fiscal.ts`

**Interfaces:**
- Consumes: endpoint `POST /notas_fiscais_bulk` (Task 2).
- Produces: nenhuma interface nova exportada — `gravarNotaFiscalNoFrio` é interna ao arquivo, chamada só de dentro de `saveNotaFiscal`.

- [ ] **Step 1: Adicionar as interfaces e a função de dual-write**

No topo de `lib/omie/nota-fiscal.ts`, logo após as interfaces `OmieNF*` existentes (antes de `async function saveNotaFiscal`):

```ts
interface NotaFiscalItemBulkRow {
  n_sequencia: number
  n_id_item: number
  n_id_pedido: number
  n_id_it_pedido: number
  n_id_produto: number
  c_codigo_produto: string
  c_descricao_produto: string
  c_ignorar_item: string
  c_adicionar_novo: string
  c_associar_existente: string
  c_item_devolvido: string
  c_ncm: string
  c_ean: string
  c_cfop: string
  n_qtde_nfe: number
  c_unidade_nfe: string
  n_preco_unit: number
  full_object: unknown
}

interface NotaFiscalBulkRow {
  n_id_receb: string
  n_id_fornecedor: number
  c_pessoa_fisica: string
  c_nome: string
  c_razao_social: string
  c_inscricao: string
  c_cnpj_cpf: string
  c_chave_nfe: string
  c_etapa: string
  c_numero_nfe: string
  c_serie_nfe: string
  c_modelo_nfe: string
  d_emissao_nfe: string | null
  n_valor_nfe: number
  c_ambiente_nfe: string
  c_natureza_operacao: string
  full_object: unknown
  itens: NotaFiscalItemBulkRow[]
}

// Envia a NF (cabecalho + itens) pro Contabo, fire-and-forget -- mesma
// filosofia de gravarMovimentosNoFrio (lib/omie/sync-ajustes.ts): o upsert no
// Supabase, que sustenta o sync hoje, nunca pode quebrar por causa do
// dual-write.
async function gravarNotaFiscalNoFrio(lojaId: number, nota: NotaFiscalBulkRow): Promise<void> {
  const url = process.env.NTB_FRIO_API_URL
  const key = process.env.NTB_FRIO_API_KEY
  if (!url) return
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    const resp = await fetch(`${url}/notas_fiscais_bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': key ?? '' },
      body: JSON.stringify({ loja_id: lojaId, notas: [nota] }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
  } catch (e) {
    console.error('nota-fiscal: falha ao gravar NF no Contabo', e)
  }
}
```

- [ ] **Step 2: Chamar a função no fim de `saveNotaFiscal`, depois do upsert de itens ter sucesso**

Em `lib/omie/nota-fiscal.ts`, a função `saveNotaFiscal` termina assim hoje (linhas ~94-127):

```ts
  const itens = nf.itensRecebimento ?? []
  if (saved && itens.length) {
    const rows = itens.map((it) => ({
      ...
    }))
    const { error: errItens } = await supabase
      .from('nota_fiscal_items')
      .upsert(rows, { onConflict: 'loja_id,n_id_receb,n_sequencia' })
    if (errItens) {
      throw new Error(`Falha ao salvar itens da NF ${nf.cabec.cNumeroNFe}: ${errItens.message}`)
    }
  }
}
```

Adicionar a chamada de dual-write logo antes do `}` final da função (depois do bloco `if (saved && itens.length)`):

```ts
  const itens = nf.itensRecebimento ?? []
  if (saved && itens.length) {
    const rows = itens.map((it) => ({
      loja_id: loja.id,
      nota_fiscal_id: saved.id,
      n_id_receb: String(nf.cabec.nIdReceb),
      n_sequencia: it.itensCabec.nSequencia,
      produto_codigo: it.itensCabec.nIdProduto ? String(it.itensCabec.nIdProduto) : null,
      n_id_item: it.itensCabec.nIdItem,
      n_id_pedido: it.itensCabec.nIdPedido,
      n_id_it_pedido: it.itensCabec.nIdItPedido,
      n_id_produto: it.itensCabec.nIdProduto,
      c_codigo_produto: it.itensCabec.cCodigoProduto,
      c_descricao_produto: it.itensCabec.cDescricaoProduto,
      c_ignorar_item: it.itensCabec.cIgnorarItem,
      c_adicionar_novo: it.itensCabec.cAdicionarNovo,
      c_associar_existente: it.itensCabec.cAssociarExistente,
      c_item_devolvido: it.itensCabec.cItemDevolvido,
      c_ncm: it.itensCabec.cNCM,
      c_ean: it.itensCabec.cEAN,
      c_cfop: it.itensCabec.cCFOP,
      n_qtde_nfe: it.itensCabec.nQtdeNFe,
      c_unidade_nfe: it.itensCabec.cUnidadeNfe,
      n_preco_unit: it.itensCabec.nPrecoUnit,
      full_object: it,
      updated_at: new Date().toISOString(),
    }))
    const { error: errItens } = await supabase
      .from('nota_fiscal_items')
      .upsert(rows, { onConflict: 'loja_id,n_id_receb,n_sequencia' })
    if (errItens) {
      throw new Error(`Falha ao salvar itens da NF ${nf.cabec.cNumeroNFe}: ${errItens.message}`)
    }
  }

  await gravarNotaFiscalNoFrio(loja.id, {
    n_id_receb: String(nf.cabec.nIdReceb),
    n_id_fornecedor: nf.cabec.nIdFornecedor,
    c_pessoa_fisica: nf.cabec.cPessoaFisica,
    c_nome: nf.cabec.cNome,
    c_razao_social: nf.cabec.cRazaoSocial,
    c_inscricao: nf.cabec.cInscricao,
    c_cnpj_cpf: nf.cabec.cCNPJ_CPF,
    c_chave_nfe: nf.cabec.cChaveNFe,
    c_etapa: nf.cabec.cEtapa,
    c_numero_nfe: nf.cabec.cNumeroNFe,
    c_serie_nfe: nf.cabec.cSerieNFe,
    c_modelo_nfe: nf.cabec.cModeloNFe,
    d_emissao_nfe: parseDate(nf.cabec.dEmissaoNFe),
    n_valor_nfe: nf.cabec.nValorNFe,
    c_ambiente_nfe: nf.cabec.cAmbienteNFe,
    c_natureza_operacao: nf.cabec.cNaturezaOperacao,
    full_object: nf,
    itens: itens.map((it) => ({
      n_sequencia: it.itensCabec.nSequencia,
      n_id_item: it.itensCabec.nIdItem,
      n_id_pedido: it.itensCabec.nIdPedido,
      n_id_it_pedido: it.itensCabec.nIdItPedido,
      n_id_produto: it.itensCabec.nIdProduto,
      c_codigo_produto: it.itensCabec.cCodigoProduto,
      c_descricao_produto: it.itensCabec.cDescricaoProduto,
      c_ignorar_item: it.itensCabec.cIgnorarItem,
      c_adicionar_novo: it.itensCabec.cAdicionarNovo,
      c_associar_existente: it.itensCabec.cAssociarExistente,
      c_item_devolvido: it.itensCabec.cItemDevolvido,
      c_ncm: it.itensCabec.cNCM,
      c_ean: it.itensCabec.cEAN,
      c_cfop: it.itensCabec.cCFOP,
      n_qtde_nfe: it.itensCabec.nQtdeNFe,
      c_unidade_nfe: it.itensCabec.cUnidadeNfe,
      n_preco_unit: it.itensCabec.nPrecoUnit,
      full_object: it,
    })),
  })
}
```

Nota: quando a NF não tem itens (`itens.length === 0`), a chamada ainda acontece com `itens: []` — o cabeçalho da NF precisa ir pro Contabo mesmo sem itens.

- [ ] **Step 3: Rodar `npx tsc --noEmit -p .` e confirmar zero erros**

```bash
npx tsc --noEmit -p .
```
Esperado: nenhuma saída.

- [ ] **Step 4: Testar contra 1 NF real de 1 loja**

```bash
node scripts/db.mjs "select id from lojas where ativo = true limit 1"
```
Usar o `id` retornado numa chamada real: rodar `curl` no endpoint `GET /api/cron/sync-nfs` local (`npm run dev` numa aba, cron auth via header — ver `lib/omie/sync-all.ts` pra saber o header exato) OU simplesmente aguardar o próximo tick do cron em produção depois do deploy (Task 7 cobre a verificação final). Não é obrigatório rodar localmente aqui: o teste real acontece na Task 7.

- [ ] **Step 5: Commit**

```bash
git add lib/omie/nota-fiscal.ts
git commit -m "feat: dual-write de notas fiscais pro Contabo (fire-and-forget)"
```

---

### Task 4: Dual-write em `lib/omie/ordem-producao.ts`

**Files:**
- Modify: `lib/omie/ordem-producao.ts`

**Interfaces:**
- Consumes: endpoint `POST /ordens_producao_bulk` (Task 2).
- Produces: nenhuma interface nova exportada — `gravarOrdensNoFrio` é interna ao arquivo.

- [ ] **Step 1: Adicionar a interface e a função de dual-write**

No topo de `lib/omie/ordem-producao.ts`, logo após `interface OmieOPResponse` (antes de `export async function syncOrdensProducao`):

```ts
interface OrdemProducaoBulkRow {
  num_ordem: string
  identificacao_n_cod_op: number
  identificacao_c_cod_int_op: string
  identificacao_c_num_op: string
  identificacao_n_cod_produto: number
  identificacao_d_dt_previsao: string | null
  identificacao_n_qtde: number
  identificacao_codigo_local_estoque: number
  concluida: boolean
  dt_conclusao_real: string | null
  dt_inclusao: string | null
  full_object: unknown
}

const LOTE_ORDENS = 100

// Envia o lote de OPs pro Contabo, fire-and-forget, em pedacos de 100 (mesmo
// tamanho de pagina ja usado pelo sync). Mesma filosofia de
// gravarMovimentosNoFrio: nunca bloqueia nem quebra o upsert no Supabase.
async function gravarOrdensNoFrio(lojaId: number, linhas: OrdemProducaoBulkRow[]): Promise<void> {
  const url = process.env.NTB_FRIO_API_URL
  const key = process.env.NTB_FRIO_API_KEY
  if (!url || !linhas.length) return
  for (let i = 0; i < linhas.length; i += LOTE_ORDENS) {
    const lote = linhas.slice(i, i + LOTE_ORDENS)
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)
      const resp = await fetch(`${url}/ordens_producao_bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': key ?? '' },
        body: JSON.stringify({ loja_id: lojaId, ordens: lote }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
    } catch (e) {
      console.error('ordem-producao: falha ao gravar ordens no Contabo', e)
    }
  }
}
```

- [ ] **Step 2: Chamar a função depois do upsert em lote, dentro de `syncOrdensProducao`**

Em `lib/omie/ordem-producao.ts:122-125`, hoje:

```ts
        await supabase
          .from('ordens_producao')
          .upsert(rows, { onConflict: 'loja_id,identificacao_n_cod_op' })
      }

      pagina++
```

Trocar por:

```ts
        await supabase
          .from('ordens_producao')
          .upsert(rows, { onConflict: 'loja_id,identificacao_n_cod_op' })
        await gravarOrdensNoFrio(loja.id, rows.map((r) => ({
          num_ordem: r.num_ordem,
          identificacao_n_cod_op: r.identificacao_n_cod_op,
          identificacao_c_cod_int_op: r.identificacao_c_cod_int_op,
          identificacao_c_num_op: r.identificacao_c_num_op,
          identificacao_n_cod_produto: r.identificacao_n_cod_produto,
          identificacao_d_dt_previsao: r.identificacao_d_dt_previsao,
          identificacao_n_qtde: r.identificacao_n_qtde,
          identificacao_codigo_local_estoque: r.identificacao_codigo_local_estoque,
          concluida: r.concluida,
          dt_conclusao_real: r.dt_conclusao_real,
          dt_inclusao: r.dt_inclusao,
          full_object: r.full_object,
        })))
      }

      pagina++
```

- [ ] **Step 3: Chamar a função também em `fetchOrdemProducao` (upsert de 1 OP só)**

Em `lib/omie/ordem-producao.ts:163-180`, hoje:

```ts
    await supabase.from('ordens_producao').upsert(
      {
        loja_id: loja.id,
        num_ordem: res.identificacao.cNumOP,
        identificacao_n_cod_op: res.identificacao.nCodOP,
        identificacao_c_cod_int_op: res.identificacao.cCodIntOP,
        identificacao_c_num_op: res.identificacao.cNumOP,
        identificacao_n_cod_produto: res.identificacao.nCodProduto,
        identificacao_d_dt_previsao: parseDate(res.identificacao.dDtPrevisao),
        identificacao_n_qtde: res.identificacao.nQtde,
        identificacao_codigo_local_estoque: res.identificacao.codigo_local_estoque,
        ...mapOutrasInf(res),
        full_object: itens?.length ? { itensDetalhes: itens } : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'loja_id,identificacao_n_cod_op' }
    )
  }
}
```

Trocar por:

```ts
    await supabase.from('ordens_producao').upsert(
      {
        loja_id: loja.id,
        num_ordem: res.identificacao.cNumOP,
        identificacao_n_cod_op: res.identificacao.nCodOP,
        identificacao_c_cod_int_op: res.identificacao.cCodIntOP,
        identificacao_c_num_op: res.identificacao.cNumOP,
        identificacao_n_cod_produto: res.identificacao.nCodProduto,
        identificacao_d_dt_previsao: parseDate(res.identificacao.dDtPrevisao),
        identificacao_n_qtde: res.identificacao.nQtde,
        identificacao_codigo_local_estoque: res.identificacao.codigo_local_estoque,
        ...mapOutrasInf(res),
        full_object: itens?.length ? { itensDetalhes: itens } : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'loja_id,identificacao_n_cod_op' }
    )
    await gravarOrdensNoFrio(loja.id, [{
      num_ordem: res.identificacao.cNumOP,
      identificacao_n_cod_op: res.identificacao.nCodOP,
      identificacao_c_cod_int_op: res.identificacao.cCodIntOP,
      identificacao_c_num_op: res.identificacao.cNumOP,
      identificacao_n_cod_produto: res.identificacao.nCodProduto,
      identificacao_d_dt_previsao: parseDate(res.identificacao.dDtPrevisao),
      identificacao_n_qtde: res.identificacao.nQtde,
      identificacao_codigo_local_estoque: res.identificacao.codigo_local_estoque,
      ...mapOutrasInf(res),
      full_object: itens?.length ? { itensDetalhes: itens } : null,
    }])
  }
}
```

- [ ] **Step 4: Rodar `npx tsc --noEmit -p .` e confirmar zero erros**

```bash
npx tsc --noEmit -p .
```

- [ ] **Step 5: Commit**

```bash
git add lib/omie/ordem-producao.ts
git commit -m "feat: dual-write de ordens de producao pro Contabo (fire-and-forget)"
```

---

### Task 5: Fix de dedupe em `lib/historico-contabo.ts` (NF, itens de NF, OP)

**Files:**
- Modify: `lib/historico-contabo.ts`
- Modify (call sites, adicionar coluna da chave natural na seleção onde faltar): `app/(app)/nota-fiscal/page.tsx`, `app/(app)/nota-fiscal/relatorio/route.ts`, `app/(app)/nota-fiscal/export/route.ts`, `app/(app)/nota-fiscal/[id]/page.tsx`, `app/(app)/ordem-producao/page.tsx`, `app/(app)/ordem-producao/relatorio/route.ts`, `app/(app)/ordem-producao/export/route.ts`, `app/(app)/validade/page.tsx`, `components/movimentacoes/MovimentosTab.tsx`, `lib/movimentacao-operacao-auto.ts`, `lib/resumo-dia.ts`, `lib/actions/busca-global.ts`.

**Interfaces:**
- Consumes: nada de tasks anteriores — este task é independente delas (arruma a LEITURA; Tasks 2-4 arrumaram a ESCRITA). Pode ser feito em paralelo com elas se necessário, mas precisa estar pronto antes do dual-write (Tasks 3/4) ir pra produção de verdade, senão reintroduz a duplicação.
- Produces: `complementarNotasFiscais`/`complementarNotaFiscalItems`/`complementarOrdensProducao` continuam com a mesma assinatura pública (mesmos nomes, mesmos parâmetros) — só o generic constraint de `T` muda (ganha campos novos obrigatórios). Todo caller precisa satisfazer o novo constraint.

- [ ] **Step 1: Adicionar as 3 funções de merge por chave natural em `lib/historico-contabo.ts`**

Logo antes de `export async function complementarNotasFiscais` (que já existe no arquivo), adicionar:

```ts
// Achado real (auditoria do bug de duplicacao de movimentos, 2026-07-25,
// estendido pra NF/OP em 2026-07-26): assim que ganharem dual-write continuo
// pro Contabo (lib/omie/nota-fiscal.ts, lib/omie/ordem-producao.ts), essas 3
// tabelas passam a ter o MESMO problema que `movimentos` teve -- o Contabo
// gera seu proprio `id` (bigserial) pra cada linha nova, independente do
// Supabase. mesclarPorId (por `.id`) nao reconhece como o mesmo registro.
// Dedupe pela chave natural em vez disso, mesmo padrao ja usado em
// complementarMovimentos/complementarMovimentosHistorico. Como
// n_id_receb/n_sequencia/identificacao_n_cod_op sao sempre preenchidos pra
// todo registro real vindo do Omie (ao contrario de id_ajuste em
// `movimentos`, que podia ser nulo), nao precisa de fallback pro `.id`.
function mesclarNotasFiscaisPorChaveNatural<T extends { id: number; n_id_receb: string }>(
  quentes: T[],
  frias: T[]
): T[] {
  const vistos = new Set(quentes.map((r) => r.n_id_receb))
  return [...quentes, ...frias.filter((r) => !vistos.has(r.n_id_receb))]
}

function mesclarNotaFiscalItemsPorChaveNatural<T extends { id: number; n_id_receb: string; n_sequencia: number }>(
  quentes: T[],
  frias: T[]
): T[] {
  const chave = (r: T) => `${r.n_id_receb}|${r.n_sequencia}`
  const vistos = new Set(quentes.map(chave))
  return [...quentes, ...frias.filter((r) => !vistos.has(chave(r)))]
}

function mesclarOrdensProducaoPorChaveNatural<T extends { id: number; identificacao_n_cod_op: number }>(
  quentes: T[],
  frias: T[]
): T[] {
  const vistos = new Set(quentes.map((r) => r.identificacao_n_cod_op))
  return [...quentes, ...frias.filter((r) => !vistos.has(r.identificacao_n_cod_op))]
}
```

- [ ] **Step 2: Trocar o generic constraint e a chamada de merge nas 3 funções `complementar*`**

Em `complementarNotasFiscais` (assinatura hoje: `export async function complementarNotasFiscais<T extends { id: number }>`), trocar para:

```ts
export async function complementarNotasFiscais<T extends { id: number; n_id_receb: string }>(
```

E trocar a linha final `return mesclarPorId(quentes, frias)` por `return mesclarNotasFiscaisPorChaveNatural(quentes, frias)`.

Em `complementarNotaFiscalItems` (assinatura hoje: `export async function complementarNotaFiscalItems<T extends { id: number }>`), trocar para:

```ts
export async function complementarNotaFiscalItems<T extends { id: number; n_id_receb: string; n_sequencia: number }>(
```

E trocar `return mesclarPorId(quentes, frias)` por `return mesclarNotaFiscalItemsPorChaveNatural(quentes, frias)`.

Em `complementarOrdensProducao` (assinatura hoje: `export async function complementarOrdensProducao<T extends { id: number }>`), trocar para:

```ts
export async function complementarOrdensProducao<T extends { id: number; identificacao_n_cod_op: number }>(
```

E trocar `return mesclarPorId(quentes, frias)` por `return mesclarOrdensProducaoPorChaveNatural(quentes, frias)`.

- [ ] **Step 3: Rodar `npx tsc --noEmit -p .` e corrigir CADA erro apontado**

```bash
npx tsc --noEmit -p .
```

Isso vai listar todo call site que ainda não seleciona a coluna da chave natural (mesmo mecanismo usado no fix de `movimentos`, commit `3f02341`). Para cada erro:
1. Achar a query Supabase (`.select(...)`) que alimenta o array passado pra `complementarNotasFiscais`/`complementarNotaFiscalItems`/`complementarOrdensProducao` naquele arquivo.
2. Adicionar a coluna que falta no `.select(...)` (`n_id_receb` para NF, `n_id_receb, n_sequencia` para itens de NF, `identificacao_n_cod_op` para OP — várias dessas queries já selecionam `identificacao_n_cod_op` hoje, checar antes de adicionar duplicado).
3. Adicionar o mesmo campo no tipo TS explícito daquela linha (interface inline ou `type` nomeado).
4. Se o resultado for reatribuído a uma variável com tipo explícito mais adiante no mesmo arquivo (como aconteceu em `movimentos`/`resumo-dia.ts`), atualizar esse tipo também.

Repetir `npx tsc --noEmit -p .` até a saída ficar vazia. Não pular nenhum erro — cada um é um call site que hoje perderia dado silenciosamente se ficasse pra trás (mesma lição do fix de `movimentos`).

- [ ] **Step 4: Checar cada call site tocado quanto à mistura entre lojas (mesmo achado da revisão do fix de `movimentos`)**

Pra cada arquivo tocado no Step 3, confirmar que o array passado como `quentes` pras 3 funções já está restrito a 1 loja só ANTES da chamada (via `.eq('loja_id', ...)` na query ou por o componente/loop já ser por-loja) — nenhuma delas inclui `loja_id` na chave de dedupe (mesma decisão de design de `complementarMovimentos`). Se algum call site acumular resultados de mais de uma loja no mesmo array antes de mesclar (o mesmo padrão que quebrou em `lib/resumo-dia.ts` pra `movimentos`), corrigir agrupando por loja antes de mesclar, no mesmo molde do fix de `lib/resumo-dia.ts` (commit `5e06cff`).

- [ ] **Step 5: Rodar `npm run build` e confirmar que passa**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add lib/historico-contabo.ts app/\(app\)/nota-fiscal app/\(app\)/ordem-producao app/\(app\)/validade components/movimentacoes/MovimentosTab.tsx lib/movimentacao-operacao-auto.ts lib/resumo-dia.ts lib/actions/busca-global.ts
git commit -m "fix: dedupe NF/itens de NF/OP por chave natural no merge Supabase+Contabo"
```
(ajustar a lista de `git add` pros arquivos que o Step 3 realmente tocou)

---

### Task 6: Backfill do buraco 07-13→hoje (script novo, roda local)

**Files:**
- Create: `scripts/backfill-nf-op-contabo.mjs`

**Interfaces:**
- Consumes: `POST /notas_fiscais_bulk` e `POST /ordens_producao_bulk` (Task 2); precisa que a Task 5 já esteja em produção antes de rodar (senão os relatórios duplicam entre o backfill rodar e o deploy da Task 5).
- Produces: nenhuma — script ad-hoc, roda uma vez (idempotente, pode rodar de novo sem duplicar).

- [ ] **Step 1: Escrever o script**

Criar `scripts/backfill-nf-op-contabo.mjs`:

```js
// Backfill do buraco 07-13->hoje em notas_fiscais/nota_fiscal_items/
// ordens_producao no Contabo. Diferente do backfill original de 07-12 (que
// teve que reconstruir direto do Omie), esse periodo o Supabase ainda tem
// intacto -- so precisa ler de la e empurrar pros endpoints novos
// (/notas_fiscais_bulk, /ordens_producao_bulk). Idempotente (upsert nos 2
// lados). Uso: node scripts/backfill-nf-op-contabo.mjs [loja_id]
import fs from 'node:fs'
import pg from 'pg'

const PROJ = process.cwd()
const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const CORTE = '2026-07-13'
const LOJAS_PADRAO = [1, 2, 3, 4, 5, 6]
const LOTE = 200

const dbUrl = new URL(env.SUPABASE_DB_URL)
const senha = decodeURIComponent(dbUrl.password)
const ref = dbUrl.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')

let host = 'aws-1-sa-east-1.pooler.supabase.com'
let port = 5432
try {
  const saved = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim()
  const [h, p] = saved.split(':')
  if (h) host = h
  if (p) port = Number(p)
} catch {}

const client = new pg.Client({
  host, port, user: `postgres.${ref}`, password: senha, database: 'postgres', ssl: { rejectUnauthorized: false },
})
await client.connect()

const FRIO_URL = env.NTB_FRIO_API_URL
const FRIO_KEY = env.NTB_FRIO_API_KEY

async function postLote(caminho, body) {
  const resp = await fetch(`${FRIO_URL}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': FRIO_KEY },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`${caminho} respondeu ${resp.status}: ${await resp.text()}`)
  return resp.json()
}

async function backfillNotasFiscais(lojaId) {
  const { rows: notas } = await client.query(
    `select id, n_id_receb, n_id_fornecedor, c_pessoa_fisica, c_nome, c_razao_social, c_inscricao,
            c_cnpj_cpf, c_chave_nfe, c_etapa, c_numero_nfe, c_serie_nfe, c_modelo_nfe,
            d_emissao_nfe, n_valor_nfe, c_ambiente_nfe, c_natureza_operacao, full_object
     from notas_fiscais where loja_id = $1 and d_emissao_nfe >= $2`,
    [lojaId, CORTE]
  )
  if (!notas.length) return 0
  const ids = notas.map((n) => n.id)
  const { rows: itensRows } = await client.query(
    `select nota_fiscal_id, n_sequencia, n_id_item, n_id_pedido, n_id_it_pedido, n_id_produto,
            c_codigo_produto, c_descricao_produto, c_ignorar_item, c_adicionar_novo,
            c_associar_existente, c_item_devolvido, c_ncm, c_ean, c_cfop, n_qtde_nfe,
            c_unidade_nfe, n_preco_unit, full_object
     from nota_fiscal_items where nota_fiscal_id = any($1::bigint[])`,
    [ids]
  )
  const itensPorNota = new Map()
  for (const it of itensRows) {
    const arr = itensPorNota.get(it.nota_fiscal_id) ?? []
    arr.push(it)
    itensPorNota.set(it.nota_fiscal_id, arr)
  }
  const payload = notas.map((n) => ({
    n_id_receb: n.n_id_receb,
    n_id_fornecedor: n.n_id_fornecedor,
    c_pessoa_fisica: n.c_pessoa_fisica,
    c_nome: n.c_nome,
    c_razao_social: n.c_razao_social,
    c_inscricao: n.c_inscricao,
    c_cnpj_cpf: n.c_cnpj_cpf,
    c_chave_nfe: n.c_chave_nfe,
    c_etapa: n.c_etapa,
    c_numero_nfe: n.c_numero_nfe,
    c_serie_nfe: n.c_serie_nfe,
    c_modelo_nfe: n.c_modelo_nfe,
    d_emissao_nfe: n.d_emissao_nfe,
    n_valor_nfe: n.n_valor_nfe,
    c_ambiente_nfe: n.c_ambiente_nfe,
    c_natureza_operacao: n.c_natureza_operacao,
    full_object: n.full_object,
    itens: (itensPorNota.get(n.id) ?? []).map((it) => ({
      n_sequencia: it.n_sequencia,
      n_id_item: it.n_id_item,
      n_id_pedido: it.n_id_pedido,
      n_id_it_pedido: it.n_id_it_pedido,
      n_id_produto: it.n_id_produto,
      c_codigo_produto: it.c_codigo_produto,
      c_descricao_produto: it.c_descricao_produto,
      c_ignorar_item: it.c_ignorar_item,
      c_adicionar_novo: it.c_adicionar_novo,
      c_associar_existente: it.c_associar_existente,
      c_item_devolvido: it.c_item_devolvido,
      c_ncm: it.c_ncm,
      c_ean: it.c_ean,
      c_cfop: it.c_cfop,
      n_qtde_nfe: it.n_qtde_nfe,
      c_unidade_nfe: it.c_unidade_nfe,
      n_preco_unit: it.n_preco_unit,
      full_object: it.full_object,
    })),
  }))
  for (let i = 0; i < payload.length; i += LOTE) {
    await postLote('/notas_fiscais_bulk', { loja_id: lojaId, notas: payload.slice(i, i + LOTE) })
  }
  return payload.length
}

async function backfillOrdensProducao(lojaId) {
  const { rows: ordens } = await client.query(
    `select num_ordem, identificacao_n_cod_op, identificacao_c_cod_int_op, identificacao_c_num_op,
            identificacao_n_cod_produto, identificacao_d_dt_previsao, identificacao_n_qtde,
            identificacao_codigo_local_estoque, concluida, dt_conclusao_real, dt_inclusao, full_object
     from ordens_producao
     where loja_id = $1 and (identificacao_d_dt_previsao >= $2 or updated_at >= $2::date)`,
    [lojaId, CORTE]
  )
  for (let i = 0; i < ordens.length; i += LOTE) {
    await postLote('/ordens_producao_bulk', { loja_id: lojaId, ordens: ordens.slice(i, i + LOTE) })
  }
  return ordens.length
}

const alvo = process.argv[2] ? [Number(process.argv[2])] : LOJAS_PADRAO
for (const lojaId of alvo) {
  const nfCount = await backfillNotasFiscais(lojaId)
  const opCount = await backfillOrdensProducao(lojaId)
  console.log(`loja ${lojaId}: ${nfCount} notas fiscais, ${opCount} ordens de producao`)
}
await client.end()
```

- [ ] **Step 2: Confirmar a lista real de lojas ativas antes de rodar**

```bash
node scripts/db.mjs "select id, nome from lojas where ativo = true order by id"
```
Ajustar `LOJAS_PADRAO` no script se a lista não for exatamente `[1,2,3,4,5,6]`.

- [ ] **Step 3: Pedir confirmação e rodar contra 1 loja só primeiro**

Escreve em produção real (Contabo) com dado de todas as lojas — confirmar com o usuário antes. Depois de confirmado, rodar só a menor loja primeiro:

```bash
node scripts/backfill-nf-op-contabo.mjs 2
```

- [ ] **Step 4: Verificar a contagem da loja 2 batendo com o Supabase**

```bash
node scripts/db.mjs "select count(*) from notas_fiscais where loja_id=2 and d_emissao_nfe >= '2026-07-13'"
```
Comparar com o `nfCount` impresso no Step 3 — devem bater exatamente.

- [ ] **Step 5: Rodar pras 6 lojas**

```bash
node scripts/backfill-nf-op-contabo.mjs
```

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-nf-op-contabo.mjs
git commit -m "chore: script de backfill NF/OP 07-13->hoje pro Contabo"
```

---

### Task 7: Validação end-to-end

**Files:** nenhum (só verificação manual).

**Interfaces:**
- Consumes: tudo das Tasks 1-6 já em produção (deploy feito).

- [ ] **Step 1: Confirmar que uma NF nova chega no Contabo depois do deploy**

Aguardar o próximo tick do cron `sync-nfs` (ou disparar manualmente) e depois:

```bash
node scripts/db.mjs "select loja_id, id, n_id_receb, d_emissao_nfe from notas_fiscais where loja_id=2 order by d_emissao_nfe desc limit 3"
```

Pegar o `n_id_receb` mais recente e conferir no Contabo:

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "sudo -u postgres psql -d ntb_frio -tAc \"select id, n_id_receb, d_emissao_nfe from notas_fiscais where loja_id=2 and n_id_receb='<n_id_receb aqui>'\""
```
Esperado: 1 linha, com `id` diferente do Supabase (confirma que o dual-write está funcionando E que o `id` realmente diverge, validando a necessidade do fix da Task 5).

- [ ] **Step 2: Repetir para uma OP nova**

Mesmo processo com `ordens_producao`/`identificacao_n_cod_op`.

- [ ] **Step 3: Confirmar 0 duplicatas no merge, com dado real**

Reproduzir a mesma técnica usada pra validar o fix de `movimentos` (achado da auditoria de 2026-07-25): buscar quentes (Supabase) e frias (Contabo, via `NTB_FRIO_API_URL`) pra loja 2, período cruzando os 90 dias, simular o merge com a lógica de `mesclarNotasFiscaisPorChaveNatural`/`mesclarOrdensProducaoPorChaveNatural` num script Node ad-hoc, e confirmar que a contagem de `n_id_receb`/`identificacao_n_cod_op` duplicados é 0.

- [ ] **Step 4: Reportar o resultado final**

Resumo do que foi confirmado (dual-write funcionando, ids divergindo como esperado, 0 duplicatas no merge, backfill batendo contagem) — sem próximos passos além dos já conhecidos (Fase 3 do failover, bug de duplicação já corrigido documentado, etc.).
