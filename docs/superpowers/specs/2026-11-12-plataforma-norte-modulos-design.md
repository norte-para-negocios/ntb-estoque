# Plataforma Norte: um lugar, um login, módulos por plano

Data: 12/11/2026 · Dono: Joaquim · Status: rascunho para aprovação

## Por que

Hoje a Norte vende sistemas separados, cada um com seu login, seu endereço e suas regras soltas de "quem vê o quê":

- **Norte Vendas** (PDV: mesas, pedidos, caixa, cozinha, cardápio por QR), app próprio em `testvendase…`, login próprio (`store_users`, `universal_users`, `system_admins`), banco `ntb_vendas`.
- **Norte ERP / Estoque** (estoque, compras, produção, fiscal, finanças), em `app-estoque…`, login pelo Supabase Auth (`profiles`), banco `postgres`.
- **Norte Cozinha** (custo de prato, CMV, cardápios, eventos, guia de preparo), dentro do ERP em `/cozinha`, só para desenvolvedores.
- **Pacioli** (robô que corrige o estoque + assistente), tela embutida no ERP e liberada por uma lista fixa no código (`lib/pacioli.ts`).

O dono quer que o restaurante entre **num lugar só, com um login só**, e veja os módulos que contratou. O que não contratou aparece **bloqueado** (vitrine para vender). Cada módulo tem **preço próprio**. Junto com isso, o ERP precisa ser **reorganizado**: está cheio de botões, feio e pouco intuitivo.

## O que o dono decidiu (palavras dele resumidas)

1. Um lugar só, um login só para todo mundo (do garçom ao dono); cada pessoa vê o que o cargo permite.
2. Quem assina só o Norte Vendas entra e vê só o Vendas; Estoque e os outros aparecem bloqueados.
3. Módulos: **Vendas**, **ERP**, **Norte Cozinha** (separada, vendável sozinha) e **Pacioli**. Cada um com seu preço.
4. **O Norte Vendas fica como está** (visual e fluxo). Quem precisa mudar é o ERP.
5. A Norte Cozinha separada: sem o ERP, o restaurante cadastra insumos e receitas nela (como o Kitchen Sense); com o ERP, ela usa os dados do ERP.

Preços: o Ramon vetou preço publicado sem autorização (28/10). Os últimos valores que estiveram no site eram Vendas Balcão R$ 50/mês, Mesas R$ 70/mês, +10 mesas R$ 30/mês. **Nenhum preço fica fixo no código**: tudo configurável numa tela de administração da Norte.

## Objetivos

- **G1. Módulos de verdade:** um cadastro central de módulos, planos e o que cada loja (e grupo de lojas) contratou, com estado `ativo`, `em teste` (só desenvolvedores), `bloqueado` (vitrine), `suspenso`.
- **G2. Porta única:** uma tela inicial da Norte (depois do login) com os módulos da pessoa, cada um com cadeado ou não, e a troca de loja.
- **G3. Login único:** a mesma conta entra em todos os módulos. Para o garçom/caixa no app de Vendas, a mesma credencial funciona lá.
- **G4. Bloqueio de verdade:** o servidor de cada app recusa telas e APIs de módulo não contratado (não é só esconder o menu).
- **G5. Norte Cozinha vendável sozinha**, com cadastro próprio quando a loja não tem o ERP.
- **G6. ERP reorganizado** por fluxo de trabalho: cada tela com uma pergunta e uma ação principal, menu a 1 clique, nomes que a operação usa.

## Não-objetivos (agora)

- Mudar o visual ou o fluxo do Norte Vendas (só o login e a porta).
- Cobrança automática (cartão, boleto, nota da mensalidade). Primeiro a Norte liga e desliga módulos à mão numa tela; cobrança é uma fase futura opcional.
- Juntar os dois bancos (`postgres` e `ntb_vendas`) num só. Continuam separados; o que é compartilhado é conta e assinatura.
- Reescrever o ERP do zero.

## Anti-objetivos (seria fracasso mesmo funcionando)

- Qualquer loja real perder acesso a algo que usa hoje no dia da virada. **Regra de ouro: loja sem configuração = tudo como hoje.** (Mesmo princípio de `resolveStoreModules` no Vendas.)
- O garçom ter que trocar de senha, de app ou de rotina no meio do serviço.
- Duplicar cadastro (produto, pessoa, loja) entre módulos.
- Derrubar produção: deploy do ERP só de madrugada; do Vendas, após teste completo do fluxo pedido→impressão→conta→nota→baixa.
- "Módulo bloqueado" virar só um menu escondido com a tela aberta pela URL.

## Restrições do que já existe

- Mesmo servidor (Contabo), mesmo Postgres, **dois bancos**: `postgres` (ERP, com Supabase Auth/GoTrue, PostgREST em `127.0.0.1:8100`) e `ntb_vendas` (Vendas, PostgREST próprio `rest-vendas`, autenticação por RPCs `security definer` próprias: `authenticate_store_user_secure`, `authenticate_universal_user_secure`, `authenticate_admin_secure`).
- O ERP e o Vendas já conversam: chave `lojas.integracao_api_key`, sincronização de catálogo (`lib/estoque/catalogo-sync.ts`), ordem de produção vinda do Vendas.
- O Vendas já tem módulos **internos** por loja (`stores.config.modules`: mesas, balcão, KDS cozinha/bar, caixa, cardápio, admin). Isso continua sendo a configuração **dentro** do módulo Vendas, não a assinatura.
- O ERP tem: menu antigo e "menu novo" por módulos (`lib/central/modulos.ts`, só dev), regras soltas (`ROTAS_SO_DEV`, `superAdmin`, `soEstoqueProprio`, `comEstoque`, `soPacioli`), modos de loja `omie | proprio | nenhum`, lojas de teste (`is_test`), app desktop offline (Electron) que replica o banco.
- Apps nativos: Vendas tem app Android/desktop (garçom, caixa, impressão) com login próprio; ERP tem app desktop offline.

## O desenho

### 1. Módulos e assinaturas (G1, G4)

Catálogo fixo de módulos, com submódulos quando fizer sentido:

| Módulo | O que liga | Observação |
|---|---|---|
| `vendas` | O app Norte Vendas. Plano `balcao` ou `mesas` (+ pacotes de mesas) | Submódulos internos continuam em `stores.config.modules` |
| `erp` | Estoque, Compras, Produção, Fiscal, Finanças no ERP | Finanças e Fiscal podem virar submódulos pagos depois |
| `cozinha` | Norte Cozinha (`/cozinha`) | Funciona com ou sem `erp` |
| `pacioli` | Robô de correções + assistente | Substitui a lista fixa de `lib/pacioli.ts` |
| `dashboard` | Início e resumo do dia | Sempre incluso |

Tabelas novas no banco `postgres` (o "lado central"), esquema `plataforma`:

- `plataforma.modulos` (catálogo: id, nome, descrição, ordem, ícone).
- `plataforma.planos` (id, módulo, nome, preço mensal configurável, o que inclui em JSON, ativo).
- `plataforma.clientes` (o restaurante/grupo que paga; ex.: "Grupo Donana" com 5 lojas).
- `plataforma.assinaturas` (cliente ou loja, módulo, plano, estado `ativo | teste | bloqueado | suspenso`, início, fim, preço combinado, observação).
- `plataforma.lojas` (a loja unificada: liga `erp_loja_id` (lojas.id) e `vendas_store_id` (stores.id), nome, cliente).

Uma função única responde "esta pessoa, nesta loja, pode usar este módulo?" (`podeUsar(pessoa, loja, modulo)`), usada pelo menu, pelas páginas e pelas APIs dos dois apps. O Vendas consulta isso por uma API interna do ERP (servidor→servidor, com cache curto) ou por uma cópia leve sincronizada no banco `ntb_vendas`; **decisão do construtor**, desde que a regra de ouro valha se o lado central estiver fora do ar (falha aberta para o que a loja já usa hoje, nunca fechando o PDV no meio do serviço).

Tela de administração **da Norte** (só desenvolvedores): clientes, lojas, assinaturas, planos e preços; ligar/desligar módulo por loja; marcar "em teste".

Migração: todas as lojas reais nascem com as assinaturas que refletem o que já usam (Vendas para quem tem `store`, ERP para quem tem `lojas`, Pacioli para as da lista atual, Cozinha em `teste`). Nada muda para elas no dia da virada.

### 2. Login único e porta (G2, G3)

- **Conta Norte** = uma pessoa. Fica no Supabase Auth do lado central (`postgres`), que o ERP já usa. Cada conta tem vínculos: `pessoa ↔ profile do ERP` e `pessoa ↔ store_user/universal_user do Vendas`, por loja, com o cargo de cada lado.
- **Porta** (`/` depois do login, servida pelo ERP): os módulos da pessoa na loja atual, cada um como um cartão grande (abre, ou mostra cadeado com "fale com a Norte para liberar"), troca de loja, e os avisos do dia. Garçom com só Vendas vai direto para o Vendas, sem passar pela porta.
- **Entrar no Vendas sem novo login:** a porta gera um passe de curta duração assinado (JWT, poucos segundos, uso único) e abre o Vendas; o Vendas valida o passe no servidor e cria a sessão dele do jeito que já cria hoje. O Vendas continua com a tela de login própria (para o app e o PC do salão), que passa a aceitar a credencial da Conta Norte: tenta o login de hoje e, se não achar, valida contra a Conta Norte (mesmo padrão do fallback `universal_users` que já existe).
- **Senhas e nomes:** login por e-mail **ou** nome + senha, como o Vendas já aceita. Garçom continua entrando com nome + senha.
- **Fases para não quebrar ninguém:** (a) contas existentes continuam funcionando como estão; (b) a Norte vincula as pessoas (tela de "pessoas" com sugestão automática por e-mail/nome/loja); (c) quando todos de uma loja estão vinculados, ela passa a usar só a Conta Norte.

### 3. Norte Cozinha separada (G5)

- Loja que só tem `cozinha` vira, por baixo, uma loja do ERP em modo de estoque **próprio** com o módulo `erp` bloqueado: insumos são produtos (`produtos`), receitas são fichas (`fichas_tecnicas`), custo vem das compras lançadas na própria Cozinha. Não existe "segundo cadastro".
- A Cozinha ganha o que hoje só o ERP faz, dentro dela e no jeito dela: cadastrar insumo (com importação por planilha), lançar compra simples (preço e quantidade, atualiza o custo), contagem simples. Tudo grava nas mesmas tabelas do ERP próprio.
- Se a loja contratar o ERP depois, nada migra: só o menu do ERP destrava.
- Lojas no Omie que contratam só a Cozinha: leem do Omie como hoje (já funciona).

### 4. ERP reorganizado (G6)

Projeto próprio dentro da plataforma, por módulo, sempre com **protótipo aprovado antes de codar**:

- Regras já dadas pelo dono: toda tela a 1 clique no menu; um nome por tela (o do menu antigo); cada tela num módulo só; "+ Novo" abre o formulário de verdade; uma pergunta e uma ação principal por tela; resumo → detalhe grande.
- Ordem sugerida: Estoque → Compras → Produção → Fiscal → Finanças (do mais usado ao menos usado), uma rodada por módulo: inventário de telas e botões, protótipo, aprovação, implementação, teste com a operação (Ramon/André).
- O menu do ERP passa a ser gerado pelo catálogo de módulos/assinaturas, e o "menu novo" vira o único.

### 5. Pacioli como módulo

- `pacioli` liga o robô de correções (servidor norte-faxina) e o assistente (dentro da Cozinha e, depois, no ERP). A lista fixa de lojas sai do código e vira assinatura.

## Ordem de entrega (fases)

1. **Assinaturas e bloqueio no ERP** (módulos `erp`, `cozinha`, `pacioli`, `dashboard`): tabelas, tela de administração, `podeUsar`, menu e páginas do ERP respeitando, migração que reproduz o estado atual. Cozinha e Finanças deixam de depender de `ROTAS_SO_DEV` e passam a ser "em teste".
2. **Porta + Conta Norte no ERP**: porta pós-login, vínculo de pessoas, lado central.
3. **Vendas na plataforma**: passe para abrir o Vendas, login do Vendas aceitando a Conta Norte, bloqueio do módulo `vendas` por assinatura (respeitando a falha aberta).
4. **Cozinha sozinha**: cadastro de insumo, compra simples, contagem simples dentro da Cozinha para lojas sem `erp`.
5. **Reorganização do ERP**, módulo por módulo.
6. (Opcional) **Cobrança**.

Cada fase entra em produção sozinha, só para desenvolvedores primeiro, depois numa loja-piloto.

## Decisões tomadas na revisão (minhas, conferir)

- **Bloqueio do Vendas na entrada:** o módulo `vendas` é barrado no login, na sessão e no passe da porta. Trancar o banco do Vendas (RLS hoje é `allow_all_anon`) é dívida de segurança registrada à parte, fora deste projeto, para não reabrir o Vendas inteiro.
- **Garçom sem e-mail:** a Conta Norte aceita "nome + loja + senha". Por baixo, o login usa um e-mail interno gerado (ex.: `<id>@contas.norte.local`) que ninguém vê. O garçom continua digitando nome e senha no app, com a loja já escolhida no aparelho.
- **Senhas:** ao vincular uma pessoa, a senha do Vendas vira a senha da Conta Norte (guardada com hash; a do Vendas, hoje em texto puro, deixa de ser usada). O `store_users` fica só como reserva para o modo sem internet do salão até os apps novos estarem em todas as lojas.
- **Cozinha + Vendas sem ERP:** a baixa e a ordem de produção que vêm das vendas continuam rodando no estoque próprio, escondidas. Sem isso não existe CMV real na Cozinha.
- **Domínio:** a porta e o ERP ficam num endereço só (ex.: `app.norteparanegocios.com.br`). O Vendas continua no endereço dele, aberto pela porta com o passe. Unificar o domínio do Vendas fica para depois.
- **Pacioli:** a assinatura liga e desliga o robô no servidor (o norte-faxina consulta `podeUsar`). O login próprio do Pacioli vira Conta Norte numa fase posterior.

## O que fica para o construtor decidir

- Como o Vendas lê as assinaturas (API interna com cache ou cópia sincronizada), desde que valha a falha aberta.
- Formato exato do passe entre ERP e Vendas (JWT com segredo compartilhado é o padrão esperado).
- Nomes de tabelas e colunas, desde que fiquem no esquema `plataforma`.
- Como o app desktop offline do ERP e o app do Vendas guardam a assinatura para funcionar sem internet.

## Riscos conhecidos

- Dois bancos e dois sistemas de login: vincular pessoas mal = gente entrando na loja errada. Mitigação: vínculo sempre confirmado por uma pessoa, nunca automático sem revisão.
- Apps nativos (Android/desktop) com login próprio e modo offline: a troca de login precisa de versão nova dos apps; nunca obrigatória (lição de 30/09).
- O menu novo foi reprovado 3× em 22/10 pela organização: a reorganização do ERP precisa seguir as regras do dono à risca e passar por protótipo.
