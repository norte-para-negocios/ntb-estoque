# Migração: Contabo vira o banco principal (Supabase cloud aposentado) — Design Spec

**Data:** 2026-07-31
**Origem:** instabilidade recorrente do Supabase free tier (lentidão, 504 do
Cloudflare, quedas) levou o usuário a pedir explicitamente, várias vezes,
para abandonar o Supabase cloud e rodar tudo só no servidor Contabo
(`185.193.66.240`), que já hospeda um stack self-hosted equivalente
(Docker Compose, mesmo software open-source que o Supabase Cloud roda)
funcionando hoje como *standby* de emergência (`docs/superpowers/specs/2026-07-23-failover-contabo-design.md`).

Durante o levantamento desta spec, um incidente real (queda de produção de
~8min, causada por trabalho manual de Docker colidindo com a lógica de
autocorreção do `health-monitor.ts`) reforçou que essa virada precisa de um
roteiro testado, não de comandos avulsos. No mesmo incidente foi descoberto
e corrigido um bug de regressão: 3 tabelas (`cargos`, `permissoes`,
`cargo_permissao`) tinham sido re-adicionadas por engano à publicação de
replicação lógica, revivendo um travamento determinístico do motor de
replicação já documentado e corrigido em 2026-07-24. Removidas de novo da
publicação antes desta spec ser escrita — ver Constraint específica abaixo.

**Requisito explícito do usuário:** a virada tem que levar **tudo** —
"logins e tudo" — nenhum dado pode ficar pra trás. Isso vira o critério de
aceite central desta spec, não um detalhe de implementação.

## Contexto atual (o que já existe, não construir do zero)

- Stack self-hosted já roda em `/opt/ntb-estoque-standby/` (Docker Compose):
  Kong, Postgres, GoTrue (Auth), PostgREST (REST), Storage, Realtime, Meta,
  Studio, imgproxy — 11 containers, hoje ligados/desligados sob demanda pelo
  `lib/failover/health-monitor.ts`.
- Réplica contínua do schema `public` via replicação lógica nativa do
  Postgres (`ntb_estoque_pub`/`ntb_estoque_sub`) — 41 das 44 tabelas atuais
  (3 excluídas por travamento do motor de replicação, dados estáticos já
  corretos via seed de migration).
- `scripts/sync-auth-standby.mjs`, rodando via cron no servidor, sincroniza
  `auth.users`/`auth.identities` do Supabase real pro self-hosted a cada
  ciclo (unidirecional, cloud → Contabo).
- `lib/supabase/server.ts` decide entre cloud e standby via
  `getFailoverStatus()` — único ponto do código que sabe da existência de
  dois bancos.
- Levantamento feito nesta sessão confirmou escopo tratável: **Realtime e
  Edge Functions não são usados**; **não existe client-side Supabase**
  (`lib/supabase/client.ts` não é importado em lugar nenhum — tudo roda via
  Server Components/Actions); Auth tem só **~12 usuários**; RLS cobre **12
  tabelas** (o resto do controle de acesso é feito no código, via
  `createServiceClient()`, usado em 90 dos arquivos que falam com o banco).

## Achado crítico desta spec: Storage guarda metadado no Postgres, mas os ARQUIVOS não são replicados

`storage.objects` (metadado: nome, bucket, tamanho) fica no schema
`storage`, fora da publicação de replicação (que cobre só `public`). Os
bytes de verdade ficam num backend de arquivo local
(`GLOBAL_S3_BUCKET=stub` no `.env` do stack — não é S3, é filesystem). **O
volume de Storage do Contabo está praticamente vazio hoje (8KB)** — os
arquivos dos buckets `certificados` (certificado digital A1 usado pra
emissão de NF-e de cada loja) e `arquivo-morto` (histórico exportado que
saiu da janela quente) nunca foram copiados. Sem isso, a virada quebraria a
emissão de nota fiscal de todas as lojas no primeiro uso — por isso isso é
tratado como item crítico de bloqueio, não nota de rodapé.

## Arquitetura

**Abordagem escolhida: promover o stack que já existe, não reescrever nada.**

O stack self-hosted já roda o mesmo software que o Supabase Cloud (Kong +
Postgres + GoTrue + PostgREST + Storage), já foi validado funcionalmente na
Fase 1 do design de failover, e já aguentou trocas reais de tráfego durante
incidentes. A virada é: parar de tratá-lo como "só emergência" e torná-lo o
único banco.

Alternativa descartada — **reescrever `lib/supabase/server.ts` e os ~147
arquivos que chamam `createServiceClient()`/`createClient()` para falar
Postgres puro** (sem Kong/PostgREST/GoTrue): daria mais controle e uma
camada a menos, mas significa reimplementar Auth (sessão, hash de senha,
JWT) do zero — risco e esforço muito maiores do que o problema pede. YAGNI.

**O que muda no código:**
- `lib/supabase/server.ts`: remove `urlEChaveAtuais()`/`getFailoverStatus()`
  — passa a usar direto as env vars (que passam a apontar pro Contabo).
- `lib/failover/health-monitor.ts` e o bootstrap dele em
  `instrumentation.ts`: removidos — não existe mais "outro lado" pra
  monitorar.
- `ntb_estoque_pub`/`ntb_estoque_sub` (replicação lógica): removida depois
  do corte confirmado — não há mais primary remoto pra puxar.
- `scripts/sync-auth-standby.mjs`: roda pela última vez no corte, depois
  aposentado (crontab do servidor perde essa linha).

**O que fica igual:** o app continua falando com "Supabase" exatamente do
mesmo jeito (`@supabase/ssr`, `@supabase/supabase-js`) — só o destino muda.
Kong, PostgREST, GoTrue continuam rodando (são o motivo de não precisar
reescrever nada). Realtime e Studio continuam existindo no compose (não
usados pelo app, mas remover é uma limpeza opcional separada, não bloqueia
a virada).

## Checklist de completude (o "tudo, incluindo logins" do usuário)

Todo item abaixo precisa de uma verificação explícita, com número dos dois
lados batendo, antes do corte ser considerado pronto:

1. **Todas as 44 tabelas do schema `public`** — contagem de linhas Supabase
   vs. Contabo batendo exato (41 via replicação contínua + as 3 excluídas
   verificadas à parte, já que não são replicadas: comparar contagem/hash
   direto, pois só ficam corretas se toda migration que os alterou desde
   2026-07-24 foi de fato aplicada nos dois bancos).
2. **`auth.users` + `auth.identities`** — última rodada do
   `sync-auth-standby.mjs` rodada e confirmada (contagem batendo com o
   valor real do dia, não o "12" documentado em 07-23) imediatamente antes
   do corte.
3. **Arquivos de Storage (bytes, não só metadado)** — cópia completa dos
   buckets `certificados` e `arquivo-morto` do Storage real pro volume
   local do Contabo, casando cada arquivo com sua linha em
   `storage.objects`. Teste funcional: baixar um certificado real via
   `lib/actions/certificado.ts` apontando pro Contabo e confirmar que abre.
4. **Políticas RLS** — as 12 policies (schema `auth`/`loja_user`-dependentes)
   já devem estar presentes via replicação de DDL das migrations, mas
   precisam de confirmação explícita (`\d+` ou `pg_policies`) nas 12
   tabelas, não assumidas.
5. **Crons do servidor** — `sync-cron.sh` já bate em `localhost:3002`
   (independente de qual banco o app usa) — não precisa mudar, só confirmar
   que continua rodando sem erro depois do corte.

## Fluxo do corte

1. **Pré-voo (dias antes, sem afetar produção):** rodar o checklist de
   completude acima uma vez, corrigir qualquer divergência encontrada,
   deixar a réplica "quente" e correta.
2. **Janela de manutenção curta (~2-5min, horário de menor uso):**
   - Colocar o app em modo leitura ou parar `ntb-estoque.service`
     brevemente (decisão de implementação: qual dos dois é mais simples de
     reverter rápido).
   - Confirmar replicação em dia (`pg_stat_subscription`, lag = 0).
   - Rodar `sync-auth-standby.mjs` uma última vez.
   - Re-confirmar o checklist de completude (passo rápido, não a auditoria
     inteira).
3. **Virada:** trocar as env vars (`NEXT_PUBLIC_SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, etc.) pro endpoint do Contabo, reiniciar
   `ntb-estoque.service`.
4. **Confirmação pós-corte:** login real, leitura, escrita (criar produto,
   dar entrada em NF, emitir uma NF-e de teste usando o certificado
   copiado), conferir que os crons do servidor seguem batendo sem erro.
5. **Supabase cloud:** pausado (não apagado) por alguns dias como rede de
   segurança, conforme decidido — só apagado depois de confirmar
   estabilidade real do Contabo como principal.

## Rollback

Se algo quebrar logo após o corte: reverter as env vars pro Supabase cloud
(ainda pausado, não apagado) e religar. Qualquer escrita feita no Contabo
durante a janela entre o corte e a detecção do problema fica só lá — mesmo
risco de remapeamento de id já documentado na spec de failover original
(seção "Por que não é um problema de dois bancos escrevendo ao mesmo
tempo"); pela janela ser curta e o corte ser em horário de baixo uso, o
volume esperado dessas escritas é pequeno o suficiente pra reconciliar à
mão se precisar.

## Backup (gap novo que a virada cria)

Hoje não existe backup automático recorrente do Postgres do Contabo — só
dumps manuais avulsos (`/root/backup-*.sql`). Enquanto o Supabase cloud
era principal, o backup gerenciado dele cobria esse papel. Sem ele, isso
vira responsabilidade nossa: a virada inclui configurar `pg_dump` noturno
com retenção (disco tem 156GB livres — sobra à vontade) via cron no
servidor, antes do corte ser considerado concluído (não como tarefa
"depois").

## Teste de capacidade (deixado de fora da spec de failover original, incluído aqui)

O stack self-hosted nunca recebeu tráfego de **primary sob uso real
simultâneo das 6 lojas** — só tráfego de standby ocioso e janelas curtas de
failover automático. O servidor tem margem hoje (6 vCPU, 11GB RAM, load
average ~0,5-1,0, 156GB disco livre) rodando também `ntb-vendas`,
`ntb-frio-api` e o Postgres nativo do histórico — mas isso precisa ser
confirmado sob carga real antes do corte definitivo, não assumido. O plano
de implementação detalha como (ex.: manter o corte em observação ativa nas
primeiras horas/dias de uso real, com rollback pronto).

## Fora de escopo desta spec

- Remoção do container Realtime/Studio do compose (não usados, mas
  limpeza opcional separada — não bloqueia a virada).
- Inversão da replicação (Contabo → Supabase cloud como backup contínuo
  pós-corte) — decisão futura, não faz parte deste corte.
- Migração do `ntb-vendas` (outro app, mesmo padrão, spec própria se for
  o caso).
- Calibração exata dos comandos/scripts do roteiro de corte — fica para o
  plano de implementação.

## Achado colateral (fora do escopo do banco, registrado pra não se perder)

Durante a checagem de completude ("tudo, incluindo logins") apareceu um
sistema Laravel legado (`estoque.norteparanegocios.com.br`, banco MariaDB
próprio, nada a ver com Supabase/Postgres) que deveria estar desativado mas
ainda recebia escrita real — o Omie provavelmente ainda tinha a URL antiga
cadastrada como destino de webhook, ao lado da URL do app novo. Os workers
de fila e o processo Reverb desse sistema foram parados via
`supervisorctl` em 2026-07-31 (reversível, não desinstalado). Limpeza do
cadastro de webhook no portal do Omie (não tem API pra isso, é manual, por
loja) delegada ao Ramon. Não afeta esta migração — só registrado aqui para
o próximo que mexer no servidor não se confundir com o motivo do sistema
antigo estar mudo.
