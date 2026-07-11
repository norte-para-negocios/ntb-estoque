# Arquitetura híbrida Supabase + Contabo (Postgres + FDW) para ntb-estoque e ntb-vendas

Data: 2026-07-11
Status: aprovado para planejamento — **execução aguardando confirmação do fundador sobre o Laravel legado** (ver seção "Pendência bloqueante")

## Contexto

`ntb-estoque` está em 479MB de 500MB no Supabase free tier (95,8%, medido em 2026-07-11). `ntb-vendas` está em 14MB, longe do limite — esta spec não cobre ações imediatas para `ntb-vendas`, só deixa a arquitetura pronta para o dia em que precisar.

Pesquisa anterior (`~/pesquisas/pesquisa-supabase-contabo-fdw-2026-07-09.md`) recomendou: migração one-time das tabelas frias para um Postgres simples no Contabo, escrita direta de dado novo já "nascido frio" a partir daí, consulta cruzada via `postgres_fdw` sempre atrás de RPC `security definer`. Esta spec aplica essa recomendação ao servidor Contabo real do cliente.

## Achados do servidor real (VPS `vmi2860993`, IP `185.193.66.240`)

- Ubuntu 24.04.4 LTS, 6 vCPU, 12GB RAM (7,8GB livre), 193GB disco (165GB livre)
- HestiaCP já instalado gerenciando o servidor — **não remover nem reconfigurar**, só adicionar Postgres ao lado
- MariaDB 11.4.12 já roda nativamente (não em Docker) — Postgres deve seguir o mesmo padrão (nativo via `apt`, não Docker), por consistência operacional com o que o HestiaCP já espera gerenciar
- **Achado crítico**: existe um sistema Laravel legado (`estoque.norteparanegocios.com.br`, usuário HestiaCP `ntb`) **ativamente em produção** — banco MariaDB `ntb_estoque` com 6,6GB, `ordem_producaos` com 1.063.854 linhas (última inserida 2026-07-11 17:21), `notas_fiscais` com 42.791 linhas (última 16:17). 49 workers de fila (Supervisor) + Reverb (WebSocket) + php-fpm ativos, consumindo parte da RAM/CPU já contabilizada acima. Fundador confirmou que sabe da existência deste sistema.
- **Pendência bloqueante**: ainda não confirmado se esse Laravel legado é para permanecer rodando indefinidamente ou está em desativação. Isso afeta o dimensionamento de RAM/CPU reservado para o Postgres novo, mas não afeta a arquitetura em si (Postgres nativo convive bem com MariaDB nativo, ambos gerenciados via `apt`/`systemd`, sem conflito de porta ou de recursos dedicados).
- Domínio `vendas.norteparanegocios.com.br` e `testes.norteparanegocios.com.br` só têm landing pages estáticas (não o app Next.js atual) — irrelevante para esta spec, só registrado para contexto.
- SSH root só foi liberado nesta sessão (`PermitRootLogin` estava `no`, corrigido para `prohibit-password` — chave pública apenas, sem senha). Chave usada: `claude-analise-contabo` (ed25519), já em `/root/.ssh/authorized_keys`.

## Arquitetura

### Bloco A — Postgres nativo no Contabo

Instalar Postgres via `apt` (versão do repositório oficial PGDG, não a da distro, para ter uma versão recente e suportada — Ubuntu 24.04 traz Postgres 16 por padrão no repo `noble`, mas o repo PGDG oferece até a 18; usar PGDG para ficar alinhado com o que o Supabase usa). Configurar:
- `listen_addresses` restrito ao IP do Supabase (não `*` — evitar expor a instância a qualquer IP)
- `pg_hba.conf` com regra específica permitindo só o(s) IP(s) de saída do pooler do Supabase, com `scram-sha-256`
- Firewall do HestiaCP (`iptables`/`v-add-firewall-rule`) liberando a porta 5432 só para esses IPs — nunca aberta ao público
- Usuário dedicado (não `postgres` genérico) com senha forte, só com permissão nas tabelas/schema que o FDW vai usar

### Bloco B — Migração one-time das tabelas frias

Do banco Supabase atual do `ntb-estoque`, migrar via `pg_dump`/`pg_restore` (ou `COPY`) as tabelas identificadas como histórico: `movimentos_historico` (73MB), o `full_object` de `nota_fiscal_items` e `ordens_producao` (ou as tabelas inteiras, a decidir no plano de implementação — depende de quanto essas tabelas são lidas em consultas "quentes" do dia a dia). Após confirmar a cópia íntegra, truncar/remover os dados migrados do lado Supabase.

### Bloco C — `postgres_fdw` do lado Supabase

No Supabase, habilitar a extensão `postgres_fdw` (já confirmado disponível no catálogo do free tier), criar `SERVER` apontando para o IP do Contabo, `USER MAPPING` com o usuário dedicado do Bloco A, e `FOREIGN TABLE`s numa schema privada (ex: `frio`). Todo acesso a essa schema passa por RPC `security definer` nova (nunca client direto — foreign tables não têm RLS, já documentado na pesquisa anterior).

### Bloco D — Escrita direta de dado novo "já nascido frio"

Para os dados que já se sabe que são só histórico/auditoria desde a origem (ex: `full_object` bruto vindo da API Omie), avaliar no plano de implementação se vale a pena alterar o código do `ntb-estoque-next` para escrever direto no Postgres do Contabo via uma segunda conexão `pg` (o projeto já tem esse padrão em `scripts/db.mjs`), ou se é mais simples manter tudo passando pelo Supabase e só arquivar periodicamente via job agendado. Essa decisão fica para a fase de planejamento detalhado, não para esta spec.

## Segurança

- Porta 5432 nunca exposta publicamente — só IP(s) do Supabase na whitelist do firewall
- Senha do usuário Postgres novo gerada forte, armazenada como secret (não em `.env` versionado)
- `sslmode=require` na connection string do FDW
- SSH do servidor: já corrigido nesta sessão para aceitar só chave pública (`prohibit-password`) — reforça que qualquer acesso futuro de manutenção deve seguir esse padrão, não voltar a usar senha

## Riscos

- Conviver com o Laravel legado consumindo CPU/RAM/disco já em uso — dimensionar o Postgres novo considerando os ~4GB de RAM já ocupados pelo legado, não os 12GB totais
- `pg_dump`/`pg_restore` de produção real do Supabase precisa ser feito com cuidado (backup antes, testar em tabela pequena primeiro) — detalhar isso no plano de implementação, não nesta spec
- Migração de schema Postgres→Postgres é direta (mesmo motor), sem risco de incompatibilidade de tipos como haveria migrando para MySQL

## Pendência bloqueante antes de qualquer execução

**Não instalar nada, não rodar nenhuma migration real, não tocar no Laravel legado** até o fundador confirmar com o cliente (Ramon/Andrey) o que fazer com o sistema Laravel legado ainda ativo. Esta spec e o plano de implementação que a segue servem para deixar tudo desenhado e pronto para executar assim que essa resposta chegar.
