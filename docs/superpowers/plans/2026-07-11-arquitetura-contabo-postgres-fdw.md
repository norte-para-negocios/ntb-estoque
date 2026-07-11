# Arquitetura híbrida Supabase + Contabo (Postgres + FDW) — Implementation Plan

> **NÃO EXECUTAR NADA DESTE PLANO** até o fundador confirmar com o cliente (Ramon/Andrey) o que fazer com o sistema Laravel legado que já roda na VPS Contabo. Ver `docs/superpowers/specs/2026-07-11-arquitetura-contabo-postgres-fdw-design.md`, seção "Pendência bloqueante". Este documento existe para estar pronto assim que a resposta chegar — é planejamento, não uma fila de trabalho ativa.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task, **somente após a pendência acima ser resolvida e o usuário autorizar explicitamente o início da execução**.

**Goal:** Instalar Postgres nativo na VPS Contabo (`vmi2860993`, IP `185.193.66.240`), migrar as tabelas frias do `ntb-estoque` (histórico + `full_object` bruto) para lá, e expor consulta via `postgres_fdw` no Supabase atrás de RPC segura — sem derrubar o Laravel legado que já roda na mesma máquina.

**Architecture:** Postgres instalado via repositório PGDG (não o da distro Ubuntu), convivendo com o MariaDB nativo já gerenciado pelo HestiaCP. Firewall restrito só ao IP do pooler do Supabase. Migração one-time via `pg_dump`/`COPY`, não replicação contínua (decisão já validada na pesquisa `~/pesquisas/pesquisa-supabase-contabo-fdw-2026-07-09.md`).

## Global Constraints

- Nunca reiniciar/parar o MariaDB, o Supervisor (workers do Laravel legado) ou qualquer serviço do HestiaCP durante a instalação do Postgres.
- Porta 5432 do Postgres novo NUNCA exposta a `0.0.0.0` — só ao(s) IP(s) reais do pooler do Supabase.
- Toda operação destrutiva no Supabase (truncar tabela migrada) só depois de confirmar a cópia íntegra no Contabo (contagem de linhas batendo, checksum de amostra).
- SSH: usar sempre a chave `claude-analise-contabo` já cadastrada em `/root/.ssh/authorized_keys` — não voltar a habilitar senha (`PermitRootLogin` deve continuar `prohibit-password`).

---

### Task 1: Instalar Postgres via repositório PGDG

**Files:** nenhum arquivo do repo — mudança direto no servidor Contabo via SSH.

**Interfaces:**
- Produces: Postgres 17 (ou a versão estável mais recente do PGDG no momento da execução) rodando como serviço systemd, escutando só em `localhost` inicialmente (antes de configurar o IP externo na Task 2).

- [ ] **Step 1: Adicionar o repositório PGDG**

Via SSH (`ssh root@185.193.66.240` com a chave já cadastrada):

```bash
apt install -y postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
```

- [ ] **Step 2: Instalar o Postgres**

```bash
apt update
apt install -y postgresql-17
systemctl status postgresql@17-main
```

Expected: `active (running)`.

- [ ] **Step 3: Confirmar que não conflita com nada existente**

```bash
ss -tlnp | grep 5432
mariadb -u root -e "select 1;"
supervisorctl status | grep -c RUNNING
```

Expected: Postgres escutando só em `127.0.0.1:5432`; MariaDB responde normal; contagem de processos RUNNING do supervisor igual à de antes da instalação (nenhum caiu).

- [ ] **Step 4: Commit**

Não há arquivo de repo para commitar nesta task — documentar no changelog do plano (ver Task final) que a instalação foi concluída em tal data/hora.

---

### Task 2: Criar banco, usuário dedicado e restringir acesso por IP

**Interfaces:**
- Consumes: Postgres rodando (Task 1)
- Produces: banco `ntb_frio`, usuário `ntb_frio_app` com senha forte, acesso liberado só para o IP do pooler do Supabase

- [ ] **Step 1: Descobrir o IP de saída real do pooler do Supabase**

O pooler do projeto `giiwtnddasminjxweohr` (ntb-vendas) usa `aws-1-sa-east-1.pooler.supabase.com` — mas o projeto do `ntb-estoque` (`waubqgkftwrufepwhctc`) pode usar um pooler diferente. Confirmar qual host de pooler o `ntb-estoque` usa (já está em `scripts/.pooler-host` do repo `ntb-estoque-next`) e resolver o(s) IP(s) reais dele:

```bash
cat scripts/.pooler-host
nslookup <host-do-pooler-encontrado-acima>
```

Anotar todos os IPs retornados — poolers do Supabase costumam ter múltiplos IPs (não é um IP fixo único), então a regra de firewall precisa cobrir a faixa ou todos os IPs atuais, com plano de revisão periódica caso o Supabase rotacione os IPs do pooler.

- [ ] **Step 2: Criar banco e usuário**

```bash
sudo -u postgres psql -c "CREATE DATABASE ntb_frio;"
sudo -u postgres psql -c "CREATE USER ntb_frio_app WITH PASSWORD '<gerar senha forte, 32+ chars>';"
sudo -u postgres psql -d ntb_frio -c "GRANT ALL ON SCHEMA public TO ntb_frio_app;"
```

- [ ] **Step 3: Configurar `postgresql.conf` para aceitar conexão externa**

Editar `/etc/postgresql/17/main/postgresql.conf`:

```
listen_addresses = 'localhost,185.193.66.240'
```

- [ ] **Step 4: Configurar `pg_hba.conf` restrito ao(s) IP(s) do pooler**

Editar `/etc/postgresql/17/main/pg_hba.conf`, adicionar (substituindo pelos IPs reais encontrados no Step 1):

```
hostssl ntb_frio ntb_frio_app <IP-DO-POOLER-1>/32 scram-sha-256
hostssl ntb_frio ntb_frio_app <IP-DO-POOLER-2>/32 scram-sha-256
```

- [ ] **Step 5: Reiniciar Postgres e testar**

```bash
systemctl restart postgresql@17-main
systemctl status postgresql@17-main
```

- [ ] **Step 6: Configurar firewall do HestiaCP para a porta 5432**

Usar a interface do HestiaCP (`v-add-firewall-rule` ou a aba Firewall do painel) para liberar a porta 5432 **só** para os IPs do pooler identificados no Step 1 — nunca para `0.0.0.0/0`.

- [ ] **Step 7: Testar conexão externa de uma máquina fora do Contabo**

```bash
psql "postgresql://ntb_frio_app:<senha>@185.193.66.240:5432/ntb_frio?sslmode=require" -c "select 1;"
```

Expected: conecta e retorna `1`. Testar também de um IP que **não** está na whitelist (ex: a máquina de trabalho atual) — deve ser recusado, confirmando que a restrição funciona.

---

### Task 3: Piloto de migração — uma tabela pequena primeiro

**Interfaces:**
- Consumes: banco `ntb_frio` acessível (Task 2)
- Produces: confirmação de que o fluxo de migração funciona antes de arriscar as tabelas grandes

- [ ] **Step 1: Escolher uma tabela pequena e não-crítica do `ntb-estoque` para o piloto**

Sugestão: `notas_fiscais` tem só ~10MB — ou uma tabela ainda menor se existir, para minimizar risco no primeiro teste.

- [ ] **Step 2: Dump da tabela piloto do Supabase**

```bash
pg_dump "$SUPABASE_DB_URL" -t nome_da_tabela_piloto --data-only --column-inserts -f piloto.sql
```

- [ ] **Step 3: Restaurar no Postgres do Contabo**

```bash
psql "postgresql://ntb_frio_app:<senha>@185.193.66.240:5432/ntb_frio?sslmode=require" -f piloto.sql
```

- [ ] **Step 4: Confirmar integridade (contagem de linhas batendo)**

```bash
# No Supabase:
node scripts/db.mjs "select count(*) from nome_da_tabela_piloto"
# No Contabo:
psql "postgresql://ntb_frio_app:<senha>@185.193.66.240:5432/ntb_frio?sslmode=require" -c "select count(*) from nome_da_tabela_piloto"
```

Expected: mesma contagem nos dois lados.

---

### Task 4: Habilitar `postgres_fdw` no Supabase e criar RPC de teste

**Interfaces:**
- Consumes: banco `ntb_frio` com a tabela piloto migrada (Task 3)
- Produces: RPC `fetch_piloto_frio_secure` funcionando via FDW

- [ ] **Step 1: Habilitar a extensão no Supabase**

```sql
create extension if not exists postgres_fdw;
```

- [ ] **Step 2: Criar o foreign server e user mapping**

```sql
create server contabo_frio
  foreign data wrapper postgres_fdw
  options (host '185.193.66.240', port '5432', dbname 'ntb_frio', sslmode 'require');

create user mapping for postgres
  server contabo_frio
  options (user 'ntb_frio_app', password '<senha>');
```

- [ ] **Step 3: Importar o schema da tabela piloto**

```sql
create schema if not exists frio;
import foreign schema public limit to (nome_da_tabela_piloto)
  from server contabo_frio into frio;
```

- [ ] **Step 4: Criar RPC de teste e validar**

```sql
create or replace function public.fetch_piloto_frio_secure() returns jsonb
language sql stable security definer set search_path = public, frio as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from frio.nome_da_tabela_piloto t limit 10;
$$;
grant execute on function public.fetch_piloto_frio_secure() to anon, authenticated;
```

Testar via `node scripts/db.mjs "select fetch_piloto_frio_secure()"` — deve retornar os dados que estão fisicamente no Contabo, provando que o fluxo completo funciona.

---

### Task 5: Migrar as tabelas frias reais e fechar o ciclo

**Interfaces:**
- Consumes: fluxo validado nas Tasks 3-4
- Produces: `movimentos_historico`, e o que mais for decidido no momento (full_object de `nota_fiscal_items`/`ordens_producao`, a decidir com dado real de quanto cada uma é lida em consultas quentes) vivendo no Contabo, com RPCs `security definer` equivalentes às do piloto

- [ ] **Step 1: Repetir o processo de dump/restore/RPC das Tasks 3-4 para cada tabela real escolhida**

- [ ] **Step 2: Confirmar integridade de cada uma antes de truncar no Supabase**

- [ ] **Step 3: Truncar/remover no Supabase só depois de confirmado**

```sql
-- SOMENTE depois de validar a cópia integralmente
truncate table movimentos_historico;
```

- [ ] **Step 4: Medir o tamanho do banco Supabase depois da migração**

```bash
node scripts/db.mjs "select pg_size_pretty(pg_database_size(current_database()))"
```

Expected: queda significativa em relação aos 479MB medidos em 2026-07-11.

- [ ] **Step 5: Documentar no AGENTS.md do ntb-estoque-next**

Adicionar seção nova descrevendo a arquitetura híbrida, o que foi movido, e como consultar dado frio dali para frente (via as RPCs novas).

- [ ] **Step 6: Commit final**

```bash
git add AGENTS.md
git commit -m "docs: documenta arquitetura hibrida Supabase + Contabo apos migracao das tabelas frias"
```
