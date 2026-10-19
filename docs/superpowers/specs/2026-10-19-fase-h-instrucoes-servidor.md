# Fase H — instruções de servidor (NÃO aplicadas)

Contabo `185.193.66.240`. Nada aqui foi aplicado pela Fase H: cada bloco pede OK do dono, janela calma (fora do ciclo
de 10 min do `sync-cron.sh`) e conferência antes/depois. Achados e provas: `2026-10-19-fase-h-seguranca-achados.md`.
Ordem sugerida: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9.

## 1. Backup do `ntb_frio` (histórico "pra sempre") — hoje NÃO existe

O `backup-bancos.sh` (crontab 04:30) e o `ntb-backup-postgres` (timer) só copiam o Postgres do Docker
(`estoque`, `vendas`). O Postgres nativo (`ntb_frio`, 1,5 GB: webhooks, `fat_cupons*`, histórico de NF/OP/movimentos)
não tem cópia nenhuma. E todas as cópias ficam no mesmo disco do servidor.

```bash
# 1a. acrescentar ao fim do laço de /usr/local/bin/backup-bancos.sh (mesmo padrão de nome/retenção):
H=$(date +%F); D=/root/backups-diarios
umask 077
sudo -u postgres pg_dump -Fc -d ntb_frio > "$D/frio-$H.dump.tmp" && [ -s "$D/frio-$H.dump.tmp" ] \
  && mv "$D/frio-$H.dump.tmp" "$D/frio-$H.dump" && echo "$(date -Is) OK frio $(du -h "$D/frio-$H.dump" | cut -f1)" >> /var/log/backup-bancos.log
find "$D" -name "frio-*.dump" -mtime +7 -delete

# 1b. cópia fora do servidor (cifrada), ex.: age + rclone para um bucket, ou scp para o Mac:
#   age -r <chave-publica> "$D/estoque-$H.dump" > "$D/estoque-$H.dump.age" && rclone copy "$D/"*.age remoto:ntb-backups/
# 1c. prova de restauração 1x por mês, no Mac (nunca no servidor):
#   scp root@185.193.66.240:/root/backups-diarios/frio-AAAA-MM-DD.dump /tmp/ && \
#   docker exec -i ntb-teste-sql pg_restore -U postgres --create -d postgres < /tmp/frio-AAAA-MM-DD.dump
```

Também: `chmod 600` nos arquivos de `/root/backups-ntb-estoque/` (hoje 644; protegidos só porque `/root` é 700).

## 2. Postgres nativo escutando na internet (5432)

`listen_addresses = 'localhost,185.193.66.240'`, `pg_hba` com `hostssl ntb_frio ntb_frio_app` para 2 IPs da AWS
(52.67.188.92 e 54.232.77.43, sobra do Supabase cloud/Vercel) e o firewall abre 5432 para esses 2 IPs. Nenhuma
conexão remota ativa (pg_stat_activity: só local). Quem tiver um desses IPs (AWS compartilhada) tenta senha.

```bash
# conferir antes que ninguém usa (deve dar 0 linhas nos últimos dias):
zgrep -hE "52\.67\.188\.92|54\.232\.77\.43" /var/log/postgresql/*.log* | tail
# fechar:
sed -i "s/^listen_addresses = .*/listen_addresses = 'localhost'/" /etc/postgresql/17/main/postgresql.conf
sed -i '/^hostssl ntb_frio ntb_frio_app 5[24]\./d' /etc/postgresql/17/main/pg_hba.conf
v-list-firewall | grep 5432          # anotar os IDs das 2 regras
v-delete-firewall-rule <ID1>; v-delete-firewall-rule <ID2>
systemctl restart postgresql          # frio-api reconecta sozinha; conferir: curl 127.0.0.1:3001 (401 = no ar)
```

## 3. HTTP sem redirecionar para HTTPS, sem HSTS, sem limite de requisições

`http://app-estoque.norteparanegocios.com.br/login` responde 200 (o cookie de sessão pode viajar sem TLS). O código
(commit 3fedcbc9) já manda HSTS e os outros cabeçalhos; falta o nginx forçar HTTPS.

```bash
for d in app-estoque estoque frio-api updates; do
  v-add-web-domain-ssl-force ntb $d.norteparanegocios.com.br
  v-add-web-domain-ssl-hsts  ntb $d.norteparanegocios.com.br
done
```

Limite de requisições (nginx). NÃO editar `/etc/nginx/conf.d/domains/*.conf` na mão (o rebuild do Hestia apaga, ver
AGENTS.md): pôr no template `node-3002` (`/usr/local/hestia/data/templates/web/nginx/node-3002.stpl` e `.tpl`) e
reaplicar com `v-change-web-domain-proxy-tpl ntb app-estoque.norteparanegocios.com.br node-3002`.

```nginx
# /etc/nginx/conf.d/limite-ntb.conf (contexto http)
limit_req_zone $binary_remote_addr zone=ntb_login:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=ntb_api:10m  rate=20r/s;

# dentro do server{} do template node-3002, antes do location /
location = /login                { limit_req zone=ntb_login burst=10 nodelay; proxy_pass http://127.0.0.1:3002; include /etc/nginx/proxy_params; }
location = /api/offline/sessao   { limit_req zone=ntb_login burst=10 nodelay; proxy_pass http://127.0.0.1:3002; include /etc/nginx/proxy_params; }
location /api/                   { limit_req zone=ntb_api burst=100 nodelay;  proxy_pass http://127.0.0.1:3002; include /etc/nginx/proxy_params; }
client_max_body_size 25m;        # hoje 1024m; o maior upload do app é XML (900 KB) e planilha de import
```
(`/etc/nginx/proxy_params` = os `proxy_set_header` que o template já usa; copiar do bloco `location /` existente.)
Depois: `nginx -t && systemctl reload nginx` e `curl -sI https://app-estoque.norteparanegocios.com.br/login`.

## 4. Senha em texto no crontab do root

A linha `*/15 ... sync-auth-standby.mjs` tem `STANDBY_PG_PASSWORD=...` (senha do usuário do pooler, começa com
`1eef`) escrita no próprio crontab.

```bash
install -m 600 /dev/null /root/.config/sync-auth-standby.env
# mover para lá: STANDBY_HOST / STANDBY_PORT / STANDBY_PG_USER / STANDBY_PG_PASSWORD (uma por linha)
# crontab -e: trocar a linha por
*/15 * * * * cd /opt/ntb-estoque && set -a && . /root/.config/sync-auth-standby.env && set +a && /usr/bin/node scripts/sync-auth-standby.mjs >> /opt/ntb-estoque/sync-auth-standby.log 2>&1
```
Depois trocar essa senha (ela ficou em texto) e apagar `/root/backups/sertao_chave_integracao_loja12_2026-09-28.txt`
(chave de integração em texto; guardar no cofre `chaves-apis-joaquim` se ainda for necessária).

## 5. `ntb-frio-api` aceitaria pedido sem chave se a env sumir

`/opt/ntb-frio-api/server.js` (fora do repo): `if (key !== process.env.API_KEY)` passa com env ausente
(`undefined !== undefined` é falso). Hoje as duas envs existem (64 caracteres). Mesma troca já feita na cópia do
desktop (commit 04c10ab1):

```js
if (!process.env.API_KEY || key !== process.env.API_KEY) return res.status(401).json({ error: 'unauthorized' });
if (!process.env.VENDAS_API_KEY || key !== process.env.VENDAS_API_KEY) return res.status(401).json({ error: 'unauthorized' });
```
`systemctl restart ntb-frio-api` e conferir `curl -s -o /dev/null -w '%{http_code}' https://frio-api.norteparanegocios.com.br/movimentos` = 401.

## 6. Token no webhook do Omie (código pronto, desligado)

O código aceita `OMIE_WEBHOOK_TOKEN` (commit 531640e8). Sem a env, nada muda. Para ligar:
1. gerar: `openssl rand -hex 24`;
2. em developer.omie.com.br/my-apps, em CADA app de loja real, trocar o endereço para
   `https://app-estoque.norteparanegocios.com.br/api/webhook?t=<token>`;
3. conferir que os avisos continuam chegando (`select max(created_at) from webhooks` subindo);
4. só então pôr `OMIE_WEBHOOK_TOKEN=<token>` no `/opt/ntb-estoque/.env.local` e reiniciar no próximo deploy.
Se ligar a env antes do passo 2, todo aviso é ignorado em silêncio (incidente de 12/08 tem a mesma cara).

## 7. Painel Hestia (8083) aberto para a internet

Hoje `-A INPUT -p tcp --dport 8083 -j ACCEPT` (só fail2ban protege). Restringir ao IP do dono ou ao Tailscale:
`v-list-firewall | grep 8083` → `v-change-firewall-rule <ID> ACCEPT <ip-do-dono>/32 8083 TCP`.

## 8. FTP (21 + 12000–12100) e SSH com senha

- `vsftpd` ativo e aberto. Se ninguém usa FTP: `systemctl disable --now vsftpd` e remover as regras 21/12000-12100.
- `sshd`: root já só entra com chave; `PasswordAuthentication yes` vale para os outros usuários. Confirmar que todos
  usam chave e pôr `PasswordAuthentication no` em `/etc/ssh/sshd_config.d/99-fase-h.conf`, `sshd -t && systemctl reload ssh`
  (sem fechar a sessão atual até testar um login novo).

## 9. Migration 195 e deploy desta branch

1. backup (`/usr/local/bin/backup-bancos.sh` ou `pg_dump` manual) e OK do dono;
2. conferir que 187–194 (outras frentes) já rodaram ou não mexem nas mesmas funções;
3. `docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < supabase/migrations/195_fase_h_seguranca.sql`
   (tem `begin/commit` próprio; o `notify pgrst` recarrega o cache);
4. conferir: `select has_function_privilege('authenticated','public.financeiro_resumo_cr(bigint)','EXECUTE')` = f,
   `select relrowsecurity from pg_class where relname='bkp_op_sertao_inativo_20261019'` = t,
   `select evtname from pg_event_trigger where evtname='fase_h_fechar_tabela_backup'` = 1 linha;
5. deploy do código (`deploy.sh`), `curl -sI .../login` mostra `strict-transport-security` e não mostra `x-powered-by`;
6. `desktop/scripts/gerar-schema.sh` + versão nova do desktop (link externo e frio-api endurecidos).
