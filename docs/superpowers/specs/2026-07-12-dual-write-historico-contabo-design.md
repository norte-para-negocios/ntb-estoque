# Escrita dupla (dual-write) para histórico completo no Contabo

Data: 2026-07-12
Status: aprovado, indo direto para implementação (usuário: "só cria, resolve")

## Contexto

A spec anterior (`2026-07-11-arquitetura-contabo-postgres-fdw-design.md`) previa migrar tabelas do Supabase pro Contabo e apagar de lá. Duas coisas mudaram:

1. **`postgres_fdw`/`dblink` não funcionam** — confirmado com 3 testes empíricos consistentes (contra o Contabo real, contra um IP que nunca existe, contra `1.1.1.1:443`): o Postgres do Supabase bloqueia toda conexão TCP bruta de saída, independente de destino ou porta. Consulta cruzada (dado quente + frio) não pode ser feita via SQL dentro do banco — precisa ser feita pela aplicação.

2. **Objetivo real é manter histórico completo pra sempre**, não só arquivar o que não é mais lido. O usuário: "isso era antes da gente ter o Contabo... mesmo sendo dados inúteis, eu quero ter o histórico de tudo". Tabelas candidatas (`movimentos_historico`, `webhooks`) são lidas ativamente por partes do sistema (Resumo do Dia, deduplicação de webhook) — não dá pra simplesmente truncar do Supabase sem reescrever esses pontos de leitura, e o app está em produção real, em uso agora.

## Decisão de arquitetura

**Escrita dupla (dual-write), não migração-e-apaga.** O Supabase continua exatamente como está hoje — mesmas tabelas, mesmas queries, mesmo comportamento, **nenhuma leitura existente é tocada**. Por cima disso, cada escrita relevante passa a também gravar no Contabo, sem limite de retenção, de forma **fire-and-forget**: se a escrita no Contabo falhar, o fluxo principal continua normal (mesmo padrão já usado no projeto para a integração de Ordem de Produção — erro só vai pro `console.error`, nunca quebra a resposta ao usuário/Omie).

Isso significa: o Supabase pode continuar com prune/retenção curta onde já existir (ex: `webhooks` já tem prune de 7 dias via `app/api/cron/prune/route.ts` — **isso não muda**), porque o dado já está salvo pra sempre no Contabo antes de ser limpo do lado quente.

### Por que a app não conecta direto no Postgres do Contabo

A aplicação roda na Vercel, que **não tem IP de saída fixo por padrão** (add-on pago, US$100/mês). Não dá pra replicar a estratégia de whitelist por IP que usamos pro pooler do Supabase.

**Solução**: uma API HTTP pequena rodando no próprio servidor Contabo (Node/Express), atrás do Nginx que o HestiaCP já gerencia, com HTTPS (Let's Encrypt) e autenticação por chave secreta (header `Authorization`). A aplicação Next.js chama essa API via `fetch` HTTPS normal — isso a Vercel faz sem nenhuma restrição de IP (a limitação de IP dinâmico só importa pra quem faz *allowlist* do lado de quem recebe; aqui quem recebe é uma API HTTP nossa, que autentica por chave, não por IP). Mais simples e mais seguro que expor a porta 5432 do Postgres pra internet.

## Escopo desta fase

Só **`webhooks`** — é a mais simples (INSERT + uma leitura pontual de deduplicação, sem lógica de negócio em cima) e a que já tem prune ativo (maior urgência de não perder dado). `movimentos_historico` e outras ficam para uma fase seguinte, replicando o mesmo padrão depois que este estiver estável em produção.

## Arquitetura

### Bloco A — API HTTP no Contabo

Endpoint único por enquanto: `POST /webhooks`, recebe o mesmo payload que hoje vai pro Supabase (`loja_id`, `message_id`, `message`), grava em `ntb_frio.webhooks` (schema idêntico ao Supabase, sem coluna de expiração/prune). Autenticação: header `X-Api-Key` comparado com uma chave secreta fixa (gerada forte, guardada como env var nos dois lados — no `.env` da API no Contabo e no `.env.local`/env da Vercel).

Roda como serviço systemd próprio (`ntb-frio-api`), separado de tudo que já existe (Postgres, MariaDB, o Laravel legado) — não compartilha processo com nada.

### Bloco B — Escrita fire-and-forget na aplicação

Em `app/api/webhook/route.ts`, logo após o `insert` já existente no Supabase (linha 51), adicionar uma chamada `fetch` para a API do Contabo, sem `await` bloqueando a resposta principal — mesmo padrão do `triggerOrdemProducao` que já existe no `ntb-vendas` (fire-and-forget, `.catch(console.error)`).

## Segurança

- API do Contabo só aceita `POST /webhooks` com a chave certa — qualquer outra rota/método, 404/405
- HTTPS obrigatório (Let's Encrypt via HestiaCP, mesmo padrão do domínio do painel)
- Chave secreta forte (32+ chars), nunca commitada — só em variável de ambiente
- Postgres do Contabo continua sem porta exposta à internet (a API é o único ponto de entrada; ela conecta no Postgres via `localhost`)

## Riscos

- Se a API do Contabo cair, o dual-write simplesmente para de gravar lá até voltar (fire-and-forget não tem fila de retry) — aceitável para esta fase, dado que o dado ainda está seguro no Supabase enquanto o prune de 7 dias não rodar. Retry/fila fica para uma iteração futura se a taxa de falha for relevante na prática.
- Nenhum risco à leitura atual do app — nada que já funciona é tocado.
