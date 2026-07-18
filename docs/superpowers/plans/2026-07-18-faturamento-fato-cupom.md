# Faturamento — fato por cupom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gravar o fato de faturamento item-a-item no Contabo (hoje descartado) pra destravar forma de pagamento automática, filtros cruzados, grão diário, ticket médio e quantidade no relatório de Faturamento.

**Architecture:** 3 tabelas novas só no Postgres do Contabo (sem cópia no Supabase — Faturamento nunca teve janela quente). 4 endpoints novos + 1 endpoint de escrita em lote na `ntb-frio-api` (servidor Express, fora deste repo git). A ingestão diária existente passa a gravar o fato via HTTP, além do pré-agregado atual. Camada de leitura nova no app (`lib/faturamento-frio.ts`) troca de fonte só quando o usuário pede algo que o pré-agregado não sustenta.

**Tech Stack:** Node/Express + `pg` (servidor Contabo), Next.js Server Components (app), Postgres.

## Global Constraints

- Servidor Contabo: SSH `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240`. Arquivo do servidor: `/opt/ntb-frio-api/server.js` (fora deste repo git — editar via SSH, nunca existe cópia local). Banco: `DATABASE_URL` do `/opt/ntb-frio-api/.env`, acessível via `pool` já instanciado no `server.js`. Serviço: `systemctl restart ntb-frio-api` depois de qualquer edição.
- Autenticação dos endpoints: header `X-Api-Key` == `process.env.API_KEY`, middleware `checkAuth` já existe no `server.js` — reusar, não duplicar.
- Padrão de tipo: `types.setTypeParser(20, ...)` (bigint→Number) e `types.setTypeParser(1082, ...)` (date→string crua) já configurados globalmente no topo do `server.js` — cobre qualquer coluna nova automaticamente, nada a fazer.
- Sem suite automatizada neste repo — verificação manual (`curl` nos endpoints novos, `node scripts/db.mjs` pro lado Supabase, Playwright pra tela).
- `.env.local` e `scripts/.pooler-host` não são copiados automaticamente pra worktrees — copiar manualmente se for usar uma.
- Ação em banco de produção real (Contabo) requer confirmação explícita do usuário antes de aplicar o DDL (Task 1) e antes de rodar o backfill completo (Task 5).

---

### Task 1: Tabelas novas no Postgres do Contabo

**Files:** nenhum (DDL aplicado direto via SSH, sem migration versionada neste repo — o schema do Contabo não é gerenciado pelas migrations do Supabase).

**Interfaces:**
- Produces: tabelas `fat_cupons(loja_id, n_id_cupom, chave, data, hora, num, serie, seq_caixa, id_cliente, id_vendedor, valor, cancelado, devolvido)`, `fat_cupom_itens(loja_id, id_item, n_id_cupom, id_produto, cfop, ncm, quant, v_unit, v_desc, v_item, x_prod)`, `fat_cupom_pagamentos(loja_id, n_id_cupom, sequencia, tipo_doc, valor, categoria, id_conta_corrente)` no banco `ntb_frio`. Tasks 2-5 consomem.

- [ ] **Step 1: Escrever o DDL num arquivo local (só de referência/histórico — não é aplicado daqui)**

Criar `/private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/fat-cupom-schema.sql` (ou caminho equivalente do scratchpad da sessão) com:

```sql
create table if not exists fat_cupons (
  loja_id bigint not null,
  n_id_cupom bigint not null,
  chave text,
  data date not null,
  hora text,
  num text,
  serie text,
  seq_caixa bigint,
  id_cliente bigint,
  id_vendedor bigint,
  valor numeric not null default 0,
  cancelado boolean not null default false,
  devolvido boolean not null default false,
  primary key (loja_id, n_id_cupom)
);
create index if not exists fat_cupons_loja_data_idx on fat_cupons (loja_id, data);

create table if not exists fat_cupom_itens (
  loja_id bigint not null,
  id_item bigint not null,
  n_id_cupom bigint not null,
  id_produto bigint,
  cfop text,
  ncm text,
  quant numeric not null default 0,
  v_unit numeric not null default 0,
  v_desc numeric not null default 0,
  v_item numeric not null default 0,
  x_prod text,
  primary key (loja_id, id_item)
);
create index if not exists fat_cupom_itens_cupom_idx on fat_cupom_itens (loja_id, n_id_cupom);
create index if not exists fat_cupom_itens_produto_idx on fat_cupom_itens (loja_id, id_produto);

create table if not exists fat_cupom_pagamentos (
  loja_id bigint not null,
  n_id_cupom bigint not null,
  sequencia int not null,
  tipo_doc text,
  valor numeric not null default 0,
  categoria text,
  id_conta_corrente bigint,
  primary key (loja_id, n_id_cupom, sequencia)
);
create index if not exists fat_cupom_pagamentos_cupom_idx on fat_cupom_pagamentos (loja_id, n_id_cupom);
```

- [ ] **Step 2: Pedir confirmação e aplicar via SSH**

Este é DDL em banco de produção real — confirmar com o usuário antes de rodar. Depois de confirmado:

```bash
cat /private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/fat-cupom-schema.sql | ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "sudo -u postgres psql -d ntb_frio"
```

- [ ] **Step 3: Verificar**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "sudo -u postgres psql -d ntb_frio -tAc \"select table_name from information_schema.tables where table_name like 'fat_cupom%' order by table_name\""
```
Esperado: as 3 tabelas listadas.

---

### Task 2: Endpoints novos na `ntb-frio-api` (4 GET + 1 POST em lote)

**Files:**
- Modify (via SSH, fora deste repo git): `/opt/ntb-frio-api/server.js`

**Interfaces:**
- Consumes: middleware `checkAuth` já existente, `pool` (pg Pool) já instanciado no topo do arquivo.
- Produces: `GET /fat_cupons?loja_id=&data_inicio=&data_final=[&n_id_cupom=]`, `GET /fat_cupom_itens?loja_id=&data_inicio=&data_final=[&n_id_cupom=]`, `GET /fat_cupom_pagamentos?loja_id=&data_inicio=&data_final=[&n_id_cupom=]`, `GET /fat_agregado?loja_id=&data_inicio=&data_final=&group=dia|forma|produto[&group2=mes]`, `POST /fat_cupons_bulk` (body `{ loja_id, cupons: [...], itens: [...], pagamentos: [...] }`). Todos os 3 GET de tabela crua aceitam `n_id_cupom` como atalho pra 1 registro (usado pelo drill do cupom individual). Task 3 (ingestão) consome o POST; Task 4 (leitura no app) consome os 4 GET.

- [ ] **Step 1: Ler o `server.js` atual completo via SSH (fazer isso ANTES de editar, pra saber a linha exata onde inserir)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cat /opt/ntb-frio-api/server.js"
```
Confirmar que o arquivo ainda tem a estrutura: `checkAuth` (linhas ~19-23), rotas `GET /notas_fiscais`, `/nota_fiscal_items`, `/ordens_producao`, `/movimentos`, `/movimentos_historico`, rota `POST /vendas/orders` com padrão de transação (`client.connect()`/`begin`/`commit`/`rollback`/`finally client.release()`), e `GET /health` + `app.listen(...)` no fim. As rotas novas entram **antes** de `app.get('/health', ...)`.

- [ ] **Step 2: Escrever o bloco de rotas novas num arquivo local**

Criar `/private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/fat-cupom-routes.js` com:

```js
app.get('/fat_cupons', checkAuth, async (req, res) => {
  const { loja_id, data_inicio, data_final, n_id_cupom } = req.query;
  if (!loja_id) return res.status(400).json({ error: 'loja_id obrigatorio' });
  try {
    if (n_id_cupom) {
      const r = await pool.query(
        'select * from fat_cupons where loja_id = $1 and n_id_cupom = $2',
        [loja_id, n_id_cupom]
      );
      return res.json({ rows: r.rows });
    }
    const clauses = ['loja_id = $1'];
    const params = [loja_id];
    if (data_inicio) { params.push(data_inicio); clauses.push(`data >= $${params.length}`); }
    if (data_final) { params.push(data_final); clauses.push(`data <= $${params.length}`); }
    const sql = `select * from fat_cupons where ${clauses.join(' and ')} order by data desc limit 5000`;
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /fat_cupons:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/fat_cupom_itens', checkAuth, async (req, res) => {
  const { loja_id, data_inicio, data_final, n_id_cupom } = req.query;
  if (!loja_id) return res.status(400).json({ error: 'loja_id obrigatorio' });
  try {
    if (n_id_cupom) {
      const r = await pool.query(
        'select * from fat_cupom_itens where loja_id = $1 and n_id_cupom = $2',
        [loja_id, n_id_cupom]
      );
      return res.json({ rows: r.rows });
    }
    const clauses = ['i.loja_id = $1'];
    const params = [loja_id];
    if (data_inicio) { params.push(data_inicio); clauses.push(`c.data >= $${params.length}`); }
    if (data_final) { params.push(data_final); clauses.push(`c.data <= $${params.length}`); }
    const sql = `
      select i.*
      from fat_cupom_itens i
      join fat_cupons c on c.loja_id = i.loja_id and c.n_id_cupom = i.n_id_cupom
      where ${clauses.join(' and ')}
      limit 20000`;
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /fat_cupom_itens:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/fat_cupom_pagamentos', checkAuth, async (req, res) => {
  const { loja_id, data_inicio, data_final, n_id_cupom } = req.query;
  if (!loja_id) return res.status(400).json({ error: 'loja_id obrigatorio' });
  try {
    if (n_id_cupom) {
      const r = await pool.query(
        'select * from fat_cupom_pagamentos where loja_id = $1 and n_id_cupom = $2',
        [loja_id, n_id_cupom]
      );
      return res.json({ rows: r.rows });
    }
    const clauses = ['p.loja_id = $1'];
    const params = [loja_id];
    if (data_inicio) { params.push(data_inicio); clauses.push(`c.data >= $${params.length}`); }
    if (data_final) { params.push(data_final); clauses.push(`c.data <= $${params.length}`); }
    const sql = `
      select p.*
      from fat_cupom_pagamentos p
      join fat_cupons c on c.loja_id = p.loja_id and c.n_id_cupom = p.n_id_cupom
      where ${clauses.join(' and ')}
      limit 20000`;
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /fat_cupom_pagamentos:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/fat_agregado', checkAuth, async (req, res) => {
  const { loja_id, data_inicio, data_final, group, group2 } = req.query;
  if (!loja_id) return res.status(400).json({ error: 'loja_id obrigatorio' });
  if (!['dia', 'forma', 'produto'].includes(group)) {
    return res.status(400).json({ error: "group deve ser 'dia', 'forma' ou 'produto'" });
  }
  const clauses = ['c.loja_id = $1'];
  const params = [loja_id];
  if (data_inicio) { params.push(data_inicio); clauses.push(`c.data >= $${params.length}`); }
  if (data_final) { params.push(data_final); clauses.push(`c.data <= $${params.length}`); }
  const where = clauses.join(' and ');
  const mesExpr = "to_char(c.data, 'YYYY-MM')";
  try {
    let sql;
    if (group === 'dia') {
      sql = `select c.data::text as rotulo, sum(c.valor) as valor, count(*) as qtde_itens
             from fat_cupons c where ${where} and c.cancelado = false
             group by c.data order by c.data`;
    } else if (group === 'forma') {
      sql = `select p.tipo_doc as rotulo, ${group2 === 'mes' ? `${mesExpr.replace('c.data', 'c.data')} as mes,` : ''} sum(p.valor) as valor, count(*) as qtde_itens
             from fat_cupom_pagamentos p
             join fat_cupons c on c.loja_id = p.loja_id and c.n_id_cupom = p.n_id_cupom
             where ${where.replace(/c\.loja_id/g, 'c.loja_id')} and c.cancelado = false
             group by p.tipo_doc${group2 === 'mes' ? ', mes' : ''} order by valor desc`;
    } else {
      sql = `select i.id_produto as rotulo, ${group2 === 'mes' ? `${mesExpr} as mes,` : ''} sum(i.v_item) as valor, sum(i.quant) as qtde_itens
             from fat_cupom_itens i
             join fat_cupons c on c.loja_id = i.loja_id and c.n_id_cupom = i.n_id_cupom
             where ${where} and c.cancelado = false
             group by i.id_produto${group2 === 'mes' ? ', mes' : ''} order by valor desc`;
    }
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /fat_agregado:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.post('/fat_cupons_bulk', checkAuth, async (req, res) => {
  const { loja_id, cupons, itens, pagamentos } = req.body || {};
  if (!loja_id || !Array.isArray(cupons)) {
    return res.status(400).json({ error: 'loja_id e cupons (array) sao obrigatorios' });
  }
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const c of cupons) {
      await client.query(
        `insert into fat_cupons (loja_id, n_id_cupom, chave, data, hora, num, serie, seq_caixa, id_cliente, id_vendedor, valor, cancelado, devolvido)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (loja_id, n_id_cupom) do update set
           chave = excluded.chave, data = excluded.data, hora = excluded.hora, num = excluded.num,
           serie = excluded.serie, seq_caixa = excluded.seq_caixa, id_cliente = excluded.id_cliente,
           id_vendedor = excluded.id_vendedor, valor = excluded.valor, cancelado = excluded.cancelado,
           devolvido = excluded.devolvido`,
        [loja_id, c.n_id_cupom, c.chave, c.data, c.hora, c.num, c.serie, c.seq_caixa,
         c.id_cliente, c.id_vendedor, c.valor, c.cancelado, c.devolvido]
      );
    }
    for (const it of itens ?? []) {
      await client.query(
        `insert into fat_cupom_itens (loja_id, id_item, n_id_cupom, id_produto, cfop, ncm, quant, v_unit, v_desc, v_item, x_prod)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (loja_id, id_item) do update set
           n_id_cupom = excluded.n_id_cupom, id_produto = excluded.id_produto, cfop = excluded.cfop,
           ncm = excluded.ncm, quant = excluded.quant, v_unit = excluded.v_unit, v_desc = excluded.v_desc,
           v_item = excluded.v_item, x_prod = excluded.x_prod`,
        [loja_id, it.id_item, it.n_id_cupom, it.id_produto, it.cfop, it.ncm, it.quant, it.v_unit, it.v_desc, it.v_item, it.x_prod]
      );
    }
    for (const p of pagamentos ?? []) {
      await client.query(
        `insert into fat_cupom_pagamentos (loja_id, n_id_cupom, sequencia, tipo_doc, valor, categoria, id_conta_corrente)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (loja_id, n_id_cupom, sequencia) do update set
           tipo_doc = excluded.tipo_doc, valor = excluded.valor, categoria = excluded.categoria,
           id_conta_corrente = excluded.id_conta_corrente`,
        [loja_id, p.n_id_cupom, p.sequencia, p.tipo_doc, p.valor, p.categoria, p.id_conta_corrente]
      );
    }
    await client.query('commit');
    res.json({ ok: true, cupons: cupons.length, itens: (itens ?? []).length, pagamentos: (pagamentos ?? []).length });
  } catch (e) {
    await client.query('rollback');
    console.error('Erro POST /fat_cupons_bulk:', e);
    res.status(500).json({ error: 'internal error' });
  } finally {
    client.release();
  }
});
```

> Nota: no `group === 'forma'` acima, o `where` já contém `c.loja_id` — como a query faz join com `fat_cupons c`, a cláusula `c.loja_id = $1` bate certo; o `.replace(...)` no código é um no-op defensivo (mantém o texto idêntico), pode simplificar removendo o `.replace` se preferir só `where` puro — o efeito é o mesmo, `where` já referencia `c.loja_id`.

- [ ] **Step 2: Inserir o bloco no `server.js` do servidor, antes de `app.get('/health', ...)`**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cp /opt/ntb-frio-api/server.js /opt/ntb-frio-api/server.js.bak-$(date +%Y%m%d)"
python3 -c "
import subprocess
routes = open('/private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/fat-cupom-routes.js').read()
remote = subprocess.run(['ssh', '-i', '$HOME/.ssh/notebook_contabo_key', 'root@185.193.66.240', 'cat /opt/ntb-frio-api/server.js'], capture_output=True, text=True).stdout
marker = \"app.get('/health'\"
idx = remote.index(marker)
novo = remote[:idx] + routes + '\n' + remote[idx:]
subprocess.run(['ssh', '-i', '$HOME/.ssh/notebook_contabo_key', 'root@185.193.66.240', 'cat > /opt/ntb-frio-api/server.js'], input=novo, text=True, check=True)
print('OK, arquivo atualizado')
"
```

- [ ] **Step 3: Validar sintaxe e reiniciar o serviço**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "node -c /opt/ntb-frio-api/server.js && echo SINTAXE-OK && systemctl restart ntb-frio-api && sleep 1 && systemctl is-active ntb-frio-api"
```
Esperado: `SINTAXE-OK` seguido de `active`. Se `node -c` falhar, **restaurar o backup** (`cp server.js.bak-<data> server.js`) antes de investigar — nunca deixar o serviço no ar com sintaxe quebrada.

- [ ] **Step 4: Testar os 4 GET com curl (loja com dado, mesmo que ainda vazio — confere só que não dá 500)**

```bash
API_KEY=$(ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "grep '^API_KEY=' /opt/ntb-frio-api/.env | cut -d= -f2")
for ep in fat_cupons fat_cupom_itens fat_cupom_pagamentos; do
  curl -s -o /dev/null -w "$ep: %{http_code}\n" -H "X-Api-Key: $API_KEY" "https://frio-api.norteparanegocios.com.br/$ep?loja_id=3&data_inicio=2026-01-01&data_final=2026-01-31"
done
curl -s -o /dev/null -w "fat_agregado dia: %{http_code}\n" -H "X-Api-Key: $API_KEY" "https://frio-api.norteparanegocios.com.br/fat_agregado?loja_id=3&data_inicio=2026-01-01&data_final=2026-01-31&group=dia"
```
Esperado: todos `200` com `{"rows":[]}` (tabelas ainda vazias — Task 3/5 populam).

- [ ] **Step 5: Testar o POST em lote com 1 cupom fake**

```bash
curl -s -X POST -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"loja_id":3,"cupons":[{"n_id_cupom":999999999,"chave":"teste","data":"2026-01-15","hora":"12:00:00","num":"1","serie":"1","seq_caixa":1,"id_cliente":null,"id_vendedor":null,"valor":10.5,"cancelado":false,"devolvido":false}],"itens":[],"pagamentos":[]}' \
  "https://frio-api.norteparanegocios.com.br/fat_cupons_bulk"
```
Esperado: `{"ok":true,"cupons":1,"itens":0,"pagamentos":0}`. Depois, limpar o registro de teste:
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "sudo -u postgres psql -d ntb_frio -c \"delete from fat_cupons where n_id_cupom = 999999999\""
```

---

### Task 3: Ingestão — `lib/omie/faturamento.ts` grava o fato no Contabo

**Files:**
- Modify: `lib/omie/faturamento.ts`

**Interfaces:**
- Consumes: `POST /fat_cupons_bulk` (Task 2), `NTB_FRIO_API_URL`/`NTB_FRIO_API_KEY` (já existem em `.env.local`, mesmos usados por `lib/historico-contabo.ts`).
- Produces: nenhuma interface nova — o retorno de `syncFaturamento` continua igual (`Promise<number>`).

- [ ] **Step 1: Adicionar a função de envio em lote pro Contabo**

No topo de `lib/omie/faturamento.ts`, depois dos imports existentes, adicionar:

```ts
type CupomBulkRow = {
  n_id_cupom: number; chave: string | null; data: string; hora: string | null
  num: string | null; serie: string | null; seq_caixa: number | null
  id_cliente: number | null; id_vendedor: number | null; valor: number
  cancelado: boolean; devolvido: boolean
}
type ItemBulkRow = {
  id_item: number; n_id_cupom: number; id_produto: number | null; cfop: string | null
  ncm: string | null; quant: number; v_unit: number; v_desc: number; v_item: number; x_prod: string | null
}
type PagamentoBulkRow = {
  n_id_cupom: number; sequencia: number; tipo_doc: string | null; valor: number
  categoria: string | null; id_conta_corrente: number | null
}

// Envia o fato (cupom+itens+pagamentos) pro Contabo. Nao lanca erro se o
// Contabo falhar -- mesma filosofia de buscarFrio (historico-contabo.ts):
// o pre-agregado do Supabase, que sustenta a tela hoje, nunca pode quebrar
// por causa do fato novo.
async function gravarFatoNoFrio(lojaId: number, cupons: CupomBulkRow[], itens: ItemBulkRow[], pagamentos: PagamentoBulkRow[]): Promise<void> {
  const url = process.env.NTB_FRIO_API_URL
  const key = process.env.NTB_FRIO_API_KEY
  if (!url || !cupons.length) return
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    const resp = await fetch(`${url}/fat_cupons_bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': key ?? '' },
      body: JSON.stringify({ loja_id: lojaId, cupons, itens, pagamentos }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
  } catch (e) {
    console.error('faturamento: falha ao gravar fato no Contabo', e)
  }
}
```

- [ ] **Step 2: Extrair o cupom/itens/pagamentos dentro do loop de páginas e enviar por mês**

Localizar o bloco `for (const c of r.cupons ?? []) { ... }` dentro do loop de `mes`/`pagina` (o mesmo loop que já resolve `mesISO`, `tipoLabel`, `familiaLabel`, `produtoLabel` por item). Adicionar, no escopo do loop de mês (fora do loop de página, mas dentro do loop de `mes`), 3 arrays acumuladores:

```ts
    const cuponsBulk: CupomBulkRow[] = []
    const itensBulk: ItemBulkRow[] = []
    const pagamentosBulk: PagamentoBulkRow[] = []
```

(inserir logo antes de `let pagina = 1` / `do { ... } while` do loop de página, dentro do `for (let mes = 1; mes <= mesAtual; mes++) { ... }`).

Dentro do loop `for (const c of r.cupons ?? []) {`, logo após o `if (c.cabecalhoCupom?.info?.cCupomCancelado === 'S') continue`, adicionar a extração do cabeçalho:

```ts
        const cab = c.cabecalhoCupom
        cuponsBulk.push({
          n_id_cupom: Number(cab?.nIdCupom),
          chave: cab?.cChaveCupom ?? null,
          data: cab?.dDtEmissaoCupom ? cab.dDtEmissaoCupom.split('/').reverse().join('-') : mesISO + '-01',
          hora: cab?.cHrEmissaoCupom ?? null,
          num: cab?.nNumCupom != null ? String(cab.nNumCupom) : null,
          serie: cab?.nSerieCupom != null ? String(cab.nSerieCupom) : null,
          seq_caixa: cab?.seqCaixa != null ? Number(cab.seqCaixa) : null,
          id_cliente: cab?.idCliente != null ? Number(cab.idCliente) : null,
          id_vendedor: cab?.idVendedor != null ? Number(cab.idVendedor) : null,
          valor: Number(cab?.nValorCupom) || 0,
          cancelado: cab?.info?.cCupomCancelado === 'S',
          devolvido: cab?.info?.cCupomDevolvido === 'S',
        })
        for (const p of c.pagamentosCupom ?? []) {
          pagamentosBulk.push({
            n_id_cupom: Number(cab?.nIdCupom),
            sequencia: Number(p.nSequencia ?? pagamentosBulk.length + 1),
            tipo_doc: p.cTipoDoc ?? null,
            valor: Number(p.nValorDocumento) || 0,
            categoria: p.cCategoria ?? null,
            id_conta_corrente: p.idContaCorrente != null ? Number(p.idContaCorrente) : null,
          })
        }
```

Dentro do loop `for (const it of c.itensCupom ?? []) {`, logo após o `if (it.cItemCancelado === 'S' || it.cCupomCancelado === 'S') continue`, adicionar (antes ou depois do cálculo de `v`, não interfere):

```ts
        itensBulk.push({
          id_item: Number(it.idItem ?? `${cab?.nIdCupom}${it.nSequencia}`),
          n_id_cupom: Number(cab?.nIdCupom),
          id_produto: it.idProduto != null ? Number(it.idProduto) : null,
          cfop: it.cCFOP ?? null,
          ncm: it.cNCM ?? null,
          quant: Number(it.nQuant) || 0,
          v_unit: Number(it.vUnit) || 0,
          v_desc: Number(it.vDesc) || 0,
          v_item: Number(it.vItem) || 0,
          x_prod: it.xProd ?? null,
        })
```

> Os campos `cCFOP`, `cNCM`, `idItem`, `nSequencia`, `xProd`, `nIdCupom`, `cChaveCupom`, `dDtEmissaoCupom`, `cHrEmissaoCupom`, `nNumCupom`, `nSerieCupom`, `seqCaixa`, `idCliente`, `idVendedor`, `nValorCupom`, `pagamentosCupom`, `nSequencia`/`cTipoDoc`/`nValorDocumento`/`cCategoria`/`idContaCorrente` do payload real do Omie precisam ser adicionados aos tipos `CupomItem`/`Cupom` no topo do arquivo (hoje só têm `idProduto, vItem, vUnit, nQuant, vDesc, vAcresc, cItemCancelado, cCupomCancelado` e `cabecalhoCupom.info.cCupomCancelado`, `itensCupom`) — expandir esses `type` com os campos novos como opcionais (`?:`), já que vêm direto da resposta HTTP sem validação de schema.

- [ ] **Step 3: Enviar o lote ao final de cada mês (antes de avançar pro próximo mês)**

Logo após o `} while (pagina <= totPag)` do loop de páginas (ainda dentro do `for (let mes = ...)`), adicionar:

```ts
    await gravarFatoNoFrio(loja.id, cuponsBulk, itensBulk, pagamentosBulk)
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add lib/omie/faturamento.ts
git commit -m "feat(faturamento): grava o fato por cupom no Contabo durante a ingestao"
```

- [ ] **Step 6: Verificação manual (1 loja, sem esperar o cron)**

```bash
CRON_SECRET=$(grep "^CRON_SECRET=" .env.local | cut -d= -f2-)
curl -s --max-time 100 -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/sync/faturamento?loja=3"
```
(ajustar o param exato de loja conforme o código de `/api/sync/faturamento` real — se a rota não aceitar loja por query, usar a UI: logar como QA na loja 3 e clicar "Atualizar" em `/relatorio-faturamento`). Depois:
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "sudo -u postgres psql -d ntb_frio -tAc \"select count(*) from fat_cupons where loja_id=3\""
```
Esperado: contagem > 0.

---

### Task 4: Leitura no app — `lib/faturamento-frio.ts`

**Files:**
- Create: `lib/faturamento-frio.ts`

**Interfaces:**
- Consumes: `buscarFrio` (já existe em `lib/historico-contabo.ts`, assinatura `buscarFrio<T>(caminho: string, params: Record<string, string|number|undefined>): Promise<T[]>`).
- Produces: `type LinhaFatAgregado = { rotulo: string; mes?: string; valor: number; qtde_itens: number }`; `buscarFatAgregado(opts: { lojaId: number; dataInicio: string; dataFinal: string; group: 'dia'|'forma'|'produto'; group2?: 'mes' }): Promise<LinhaFatAgregado[]>`; `type CupomFat = { n_id_cupom: number; chave: string|null; data: string; hora: string|null; num: string|null; serie: string|null; valor: number; cancelado: boolean; devolvido: boolean }`; `buscarFatCupons(opts: { lojaId: number; dataInicio: string; dataFinal: string }): Promise<CupomFat[]>`; `type ItemFat = { id_item: number; n_id_cupom: number; id_produto: number|null; cfop: string|null; ncm: string|null; quant: number; v_unit: number; v_desc: number; v_item: number; x_prod: string|null }`; `type PagamentoFat = { n_id_cupom: number; sequencia: number; tipo_doc: string|null; valor: number; categoria: string|null; id_conta_corrente: number|null }`; `buscarFatCupomDetalhe(lojaId: number, nIdCupom: number): Promise<{ cupom: CupomFat|null; itens: ItemFat[]; pagamentos: PagamentoFat[] }>`. Task 6 consome.

- [ ] **Step 1: Criar o arquivo**

```ts
// Leitura do fato de faturamento por cupom, gravado no Contabo (sem cópia
// no Supabase -- Faturamento nunca teve janela quente, ver spec
// docs/superpowers/specs/2026-07-18-faturamento-fato-cupom-design.md).
// Mesmo espirito de lib/relatorio-frio-nf.ts: um modulo por dominio de
// leitura fria, sempre via buscarFrio.
import { buscarFrio } from '@/lib/historico-contabo'

export type LinhaFatAgregado = { rotulo: string; mes?: string; valor: number; qtde_itens: number }

export async function buscarFatAgregado(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
  group: 'dia' | 'forma' | 'produto'
  group2?: 'mes'
}): Promise<LinhaFatAgregado[]> {
  const rows = await buscarFrio<{ rotulo: string; mes?: string; valor: string | number; qtde_itens: string | number }>(
    '/fat_agregado',
    { loja_id: opts.lojaId, data_inicio: opts.dataInicio, data_final: opts.dataFinal, group: opts.group, group2: opts.group2 },
  )
  return rows.map((r) => ({ rotulo: String(r.rotulo), mes: r.mes, valor: Number(r.valor) || 0, qtde_itens: Number(r.qtde_itens) || 0 }))
}

export type CupomFat = {
  n_id_cupom: number; chave: string | null; data: string; hora: string | null
  num: string | null; serie: string | null; valor: number; cancelado: boolean; devolvido: boolean
}

export async function buscarFatCupons(opts: { lojaId: number; dataInicio: string; dataFinal: string }): Promise<CupomFat[]> {
  const rows = await buscarFrio<CupomFat & { valor: string | number }>('/fat_cupons', {
    loja_id: opts.lojaId, data_inicio: opts.dataInicio, data_final: opts.dataFinal,
  })
  return rows.map((r) => ({ ...r, valor: Number(r.valor) || 0 }))
}

export type ItemFat = {
  id_item: number; n_id_cupom: number; id_produto: number | null; cfop: string | null; ncm: string | null
  quant: number; v_unit: number; v_desc: number; v_item: number; x_prod: string | null
}
export type PagamentoFat = {
  n_id_cupom: number; sequencia: number; tipo_doc: string | null; valor: number
  categoria: string | null; id_conta_corrente: number | null
}

export async function buscarFatCupomDetalhe(
  lojaId: number,
  nIdCupom: number,
): Promise<{ cupom: CupomFat | null; itens: ItemFat[]; pagamentos: PagamentoFat[] }> {
  const [cupons, itens, pagamentos] = await Promise.all([
    buscarFrio<CupomFat & { valor: string | number }>('/fat_cupons', { loja_id: lojaId, n_id_cupom: nIdCupom }),
    buscarFrio<ItemFat & { quant: string | number; v_unit: string | number; v_desc: string | number; v_item: string | number }>(
      '/fat_cupom_itens', { loja_id: lojaId, n_id_cupom: nIdCupom },
    ),
    buscarFrio<PagamentoFat & { valor: string | number }>('/fat_cupom_pagamentos', { loja_id: lojaId, n_id_cupom: nIdCupom }),
  ])
  const cupom = cupons[0] ? { ...cupons[0], valor: Number(cupons[0].valor) || 0 } : null
  return {
    cupom,
    itens: itens.map((i) => ({ ...i, quant: Number(i.quant) || 0, v_unit: Number(i.v_unit) || 0, v_desc: Number(i.v_desc) || 0, v_item: Number(i.v_item) || 0 })),
    pagamentos: pagamentos.map((p) => ({ ...p, valor: Number(p.valor) || 0 })),
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add lib/faturamento-frio.ts
git commit -m "feat: camada de leitura do fato de faturamento (Contabo)"
```

---

### Task 5: Backfill do histórico (desde 01/07/2025)

**Files:** nenhum neste repo (script ad-hoc rodado no servidor, mesmo padrão do backfill de ajustes executado em 2026-07-18).

**Interfaces:**
- Consumes: `POST /fat_cupons_bulk` (Task 2, já em produção).

- [ ] **Step 1: Escrever o script no scratchpad local**

Criar `/private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/backfill-fat-cupom.mjs`:

```js
// Backfill do fato de faturamento por cupom, desde 01/07/2025. Roda NO
// SERVIDOR Contabo (node 22, pg local -- evita round-trip de rede por
// linha). Sequencial por loja, com checkpoint em arquivo local pra
// retomar se cair. Uso: node backfill-fat-cupom.mjs <lojas-creds.json>
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('/opt/ntb-frio-api/')
const { Pool } = require('pg')

const envFile = fs.readFileSync('/opt/ntb-frio-api/.env', 'utf8')
const env = {}
for (const line of envFile.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const pool = new Pool({ connectionString: env.DATABASE_URL })
const lojas = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const CHECKPOINT_FILE = '/root/backfill-fat-cupom-checkpoint.json'
const checkpoint = fs.existsSync(CHECKPOINT_FILE) ? JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8')) : {}
const salvarCheckpoint = () => fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ultimoDiaMes = (ano, mes) => new Date(ano, mes, 0).getDate()

async function omie(loja, pagina, de, ate) {
  for (let t = 1; t <= 5; t++) {
    const r = await fetch('https://app.omie.com.br/api/v1/produtos/cupomfiscalconsultar/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call: 'CuponsFiscais', app_key: loja.omie_app_key, app_secret: loja.omie_app_secret,
        param: [{ dDtEmissaoDe: de, dDtEmissaoAte: ate, nPagina: pagina, nRegPorPagina: 50 }] }),
    })
    const j = await r.json()
    if (j.faultstring) {
      if (/n[aã]o existem registros/i.test(j.faultstring)) return { cupons: [], nTotPaginas: 0 }
      if (/redundante|Já existe uma requisição/i.test(j.faultstring)) { await sleep(15000); continue }
      throw new Error(j.faultstring)
    }
    return j
  }
  throw new Error('desistiu apos 5 tentativas')
}

for (const loja of lojas) {
  const lojaId = Number(loja.id)
  const inicioISO = checkpoint[lojaId]?.proximoMes ?? '2025-07'
  console.log(`\n=== Loja ${lojaId}: retomando de ${inicioISO} ===`)
  let [ano, mesIni] = inicioISO.split('-').map(Number)
  const hoje = new Date()
  while (ano < hoje.getFullYear() || (ano === hoje.getFullYear() && mesIni <= hoje.getMonth() + 1)) {
    const mm = String(mesIni).padStart(2, '0')
    const de = `01/${mm}/${ano}`
    const ate = `${ultimoDiaMes(ano, mesIni)}/${mm}/${ano}`
    let pagina = 1, totPag = 1
    let cuponsBulk = [], itensBulk = [], pagamentosBulk = []
    do {
      const r = await omie(loja, pagina, de, ate)
      totPag = r.nTotPaginas ?? 1
      for (const c of r.cupons ?? []) {
        const cab = c.cabecalhoCupom
        cuponsBulk.push({
          n_id_cupom: Number(cab?.nIdCupom), chave: cab?.cChaveCupom ?? null,
          data: cab?.dDtEmissaoCupom ? cab.dDtEmissaoCupom.split('/').reverse().join('-') : `${ano}-${mm}-01`,
          hora: cab?.cHrEmissaoCupom ?? null, num: cab?.nNumCupom != null ? String(cab.nNumCupom) : null,
          serie: cab?.nSerieCupom != null ? String(cab.nSerieCupom) : null,
          seq_caixa: cab?.seqCaixa != null ? Number(cab.seqCaixa) : null,
          id_cliente: cab?.idCliente != null ? Number(cab.idCliente) : null,
          id_vendedor: cab?.idVendedor != null ? Number(cab.idVendedor) : null,
          valor: Number(cab?.nValorCupom) || 0,
          cancelado: cab?.info?.cCupomCancelado === 'S', devolvido: cab?.info?.cCupomDevolvido === 'S',
        })
        for (const p of c.pagamentosCupom ?? []) {
          pagamentosBulk.push({
            n_id_cupom: Number(cab?.nIdCupom), sequencia: Number(p.nSequencia ?? pagamentosBulk.length + 1),
            tipo_doc: p.cTipoDoc ?? null, valor: Number(p.nValorDocumento) || 0,
            categoria: p.cCategoria ?? null, id_conta_corrente: p.idContaCorrente != null ? Number(p.idContaCorrente) : null,
          })
        }
        for (const it of c.itensCupom ?? []) {
          itensBulk.push({
            id_item: Number(it.idItem ?? `${cab?.nIdCupom}${it.nSequencia}`), n_id_cupom: Number(cab?.nIdCupom),
            id_produto: it.idProduto != null ? Number(it.idProduto) : null, cfop: it.cCFOP ?? null, ncm: it.cNCM ?? null,
            quant: Number(it.nQuant) || 0, v_unit: Number(it.vUnit) || 0, v_desc: Number(it.vDesc) || 0,
            v_item: Number(it.vItem) || 0, x_prod: it.xProd ?? null,
          })
        }
      }
      pagina++
      await sleep(340)
    } while (pagina <= totPag)

    const client = await pool.connect()
    try {
      await client.query('begin')
      for (const c of cuponsBulk) {
        await client.query(
          `insert into fat_cupons (loja_id, n_id_cupom, chave, data, hora, num, serie, seq_caixa, id_cliente, id_vendedor, valor, cancelado, devolvido)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           on conflict (loja_id, n_id_cupom) do update set valor = excluded.valor, cancelado = excluded.cancelado, devolvido = excluded.devolvido`,
          [lojaId, c.n_id_cupom, c.chave, c.data, c.hora, c.num, c.serie, c.seq_caixa, c.id_cliente, c.id_vendedor, c.valor, c.cancelado, c.devolvido]
        )
      }
      for (const it of itensBulk) {
        await client.query(
          `insert into fat_cupom_itens (loja_id, id_item, n_id_cupom, id_produto, cfop, ncm, quant, v_unit, v_desc, v_item, x_prod)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           on conflict (loja_id, id_item) do update set quant = excluded.quant, v_item = excluded.v_item`,
          [lojaId, it.id_item, it.n_id_cupom, it.id_produto, it.cfop, it.ncm, it.quant, it.v_unit, it.v_desc, it.v_item, it.x_prod]
        )
      }
      for (const p of pagamentosBulk) {
        await client.query(
          `insert into fat_cupom_pagamentos (loja_id, n_id_cupom, sequencia, tipo_doc, valor, categoria, id_conta_corrente)
           values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (loja_id, n_id_cupom, sequencia) do update set valor = excluded.valor`,
          [lojaId, p.n_id_cupom, p.sequencia, p.tipo_doc, p.valor, p.categoria, p.id_conta_corrente]
        )
      }
      await client.query('commit')
    } catch (e) {
      await client.query('rollback')
      throw e
    } finally {
      client.release()
    }
    console.log(`  ${ano}-${mm}: ${cuponsBulk.length} cupons, ${itensBulk.length} itens, ${pagamentosBulk.length} pagamentos`)

    mesIni++
    if (mesIni > 12) { mesIni = 1; ano++ }
    checkpoint[lojaId] = { proximoMes: `${ano}-${String(mesIni).padStart(2, '0')}` }
    salvarCheckpoint()
  }
  console.log(`Loja ${lojaId}: backfill completo.`)
}
await pool.end()
console.log('\nBACKFILL CONCLUIDO')
```

- [ ] **Step 2: Pedir confirmação, exportar credenciais, subir e rodar no servidor**

Backfill completo em produção — confirmar com o usuário antes. Depois:

```bash
node scripts/db.mjs "select id, omie_app_key, omie_app_secret from lojas where ativo=true and omie_app_key is not null order by id" > /private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/lojas-creds.json
scp -i ~/.ssh/notebook_contabo_key /private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/backfill-fat-cupom.mjs root@185.193.66.240:/root/
scp -i ~/.ssh/notebook_contabo_key /private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/lojas-creds.json root@185.193.66.240:/root/
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "chmod 600 /root/lojas-creds.json && cd /root && nohup node backfill-fat-cupom.mjs /root/lojas-creds.json > /root/backfill-fat.log 2>&1 & echo pid=\$!"
```

- [ ] **Step 3: Acompanhar e, ao concluir, apagar as credenciais do servidor**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "tail -20 /root/backfill-fat.log"
```
Repetir até ver `BACKFILL CONCLUIDO`. Depois:
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "rm -f /root/lojas-creds.json /root/backfill-fat-cupom-checkpoint.json"
```

- [ ] **Step 4: Verificar volume final**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "sudo -u postgres psql -d ntb_frio -tAc \"select loja_id, count(*) from fat_cupons group by loja_id order by loja_id\""
```

---

### Task 6: `relatorio-faturamento/page.tsx` — troca de fonte nos 3 gatilhos

**Files:**
- Modify: `app/(app)/relatorio-faturamento/page.tsx`

**Interfaces:**
- Consumes: `buscarFatAgregado`, `buscarFatCupons` (Task 4).

- [ ] **Step 1: Ler o arquivo atual antes de editar**

Ler `app/(app)/relatorio-faturamento/page.tsx` completo (já foi lido nesta conversa anteriormente — conferir que a estrutura de `DIMS`, `rotulosFiltro`, a chamada de `relatorio_faturamento_matriz` e os `campos`/`FiltrosGaveta` ainda batem com o que está documentado no spec antes de editar, já que outras tasks desta mesma Onda podem ter mexido no arquivo).

- [ ] **Step 2: Adicionar o campo `forma_pgto` como filtro real e a lógica de troca de fonte**

Adicionar ao tipo de `searchParams`: `forma_pgto?: string` (se já não existir — o código atual referencia `formaPgtoFiltro` a partir de `sp.forma_pgto`, conferir).

Adicionar, logo após resolver `tipoFiltro`/`familiaFiltro`/`formaPgtoFiltro`:

```ts
  const dimensoesAtivas = [tipoFiltro.length > 0, familiaFiltro.length > 0, formaPgtoFiltro.length > 0].filter(Boolean).length
  const verCupons = sp.ver === 'cupons'
  const usarFato = formaPgtoFiltro.length > 0 || dimensoesAtivas > 1 || verCupons
```

- [ ] **Step 3: Quando `usarFato`, buscar do fato em vez do pré-agregado**

O arquivo real (confirmado) já tem `mesIni`/`mesFim` como strings `'YYYY-MM'` (ou `null`) e `mesAtual` também `'YYYY-MM'` (linha 93, `new Date().toLocaleDateString('en-CA', {...}).slice(0, 7)`) — não existem variáveis de dia (`ano`/`hojeISO`) nesse arquivo; construir o range de dias a partir dos meses. Adicionar, condicionado a `usarFato`:

```ts
  // 'YYYY-MM' -> 'YYYY-MM-DD' do ultimo dia do mes.
  function fimDoMes(mesISO: string): string {
    const [a, m] = mesISO.split('-').map(Number)
    return `${mesISO}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`
  }
  const mesIniEfetivo = mesIni ?? mesAtual
  const mesFimEfetivo = mesFim ?? mesAtual

  let matrizFato: { rotulo: string; mes?: string; valor: number }[] = []
  let cuponsFato: Awaited<ReturnType<typeof buscarFatCupons>> = []
  if (usarFato) {
    if (verCupons) {
      cuponsFato = await buscarFatCupons({ lojaId, dataInicio: `${mesIniEfetivo}-01`, dataFinal: fimDoMes(mesFimEfetivo) })
    } else {
      const group = formaPgtoFiltro.length > 0 ? 'forma' : 'produto'
      matrizFato = await buscarFatAgregado({
        lojaId, dataInicio: `${mesIniEfetivo}-01`, dataFinal: fimDoMes(mesFimEfetivo), group, group2: 'mes',
      })
    }
  }
```

Adicionar o import: `import { buscarFatAgregado, buscarFatCupons } from '@/lib/faturamento-frio'`.

- [ ] **Step 4: Renderizar a matriz do fato ou a lista de cupons quando `usarFato`**

Quando `usarFato && !verCupons`: usar `matrizFato` no lugar do pivot atual (mesmo formato `{rotulo, mes, valor}` que o pré-agregado já produz — a tabela existente deve funcionar sem mudança estrutural, só trocando a fonte dos dados de entrada do pivot).

Quando `usarFato && verCupons`: renderizar uma tabela nova (Data, Hora, Número, Valor, Cancelado/Devolvido) a partir de `cuponsFato`, com link `?ver=` removido e um campo pra abrir o detalhe do cupom (fica pra uma iteração seguinte — nesta task só a lista).

Adicionar um toggle "Ver cupons" na UI (link simples `<Link href="?ver=cupons">`) perto do `SegmentLinks` de dimensão existente.

- [ ] **Step 5: Typecheck e verificação manual**

```bash
npx tsc --noEmit
```
`npm run dev`, abrir `/relatorio-faturamento?forma_pgto=<valor real após backfill>` — confirmar que a matriz muda de fonte (valores batem com `fat_cupom_pagamentos` agregado por `tipo_doc`). Abrir `/relatorio-faturamento?ver=cupons` — confirmar que a lista de cupons aparece.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/relatorio-faturamento/page.tsx"
git commit -m "feat(relatorio-faturamento): troca pro fato quando forma de pagamento, multi-dimensao ou ver-cupons"
```

---

## Ordem de execução

Task 1 → Task 2 (schema antes dos endpoints que o usam) → Task 3 (ingestão, pode rodar em paralelo com Task 4) → Task 4 → Task 5 (backfill, só depois que Task 2 estiver validada em produção) → Task 6 (só depois que Task 5 tiver dado real pra testar contra).
