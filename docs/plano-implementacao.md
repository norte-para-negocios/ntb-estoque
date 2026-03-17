## Plano de Implementação – Melhorias do Sistema de Estoque Omie

Documento complementar a `melhorias-sistema.md`, com foco no **como** implementar as melhorias propostas, organizado em fases.

---

## Fase 1 – Segurança, Estabilidade e Testes Mínimos

### 1.1. Higiene de credenciais e seeds ✅

- **Status**: concluído.
- **O que foi feito**:
  - `DatabaseSeeder` não contém mais qualquer dado sensível e apenas orquestra seeders estruturais (como `PermissaoSeeder`).
  - Seeds que criam permissões usam apenas constantes de domínio, sem chaves ou senhas reais.
  - `README.md` atualizado em português, documentando:
    - Uso de `.env` para credenciais (incluindo Omie).
    - Execução de migrações e seeds com segurança (`php artisan migrate`, `php artisan db:seed`).
    - Boas práticas para nunca commitar `.env` ou valores sensíveis no código.

### 1.2. Endurecer `/api/webhook`

- Criar um `FormRequest` específico para o webhook, com:
  - Regras de validação do payload (estrutura e campos obrigatórios).
  - Mensagens de erro claras.
- Implementar autenticação do webhook:
  - Token no header ou assinatura HMAC configurada via `.env`.
- Implementar idempotência:
  - Persistir um identificador único de evento e ignorar duplicatas.
- Padronizar respostas JSON:
  - Formato sugerido: `{ "success": bool, "message": string }`.
- Criar testes de *feature* cobrindo:
  - Chamada válida e autenticada.
  - Chamada inválida (payload ou autenticação).

### 1.3. Primeiros testes de domínio

- Adicionar scripts no `composer.json`:
  - `composer lint` → `vendor/bin/pint`.
  - `composer test` → `php artisan test --compact`.
- Criar testes de *feature* iniciais para Inventário:
  - Listar inventários.
  - Criar inventário (happy path simples).
- Criar um teste de unidade simples para um serviço isolado (ex.: parte do `OmieService`).

---

## Fase 2 – Refatoração de Arquitetura e Integrações

### 2.1. Extrair serviços de domínio dos controllers

- Escolher um fluxo central (ex.: Inventário) e:
  - Criar serviços como `FinalizarInventarioService`, `GerenciarItensInventarioService` (nomes ilustrativos).
  - Mover para esses serviços:
    - Regras de negócio.
    - Atualizações de modelos.
    - Disparo de Jobs/Eventos.
  - Reduzir o `InventarioController` a orquestrador (recebe request, chama serviço, retorna resposta).
- Repetir o padrão para:
  - Transferências.
  - Ordens de Produção.

### 2.2. Centralizar integrações Omie

- Mapear todos os pontos de chamada HTTP/Omie.
- Definir serviços de integração:
  - Ex.: `OmieInventarioService`, `OmieTransferenciaService`, `OmieOrdemProducaoService`.
- Em cada serviço:
  - Centralizar construção de payloads.
  - Padronizar tratamento de erros (incluindo rate limit).
  - Usar `IntegrationAttempt` para logar todas as tentativas.
- Substituir chamadas diretas nos controllers/jobs por chamadas aos novos serviços.

### 2.3. Encapsular filtros por loja e acesso a JSON

- Criar `scopes` nos modelos:
  - Ex.: `scopeDaLojaAtual`, `scopeAtivo`, etc.
- Criar accessors/casts para campos JSON (`full_object`) com métodos de domínio:
  - Ex.: `isConcluida()`, `getStatusOmieAttribute()`.
- Refatorar controllers:
  - Usar os `scopes` e métodos de domínio, evitando `where('loja_id', ...)` e `json_decode` espalhados.

---

## Fase 3 – Autorização, Validação e Consistência de Código

### 3.1. Migrar permissões para Policies/middlewares

- Criar Policies por recurso (ex.: `InventarioPolicy`, `TransferenciaPolicy`, `OrdemProducaoPolicy`).
- Mover lógica hoje em `CanService`/perfil nos controllers para Policies ou middlewares.
- Atualizar rotas/controllers para usar:
  - `->middleware('can:acao,modelo')`, ou
  - Chamadas explícitas a `authorize()`.

### 3.2. Padronizar validação com `FormRequest`

- Mapear actions que usam `$request->validate()`.
- Criar `FormRequest` específicos para cada fluxo:
  - Ex.: criação/edição de inventário, itens, transferências, etc.
- Atualizar controllers para usar esses `FormRequest` tipados.
- Criar testes de validação (Pest) com datasets para casos de erro.

### 3.3. Tipagem e limpeza de helpers

- Adicionar `return type hints` em:
  - Relacionamentos de modelos.
  - Métodos públicos de serviços.
  - Métodos públicos de controllers onde fizer sentido.
- Padronizar o uso de helpers (`auth()`, `Carbon`, etc.).
- Revisar `Helpers.php` e `Constants.php`:
  - Remover funções/constantes não utilizadas.
  - Manter apenas o que é realmente compartilhado.

---

## Fase 4 – Banco de Dados e Performance

### 4.1. Índices e normalização

- Revisar migrations com foco em colunas usadas em:
  - `whereBetween`, `where`, `whereHas` frequentes.
- Criar migrations de índices adicionais quando necessário:
  - Ex.: combinações de `(loja_id, data, status)` e similares.
- Avaliar necessidade de colunas normalizadas para campos críticos hoje armazenados em JSON.

### 4.2. Semântica de status e datas

- Mapear todos os `status` e campos de data relacionados a fluxo de negócio.
- Criar constantes ou enums centralizados para esses status.
- Revisar campos como `finalizado`:
  - Documentar exatamente o que representam.
  - Introduzir campos mais explícitos, se necessário (ex.: `is_finalizado`).

---

## Fase 5 – Frontend, UX e Organização do Código de Interface

### 5.1. Componentização Blade

- Identificar padrões comuns de UI (cards, filtros, botões).
- Criar componentes Blade reutilizáveis.
- Migrar telas de maior uso (inventário, transferências, ordens) para esses componentes.

### 5.2. Organização do JavaScript

- Criar arquivos JS por domínio em `resources/js` (ex.: `inventario.js`).
- Mover scripts inline das views para esses arquivos.
- Carregar via Vite e stacks Blade.

### 5.3. Estratégia de CSS

- Definir se o projeto seguirá com Bootstrap ou migrará gradualmente para Tailwind.
- Se mantiver Bootstrap:
  - Remover referências confusas a Tailwind.
- Se migrar para Tailwind:
  - Começar por novos componentes/telas.
  - Planejar refatoração gradual das telas críticas.

---

## Fase 6 – Cobertura de Testes Avançada e DX

### 6.1. Ampliar cobertura de testes

- Adicionar testes de *feature* completos para:
  - Fluxos de inventário.
  - Fluxos de transferência.
  - Principais operações de ordens de produção.
  - Webhook Omie.
- Adicionar testes de unidade para:
  - Serviços de integração Omie (com mocks de HTTP).
  - Serviços de posição de estoque e regras de cálculo.
- Usar datasets do Pest para cobrir múltiplos cenários de erro e sucesso.

### 6.2. Melhorar DX (Developer Experience)

- Documentar no `README`:
  - `composer dev`, `composer queues`, `composer lint`, `composer test`.
  - Checklist rápido antes de subir código (lint + testes relevantes).
- Se fizer sentido, configurar hooks de pré-commit para rodar Pint e um subconjunto de testes.

---

## Uso Prático do Plano

- Transformar cada seção de fase em épicas no seu sistema de gestão (Jira, GitHub Projects, etc.).
- Quebrar épicas em tarefas menores por módulo/tela.
- Seguir a ordem sugerida:
  1. Segurança + testes mínimos.
  2. Refatoração interna (arquitetura e integrações).
  3. Autorização/validação.
  4. Banco de dados/performance.
  5. Frontend/UX.
  6. Testes avançados + DX.

