# Sincronização automática com o Omie

O sistema fica atualizado sozinho, sem precisar clicar em "Atualizar agora". São duas camadas:

## 1. Webhook do Omie (tempo real)

Quando uma nota fiscal, ordem de produção ou local de estoque muda no Omie, ele avisa o sistema na hora e a tela atualiza em segundos.

**Para funcionar, a URL do webhook precisa estar cadastrada no Omie de CADA loja:**

1. Pegue a URL na tela **Lojas** do sistema (botão "Copiar"): `https://ntb-estoque.vercel.app/api/webhook`
2. No Omie de cada loja: **Configurações → Integrações → Webhook** (ou Segurança → My Apps → Webhook), cole a URL e ative os tópicos de Recebimento de Produto, Ordem de Produção e Local de Estoque.
3. Repita nas 6 lojas.

## 2. Cron automático (rede de segurança)

Um workflow do GitHub Actions (`.github/workflows/sync-omie.yml`) chama as rotas de sincronização a cada 10 minutos. Cobre o que o webhook não pega e garante atualização contínua mesmo se algum webhook falhar.

**Configuração única (uma vez):**

1. No GitHub do repositório → **Settings → Secrets and variables → Actions → New repository secret**.
2. Nome: `CRON_SECRET`. Valor: o mesmo `CRON_SECRET` configurado nas variáveis de ambiente do Vercel.
3. Pronto. O workflow roda automaticamente; dá pra disparar manualmente em **Actions → Sync Omie → Run workflow**.

> O botão "Atualizar agora" continua existindo para forçar uma sincronização na hora, mas no dia a dia não é necessário.
