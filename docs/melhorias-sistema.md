## Revisão de Arquitetura e Código – Sistema de Estoque Omie

Documento gerado a partir de uma revisão geral da aplicação Laravel, focando em arquitetura, qualidade de código, banco de dados, integrações, frontend, testes e DX.

---

## Visão Geral

- **Domínio principal**: gestão de estoque integrada ao Omie (inventário, ordens de produção, transferências, notas fiscais, produtos, locais de estoque, logs de integração, usuários/lojas/permissões, webhooks Omie).
- **Arquitetura**: monólito Laravel 12 modularizado por domínio (`Inventario`, `Transferencia`, `OrdemProducao`, `NotaFiscal`, etc.), usando Models Eloquent, Controllers por domínio, Services para integrações com Omie, Jobs para tarefas assíncronas, Events + Echo para notificações em tempo real.
- **Pontos fortes**:
  - Uso de Jobs/Queues para cargas pesadas e integrações.
  - Logs de integração (`IntegrationAttempt`) bem estruturados.
  - Organização geral por domínio clara (pastas de controllers, views e services).

---

## Melhorias por Categoria

### 1. Arquitetura

- **Separar regra de negócio dos controllers**
  - Extrair casos de uso/serviços de aplicação (ex.: `FinalizarInventarioService`, `ProcessarTransferenciaService`, `SincronizarOrdemProducaoService`) para concentrar a lógica de domínio fora dos controllers.
  - Deixar controllers responsáveis apenas por: receber request, chamar serviço, decidir view/redirect/JSON.

- **Centralizar integrações com Omie**
  - Consolidar todas as chamadas HTTP ao Omie em serviços dedicados (reutilizando/ampliando `OmieService` e criando serviços específicos por domínio).
  - Padronizar construção de payloads, tratamento de erros (incluindo mensagens de rate limit/`faultstring`) e logging de tentativas de integração.

- **Padronizar uso de `IntegrationAttemptsTrait`**
  - Limitar o uso do trait à camada de serviços/jobs, evitando regras de logging diretamente em controllers.
  - Definir convenção de campos (modelo relacionado, código, mensagem de erro, payloads) para facilitar consultas e debugging.

- **Rever modelo de autorização**
  - Migrar verificações de permissão repetidas em controllers (`CanService::canPermissionLoja(...)` + checagem de perfil) para:
    - Policies por recurso (`Inventario`, `Transferencia`, `OrdemProducao`, etc.), ou
    - Middleware de autorização reutilizável.
  - Objetivo: reduzir duplicação, evitar erros em novos endpoints e alinhar com o padrão nativo do Laravel.

- **Encapsular filtro por loja atual**
  - Substituir `where('loja_id', Auth::user()->current_loja_id)` repetido por:
    - Scopes em modelos (`scopeDaLojaAtual`), e/ou
    - Relacionamentos (`Loja` → `inventarios`, `transferencias`, `posicoesEstoque`), e/ou
    - Global scope quando fizer sentido.

---

### 2. Código PHP / Laravel

- **Usar `FormRequest` de forma consistente**
  - Criar `FormRequest` dedicadas para fluxos que ainda usam `$request->validate()` nos controllers (inventário, ordens de produção, notas fiscais, etc.).
  - Centralizar regras de validação e mensagens, facilitando reaproveitamento e testes.

- **Fortalecer tipagem**
  - Adicionar `return type hints` em:
    - Métodos de relacionamento de modelos (`HasMany`, `BelongsTo`, etc.).
    - Métodos públicos de serviços e controllers (`: void`, `: JsonResponse`, etc.).
  - Benefícios: melhor suporte a análise estática, menor risco de bugs sutis.

- **Reduzir duplicação entre inventário e transferência**
  - Extrair lógica compartilhada em serviços/traits de domínio para:
    - Carregar/atualizar `PosicaoEstoque`.
    - Criar/excluir ajustes Omie para itens/movimentos.
    - Duplicar registros e redefinir status/campos de controle.

- **Melhorar tratamento de erros**
  - Revisar blocos `try/catch` que usam variáveis possivelmente indefinidas (por exemplo, `$response` no `catch`).
  - Padronizar objetos de erro retornados pela camada de serviço (código, mensagem, detalhes) para que controllers possam decidir a resposta HTTP de forma consistente.

- **Encapsular acesso a JSON em models**
  - Criar accessors/casts nos modelos para `full_object` e campos derivados (ex.: `isConcluida()`, `statusTexto()`), evitando `json_decode(...)` espalhado e acesso profundo a propriedades no controller/view.

---

### 3. Banco de Dados

- **Normalizar campos críticos extraídos de JSON**
  - Para dados usados frequentemente em filtros/lógica (status de ordem, flags, campos principais de produto), considerar:
    - Criar colunas normalizadas.
    - Ou criar casts/acessors que retornem objetos tipados.

- **Garantir índices adequados**
  - Conferir e, se necessário, adicionar índices para colunas muito usadas em filtros:
    - `inventarios (loja_id, data, status)`
    - `inventario_items (inventario_id, produto_familia, status)`
    - `posicao_estoques (loja_id, codigo_local_estoque, n_cod_prod, data_posicao)`
    - `movimentos (transferencia_id, id_prod, status)`
    - `transferencias (loja_id, data, status)`
  - Objetivo: manter boa performance em consultas sobre períodos longos e grandes volumes.

- **Clarificar semântica de datas e status**
  - Documentar e, se necessário, ajustar nomes/tipos de campos como `finalizado` (data) e `status` textual.
  - Avaliar introdução de enums/constantes de status bem definidos e, quando fizer sentido, flags booleanas (`is_finalizado`).

- **Remover dados sensíveis de seeds**
  - Substituir credenciais fixas em `DatabaseSeeder` (usuário admin, chaves Omie) por:
    - Valores vindos de `.env`/`config`.
    - Ou seeds fictícios/protegidos por checagem de ambiente.

---

### 4. APIs e Integrações

- **Endurecer o endpoint de webhook**
  - Garantir que `/api/webhook`:
    - Valide rigidamente o payload recebido (via `FormRequest`).
    - Verifique autenticação/assinatura da origem (token ou HMAC).
    - Tenha estratégia de idempotência (evitar reprocessar o mesmo evento).
    - Seja versionado (`/api/v1/webhook/omie`), facilitando futuras mudanças.

- **Padronizar respostas JSON usadas pelo front**
  - Definir um formato de resposta JSON único para endpoints consumidos pelo JavaScript:
    - Exemplo: `{ "success": bool, "message": string, "data": ... }`.
  - Revisar endpoints para alinhar códigos HTTP e formatos (`200/201/400/422/500` com mensagens previsíveis).

- **Observabilidade das integrações**
  - Reforçar uso de `IntegrationAttempt`:
    - Garantir que todas as integrações Omie passem pela mesma camada de logging.
    - Criar filtros/painéis no próprio sistema para buscar por modelo, loja, status, código de erro.

---

### 5. Frontend / Blade / CSS

- **Componentizar views repetitivas**
  - Extrair componentes Blade para:
    - Cards de listagem com header/footer e ações.
    - Barras de filtro/pesquisa.
    - Botões de ação padrão (imprimir, concluir, duplicar, excluir).
  - Facilita manutenção visual e aplicação de mudanças de UX.

- **Organizar JavaScript por domínio**
  - Mover scripts inline das views para arquivos em `resources/js` por contexto (ex.: `ordemproducao.js`, `inventario.js`, `transfers.js`).
  - Importar via Vite e stacks Blade, melhorando caching, legibilidade e possibilidade de testes.

- **Decidir estratégia de CSS (Bootstrap x Tailwind)**
  - Hoje o projeto usa principalmente Bootstrap; Tailwind quase não é utilizado.
  - Definir uma diretriz:
    - Manter Bootstrap e remover referências/dúvidas sobre Tailwind, ou
    - Planejar migração gradual para Tailwind (novos componentes primeiro, telas críticas em seguida).

- **Melhorar UX e feedback de ações críticas**
  - Padronizar confirmações para ações destrutivas (aproveitando o layout de delete).
  - Adicionar estados de carregamento/desabilitação em botões de operações pesadas (finalizar inventário, processar transferência, sincronizar ordens), evitando cliques repetidos.

---

### 6. Testes (Pest)

- **Criar suíte de testes de feature**
  - Priorizar fluxos principais:
    - Inventário: criar, adicionar itens, ajustar quantidades, finalizar.
    - Transferências: criar, adicionar itens, processar/finalizar.
    - Ordens de produção: listar, sincronizar com Omie, marcar como concluída.
    - Webhook Omie: receber payload, validar, disparar jobs corretos.

- **Criar testes de unidade para serviços**
  - Focar em:
    - `OmieService` e serviços de domínio relacionados (sincronização, criação/remoção de ajustes).
    - Serviços de posição de estoque e manipulação de `PosicaoEstoque`.
  - Usar mocks de HTTP/Cache para simular respostas Omie e cenários de erro (rate limit, SOAP errors, etc.).

- **Cobrir cenários de erro com datasets**
  - Utilizar datasets do Pest para validar múltiplas respostas da Omie:
    - Sucesso (200).
    - Rate limit (425, 429).
    - Erros SOAP específicos.
  - Garantir que o sistema marque corretamente status/mensagens em itens, movimentos e logs de integração.

---

### 7. DevX (Experiência do Desenvolvedor)

- **Documentar scripts de desenvolvimento**
  - No `README`, explicar o uso de:
    - `composer dev` para subir servidor, Vite, filas e Reverb no ambiente local.
    - `composer queues` para orquestrar filas em outros ambientes.

- **Padronizar comandos de lint e testes**
  - Adicionar scripts no `composer.json` para:
    - `composer lint` → `vendor/bin/pint`.
    - `composer test` → `php artisan test --compact`.
  - Recomendar que sejam executados antes de cada commit/PR.

- **Melhorar configuração de seeds**
  - Documentar variáveis de ambiente necessárias para seeds (usuário admin inicial, loja padrão, chaves Omie).
  - Evitar valores reais/sensíveis em código versionado.

---

## Roadmap Sugerido (Alta Nível)

1. **Curto prazo (segurança e estabilidade)**
   - Remover credenciais sensíveis do `DatabaseSeeder`.
   - Endurecer webhook `/api/webhook` (validação, autenticação, idempotência).
   - Criar primeiros testes de feature para inventário e transferências.

2. **Médio prazo (arquitetura e qualidade de código)**
   - Extrair serviços de domínio e refatorar controllers mais complexos.
   - Centralizar integrações Omie, padronizar logging de integrações.
   - Introduzir Policies/middlewares para autorização.

3. **Longo prazo (UX e DX)**
   - Componentizar views Blade, organizar JS por domínio.
   - Definir estratégia de CSS (manter Bootstrap ou migrar gradualmente para Tailwind).
   - Ampliar cobertura de testes (serviços, jobs, cenários de erro) e fortalecer scripts de lint/test.

