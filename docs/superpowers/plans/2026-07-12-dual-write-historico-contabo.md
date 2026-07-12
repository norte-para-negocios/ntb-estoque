# Escrita dupla (dual-write) de webhooks para o Contabo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fazer `webhooks` gravar simultaneamente no Supabase (como já faz hoje, sem mudar nada) e no Postgres do Contabo (sem limite de retenção), via uma API HTTP pequena no servidor Contabo, sem tocar em nenhuma leitura existente e sem risco pro app em produção.

**Architecture:** API HTTP (Node/Express) rodando como serviço systemd no Contabo, exposta via HTTPS através do Nginx que o HestiaCP já gerencia, autenticada por chave secreta. A aplicação Next.js (Vercel) chama essa API via `fetch` fire-and-forget logo após o insert já existente no Supabase.

**Tech Stack:** Node.js/Express (API no Contabo), Postgres 17 (já instalado), HestiaCP/Nginx (proxy + TLS), Next.js/TypeScript (app existente).

## Global Constraints

- Nenhuma leitura existente do Supabase é alterada — só adiciona escrita nova.
- A chamada pro Contabo nunca pode bloquear nem quebrar a resposta do webhook — sempre fire-and-forget com `.catch()`.
- Chave secreta da API nunca commitada no repositório.
- Não mexer no Laravel legado nem no MariaDB durante esta implementação.

---

### Task 1: Tabela `webhooks` no Postgres do Contabo

**Interfaces:**
- Produces: tabela `webhooks` em `ntb_frio`, schema compatível com o do Supabase, sem coluna de expiração

- [ ] **Step 1: Confirmar o schema exato da tabela no Supabase**

```bash
node scripts/db.mjs "select column_name, data_type, character_maximum_length from information_schema.columns where table_name = 'webhooks' and table_schema = 'public' order by ordinal_position"
```

- [ ] **Step 2: Criar a tabela idêntica no Contabo**

Via SSH (`ssh root@185.193.66.240` com a chave já cadastrada):

```bash
sudo -u postgres psql -d ntb_frio -c "
create table if not exists webhooks (
  id bigint generated always as identity primary key,
  loja_id bigint not null,
  message_id varchar not null,
  message jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists idx_webhooks_loja_message on webhooks (loja_id, message_id);
"
```

(Ajustar tipos exatos conforme o Step 1 confirmar — a definição acima é a expectativa baseada no schema já visto nesta sessão.)

- [ ] **Step 3: Confirmar a tabela criada**

```bash
sudo -u postgres psql -d ntb_frio -c "\d webhooks"
```

---

### Task 2: API HTTP no Contabo

**Interfaces:**
- Consumes: tabela `webhooks` do Contabo (Task 1)
- Produces: serviço `ntb-frio-api` rodando na porta `3001` (localhost), endpoint `POST /webhooks`

- [ ] **Step 1: Criar a estrutura do projeto no servidor**

```bash
mkdir -p /opt/ntb-frio-api
cd /opt/ntb-frio-api
npm init -y
npm install express pg
```

- [ ] **Step 2: Gerar a chave secreta da API**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Anotar o valor gerado — vai ser usado nos dois lados (Task 2 Step 3 e Task 4).

- [ ] **Step 3: Criar o arquivo `.env`**

```bash
cat > /opt/ntb-frio-api/.env << 'EOF'
PORT=3001
DATABASE_URL=postgresql://ntb_frio_app:<SENHA_JA_CRIADA_NA_FASE_ANTERIOR>@localhost:5432/ntb_frio
API_KEY=<CHAVE_GERADA_NO_STEP_2>
EOF
chmod 600 /opt/ntb-frio-api/.env
```

- [ ] **Step 4: Criar `server.js`**

```javascript
// /opt/ntb-frio-api/server.js
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();
app.use(express.json({ limit: '2mb' }));

function checkAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== process.env.API_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.post('/webhooks', checkAuth, async (req, res) => {
  const { loja_id, message_id, message } = req.body || {};
  if (!loja_id || !message_id || !message) {
    return res.status(400).json({ error: 'loja_id, message_id e message sao obrigatorios' });
  }
  try {
    await pool.query(
      'insert into webhooks (loja_id, message_id, message) values ($1, $2, $3) on conflict do nothing',
      [loja_id, message_id, JSON.stringify(message)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('Erro ao gravar webhook no Contabo:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3001;
app.listen(port, '127.0.0.1', () => console.log(`ntb-frio-api rodando na porta ${port}`));
```

- [ ] **Step 5: Instalar `dotenv`**

```bash
cd /opt/ntb-frio-api && npm install dotenv
```

- [ ] **Step 6: Testar localmente antes de criar o serviço**

```bash
cd /opt/ntb-frio-api && node server.js &
sleep 1
curl -s http://127.0.0.1:3001/health
curl -s -X POST http://127.0.0.1:3001/webhooks -H "X-Api-Key: <CHAVE>" -H "Content-Type: application/json" -d '{"loja_id": 1, "message_id": "teste-plano-123", "message": {"teste": true}}'
kill %1
```

Expected: `/health` retorna `{"ok":true}`; o POST retorna `{"ok":true}`.

- [ ] **Step 7: Confirmar que a linha foi gravada**

```bash
sudo -u postgres psql -d ntb_frio -c "select * from webhooks where message_id = 'teste-plano-123';"
```

- [ ] **Step 8: Limpar a linha de teste**

```bash
sudo -u postgres psql -d ntb_frio -c "delete from webhooks where message_id = 'teste-plano-123';"
```

---

### Task 3: Systemd service + exposição HTTPS via HestiaCP

**Interfaces:**
- Consumes: `server.js` funcionando (Task 2)
- Produces: serviço systemd ativo, domínio `frio-api.norteparanegocios.com.br` com HTTPS apontando pra `localhost:3001`

- [ ] **Step 1: Criar o serviço systemd**

```bash
cat > /etc/systemd/system/ntb-frio-api.service << 'EOF'
[Unit]
Description=NTB Frio API (dual-write Contabo)
After=network.target postgresql@17-main.service

[Service]
Type=simple
WorkingDirectory=/opt/ntb-frio-api
ExecStart=/usr/bin/node /opt/ntb-frio-api/server.js
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now ntb-frio-api
systemctl status ntb-frio-api --no-pager
```

- [ ] **Step 2: Criar o domínio no HestiaCP (usuário `ntb`, mesmo padrão dos outros domínios do projeto)**

```bash
/usr/local/hestia/bin/v-add-web-domain ntb frio-api.norteparanegocios.com.br
```

- [ ] **Step 3: Configurar o proxy reverso do domínio para `localhost:3001`**

Via painel HestiaCP (Web → editar o domínio `frio-api.norteparanegocios.com.br` → habilitar Proxy Support, template para porta 3001), ou via `v-add-web-domain-proxy` se existir no HestiaCP instalado — confirmar o comando exato disponível nesta versão antes de rodar (`ls /usr/local/hestia/bin/ | grep proxy`).

- [ ] **Step 4: Emitir certificado SSL (Let's Encrypt)**

```bash
/usr/local/hestia/bin/v-add-letsencrypt-domain ntb frio-api.norteparanegocios.com.br
```

- [ ] **Step 5: Testar via HTTPS público**

```bash
curl -s https://frio-api.norteparanegocios.com.br/health
```

Expected: `{"ok":true}`.

---

### Task 4: Escrita fire-and-forget na aplicação

**Files:**
- Modify: `app/api/webhook/route.ts:51` (logo após o insert existente no Supabase)
- Modify: `.env.local` (nova var `NTB_FRIO_API_URL` e `NTB_FRIO_API_KEY`) — e o mesmo par de env vars precisa ser configurado nas Environment Variables do projeto na Vercel

**Interfaces:**
- Consumes: `POST https://frio-api.norteparanegocios.com.br/webhooks` (Task 3)

- [ ] **Step 1: Adicionar a chamada fire-and-forget**

Em `app/api/webhook/route.ts`, logo depois de:

```ts
  await supabase.from('webhooks').insert({
    loja_id: loja.id,
    message_id: body.messageId,
    message: body,
  })
```

Adicionar:

```ts
  // Dual-write pro Contabo (historico completo, sem prune) -- fire-and-forget,
  // nunca bloqueia nem quebra a resposta do webhook se falhar.
  fetch(`${process.env.NTB_FRIO_API_URL}/webhooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': process.env.NTB_FRIO_API_KEY! },
    body: JSON.stringify({ loja_id: loja.id, message_id: body.messageId, message: body }),
  }).catch((e) => console.error('Dual-write pro Contabo falhou:', e))
```

- [ ] **Step 2: Adicionar as env vars no `.env.local`**

```bash
echo "NTB_FRIO_API_URL=https://frio-api.norteparanegocios.com.br" >> .env.local
echo "NTB_FRIO_API_KEY=<CHAVE_GERADA_NA_TASK_2>" >> .env.local
```

- [ ] **Step 3: Build local**

```bash
npm run build
```

Expected: build passa sem erro.

- [ ] **Step 4: Commit**

```bash
git add app/api/webhook/route.ts
git commit -m "feat(contabo): dual-write de webhooks para historico completo no Contabo"
```

(`.env.local` nunca é commitado — confirmar que está no `.gitignore`.)

- [ ] **Step 5: Configurar as env vars na Vercel**

Adicionar `NTB_FRIO_API_URL` e `NTB_FRIO_API_KEY` nas Environment Variables do projeto no dashboard da Vercel (Production + Preview), com os mesmos valores do `.env.local`.

- [ ] **Step 6: Deploy e teste real em produção**

Depois do deploy, provocar um webhook real (ou aguardar o próximo natural da Omie) e confirmar que a linha aparece tanto no Supabase quanto no Contabo:

```bash
# Supabase:
node scripts/db.mjs "select id, message_id, created_at from webhooks order by created_at desc limit 3"
# Contabo (via SSH):
sudo -u postgres psql -d ntb_frio -c "select id, message_id, created_at from webhooks order by created_at desc limit 3;"
```

Expected: o `message_id` mais recente aparece nos dois lados.

---

### Task 5: Documentar

- [ ] **Step 1: Atualizar `AGENTS.md`**

Adicionar seção descrevendo o dual-write, a API do Contabo, e que é o primeiro de vários (próximos: `movimentos_historico` e outras, replicando o mesmo padrão).

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: documenta dual-write de webhooks para o Contabo"
```
