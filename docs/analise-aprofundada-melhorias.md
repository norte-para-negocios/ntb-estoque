# Análise Aprofundada — Sistema de Estoque Omie

Documento de segunda revisão técnica, com foco em problemas concretos encontrados no código que não constam em `melhorias-sistema.md` ou `plano-implementacao.md`. Cada item aponta arquivo, linha e impacto real.

---

## Resumo de Prioridades

| Severidade | Total de Itens |
|-----------|---------------|
| Crítico   | 6             |
| Alto      | 9             |
| Médio     | 10            |
| Baixo     | 5             |

---

## 1. Integração com a API Omie — Problemas na Infraestrutura

### 1.1 [CRÍTICO] Jobs bypassam toda a infraestrutura de rate limiting e circuit breaker

**Arquivos:** `app/Jobs/InventarioJob.php:190`, `app/Jobs/TransferJob.php:180`, `app/Jobs/TransferenciaJob.php:87`

O `OmieService` foi construído com circuit breaker, rate limiting e locks — mas os três jobs principais **não usam o `OmieService`**: fazem chamadas HTTP diretamente com `Http::post(...)`. Toda aquela sofisticação é ignorada na prática.

```php
// InventarioJob::createAjuste — linha 190
$response = Http::withHeaders([...])->connectTimeout(60)->timeout(60)->post($url, $data);
// ↑ Sem circuit breaker, sem rate limiting, sem lock de concorrência
```

O `OmieService` expõe apenas `excluirAjusteEstoque()`. Não existe método público `incluirAjusteEstoque()` — o método mais crítico do sistema.

**Impacto:** qualquer proteção contra sobrecarga da API Omie é ineficaz para o fluxo principal. Em produção, múltiplos workers processando inventários simultâneos podem disparar dezenas de requisições sem controle.

**Solução:** Implementar `incluirAjusteEstoque()` no `OmieService` e substituir as chamadas diretas nos jobs.

---

### 1.2 [CRÍTICO] `request()->ip()` dentro do OmieService falha em Jobs de fila

**Arquivo:** `app/Services/OmieService.php:57`

```php
$ip = request()->ip() ?? '0.0.0.0';
```

Em contexto de Job (sem request HTTP), `request()->ip()` retorna `null`. O fallback `0.0.0.0` faz com que **todas as lojas e todos os jobs compartilhem a mesma chave de rate limit por IP**, tornando o controle por IP completamente ineficaz — ou pior, fazendo com que uma loja consuma o limite da outra.

**Impacto:** as constantes `RATE_LIMIT_IP_PER_MINUTE` (960) e `RATE_LIMIT_IP_APPKEY_METHOD_PER_MINUTE` (240) perdem o sentido.

**Solução:** Em contexto de Job, usar o IP real da máquina ou remover o agrupamento por IP, substituindo por uma chave baseada apenas em `app_key`:

```php
$ip = app()->runningInConsole() 
    ? gethostbyname(gethostname()) 
    : (request()->ip() ?? '0.0.0.0');
```

---

### 1.3 [CRÍTICO] `sleep()` executado enquanto mantém um lock exclusivo

**Arquivo:** `app/Services/OmieService.php:127`

```php
// Dentro do bloco $lock->block(30, function () { ... })
if ($response->status() === 425) {
    $waitSeconds = (int) $matches[1];
    sleep($waitSeconds);  // ← segura o lock enquanto dorme
}
```

O `sleep()` é chamado **dentro** do closure que detém o lock. O lock tem TTL de 60 segundos (`Cache::lock($lockKey, 60)`). Se a API retornar 425 pedindo espera de mais de 60s, o lock expira, outro processo pode adquiri-lo, e o processo original ainda está dormindo.

Além disso, bloquear o worker por `sleep` significa que nenhuma outra operação daquele worker avança durante a espera.

**Solução:** Lançar uma exception específica de rate-limit dentro do lock, capturá-la fora, e re-despachar o job com delay via `->delay(now()->addSeconds($waitSeconds))`.

---

### 1.4 [ALTO] Retry recursivo sem limite de profundidade em `InventarioJob`

**Arquivo:** `app/Jobs/InventarioJob.php:200-209`

```php
} elseif ($response->status() === 429) {
    sleep(60);
    return $this->createAjuste($inventarioItem);  // ← recursão sem controle
} elseif ($response->status() === 425) {
    sleep(60);
    return $this->createAjuste($inventarioItem);  // ← recursão sem controle
}
```

Sem contador de profundidade, um inventário com muitos produtos em rate limit pode gerar uma stack cada vez mais profunda. O `timeout` de 300s do job pode não ser suficiente para perceber o problema.

`TransferJob` não trata 425/429 — falha silenciosamente para esses casos.

**Solução:** Usar uma variável de controle `$retries` ou re-despachar o job com delay em vez de recursão:

```php
if ($response->status() === 429 || $response->status() === 425) {
    // Re-enfileirar ao invés de bloquear o worker
    static::dispatch($this->inventario, $this->user)
        ->delay(now()->addSeconds(65));
    return null;
}
```

---

### 1.5 [ALTO] Circuit breaker permite múltiplas requisições em estado HALF_OPEN

**Arquivo:** `app/Services/CircuitBreakerService.php:40-42`

```php
// Half-open: permite uma tentativa
return true;
```

O estado `HALF_OPEN` está conceitualmente correto — deve permitir **uma** requisição de teste. Mas o código retorna `true` para qualquer verificação de `isAvailable()` enquanto estiver em HALF_OPEN. Com múltiplos workers verificando ao mesmo tempo, todos recebem `true` e todas as requisições passam simultaneamente.

**Solução:** Em HALF_OPEN, usar um lock atômico que permita apenas a primeira verificação:

```php
if ($state === self::STATE_HALF_OPEN) {
    $lock = Cache::lock("circuit_breaker:{$this->key}:probe_lock", $this->recoverySeconds);
    return $lock->get();  // só o primeiro worker consegue o lock
}
```

---

### 1.6 [ALTO] `omie_app_key` armazenada em texto plano no banco de dados

**Arquivo:** `app/Models/Loja.php:50`

```php
protected function casts(): array
{
    return [
        // 'omie_app_key' => 'encrypted',  // ← COMENTADO
        'omie_app_secret' => 'encrypted',
```

`omie_app_secret` é corretamente encriptado, mas `omie_app_key` não. A `app_key` funciona como identificador público mas ainda é uma credencial. Ela aparece em:
- Queries logadas (query log do banco, slow query log)
- Backups de banco em texto plano
- Debug output de models (`dd($loja)`, logs com contexto de model)
- Resposta do webhook: o controller busca a loja por `omie_app_key` recebida no request, que ficou exposta

O endpoint de webhook usa `omie_app_key` como **único fator de autenticação**, tornando sua exposição um risco direto de injeção de webhooks falsos.

**Solução imediata:** descomentar `'omie_app_key' => 'encrypted'`. **Solução complementar:** implementar validação por HMAC ou token secreto separado para autenticar webhooks, não depender do `app_key`.

---

## 2. Jobs e Filas — Problemas de Confiabilidade

### 2.1 [CRÍTICO] `TransferenciaJob` modifica o model no constructor

**Arquivo:** `app/Jobs/TransferenciaJob.php:26-27`

```php
public function __construct(protected User $user, protected Movimento $movimento)
{
    $this->movimento->status = MovimentoStatus::Processando;
    $this->movimento->save();  // ← executado ao criar o job, não ao processá-lo
}
```

O constructor de um Job é executado **quando o job é criado/serializado**, antes de ser enfileirado. Em qualquer situação em que o job falhe ao ser enfileirado (fila cheia, erro de serialização, banco indisponível), o `Movimento` já terá sido marcado como `Processando` sem nunca ser de fato processado — ficando preso nesse status indefinidamente.

**Solução:** Mover a mutação do model para dentro de `handle()`.

---

### 2.2 [ALTO] `TransferJob` processa no máximo 3 iterações, independente do volume

**Arquivo:** `app/Jobs/TransferJob.php:65`

```php
for ($i = 0; $i < 3; $i++) {
    $movimentos = Movimento::where('transferencia_id', ...)
        ->where(function ($q) { /* status pendente */ })
        ->get();
    foreach ($movimentos as $movimento) { ... }
}
```

O loop fixo de 3 iterações significa que, em uma transferência com muitos produtos ou em situações onde o rate limit da Omie atrasa o processamento, os movimentos restantes ficam com status `Iniciado` indefinidamente sem retentativa automática. O `InventarioJob` usa `while(...->count() > 0)` que é mais robusto, mas também não tem limite de iterações (risco de loop infinito).

**Solução:** Usar `while` com um limite máximo e uma condição de saída por timeout, ou quebrar o processamento em jobs menores por lote.

---

### 2.3 [ALTO] N+1 queries em jobs de processamento de itens

**Arquivo:** `app/Jobs/InventarioJob.php:71-141`, `app/Jobs/TransferJob.php:66-132`

Em cada iteração do loop:
- `PosicaoEstoque::where(...)->first()` — 1 query por item
- `Produto::where('loja_id', ...)->where('codigo_produto', ...)->first()` — 1 query por item (linha 125/115)
- `$inventarioItem->inventario->loja` (dentro de `createAjuste`) — N queries por item

Para um inventário com 200 produtos: ~600 queries de banco antes das chamadas à API.

Adicionalmente, a variável `$produto` é consultada no loop mas **não é usada** após ser atribuída — código morto que gera queries desnecessárias:

```php
// InventarioJob, linha 125 — $produto é consultado mas não usado no fluxo
$produto = Produto::where('loja_id', ...)->where('codigo_produto', ...)->first();
// A única referência ao $produto é na mensagem de broadcast, mas $inventarioItem->produto
// já está disponível via relacionamento
```

**Solução:** Eager loading ao carregar os itens, e remover consultas de `$produto` redundantes usando o relacionamento já disponível em `$inventarioItem->produto`.

---

### 2.4 [ALTO] Jobs sem configuração de `$tries` e `$backoff`

**Arquivos:** `app/Jobs/InventarioJob.php:28`, `app/Jobs/TransferJob.php:29`, `app/Jobs/TransferenciaJob.php`

Nenhum dos jobs define `$tries`, `$backoff` ou `retryUntil()`. O padrão do Laravel é 1 tentativa (ou o valor configurado em queue), sem backoff exponencial. Falhas transitórias (timeout de rede, indisponibilidade momentânea da Omie) matam o job permanentemente.

```php
class InventarioJob implements ShouldQueue
{
    public $timeout = 300;
    // ↑ Sem $tries, $backoff, maxExceptions ou retryUntil
```

**Solução:**
```php
public $tries = 3;
public $backoff = [30, 120, 300];  // 30s, 2min, 5min

public function retryUntil(): \DateTime
{
    return now()->addHours(4);
}
```

---

### 2.5 [MÉDIO] `OmieWebhookJob` não tem lógica além de salvar o Webhook

**Arquivo:** `app/Jobs/OmieWebhookJob.php:27-45`

O job dispatchado pelo controller apenas salva o registro na tabela `webhooks`. Todo o processamento real (sincronizar produto, nota fiscal, ordem de produção, local de estoque) acontece no `booted()` do model `Webhook` via `static::created`. Isso significa:

1. Se o `created` do model lançar uma exception, ela é capturada pelo try/catch do job mas o job é marcado como **concluído** (sem erro do job em si).
2. O processamento de webhook acontece **sincronamente** dentro do job, sem possibilidade de paralelismo ou retentativa por tipo de evento.
3. Serviços são instanciados manualmente com `new LocalEstoqueService($webhook->loja)` — viola injeção de dependência e dificulta testes.

**Solução:** Mover a lógica do `booted()` para dentro do `OmieWebhookJob::handle()`, com try/catch por tipo de evento e logs específicos por falha.

---

### 2.6 [MÉDIO] Falta de Dead Letter Queue (DLQ) e alertas de falha

**Arquivo:** `config/queue.php`

Jobs que falham definitivamente vão para `failed_jobs` mas não há nenhum listener para `Illuminate\Queue\Events\JobFailed`. Falhas críticas (como um inventário que nunca foi processado) ficam silenciosas no banco.

**Solução:** Implementar um listener que notifique via Slack/email/broadcast quando um job crítico falhar definitivamente:

```php
// app/Providers/AppServiceProvider.php
Queue::failing(function (JobFailed $event) {
    if (in_array($event->job->getName(), ['InventarioJob', 'TransferJob'])) {
        // Notificar responsável
    }
});
```

---

## 3. Webhook — Segurança e Confiabilidade

### 3.1 [CRÍTICO] Webhook sem autenticação real — `omie_app_key` como único critério

**Arquivo:** `app/Http/Controllers/API/OmieWebhookController.php:17`

```php
if ($request->has('messageId') && $request->has('appKey') 
    && ($loja = Loja::where('omie_app_key', $request->appKey)->first())) {
```

Qualquer pessoa que conheça o `app_key` de uma loja pode enviar um webhook falso e disparar sincronizações indevidas de produtos, notas fiscais ou ordens de produção. O `app_key` é enviado em texto claro em toda requisição e pode estar exposto em logs.

Adicionalmente, quando a loja não é encontrada ou o payload é inválido, o controller não retorna resposta — o Laravel retorna `null` implicitamente, que é convertido a uma resposta vazia com status 200. A Omie pode reenviar o webhook indefinidamente.

**Solução:** 
- Adicionar um campo `omie_webhook_secret` na tabela `lojas` e validar HMAC no header.
- Garantir que o controller sempre retorne uma resposta JSON com status apropriado.

---

### 3.2 [ALTO] Idempotência do webhook verifica antes do job executar

**Arquivo:** `app/Http/Controllers/API/OmieWebhookController.php:18-19`

```php
if (Webhook::where('loja_id', $loja->id)->where('message_id', $request->messageId)->exists()) {
    return response()->json(['status' => 'success', 'message' => 'Webhook already processed'], 200);
}
// ↑ O Webhook ainda NÃO existe — só será criado quando o job rodar
```

A verificação de idempotência checa se o `Webhook` já existe, mas ele só é criado dentro do `OmieWebhookJob`. Entre o request chegar e o job rodar, o mesmo webhook pode chegar novamente e passar pela verificação. O `updateOrCreate` no job evita duplicata no banco, mas **dois jobs podem rodar em paralelo** — e o `booted().created` só dispara para o primeiro, porém há uma janela de vulnerabilidade.

**Solução:** Criar o registro do webhook **antes** de despachar o job (no controller), com status "pendente", e usar o job apenas para processar. Assim a idempotência é garantida na camada HTTP.

---

### 3.3 [MÉDIO] Webhook descarta silenciosamente tópicos de ajuste e movimentação de estoque

**Arquivo:** `app/Http/Controllers/API/OmieWebhookController.php:24-33`

```php
if (
    (stripos($message['topic'], 'Produto.AjusteEstoque') === false) &&
    (stripos($message['topic'], 'Produto.MovimentacaoEstoque') === false)
) {
    dispatch(new OmieWebhookJob(...));
}
// ↑ Sem else — AjusteEstoque e MovimentacaoEstoque são descartados sem log
```

Quando esses tópicos chegam, o sistema retorna `success` mas não processa nem registra o evento. Se alguém precisar investigar discrepâncias de estoque, não haverá rastreabilidade de que esses webhooks chegaram.

Complementarmente, no `Webhook::booted()` há código comentado para `AjusteEstoque` e `MovimentacaoEstoque` — há uma decisão arquitetural pendente que não está documentada.

**Solução:** Registrar sempre todos os webhooks recebidos (mesmo os descartados), com campo `processado: false`, para fins de auditoria.

---

## 4. Qualidade de Código — Bugs Concretos

### 4.1 [CRÍTICO] Acesso a `$response` indefinida no catch de `InventarioJob`

**Arquivo:** `app/Jobs/InventarioJob.php:228-230`

```php
try {
    $response = Http::withHeaders([...])->post($url, $data);
    // ...
} catch (Throwable $th) {
    $inventarioItem->status = InventarioItemStatus::Erro;
    $inventarioItem->response = $response->body();       // ← $response pode não existir
    $inventarioItem->descricao_status = $response->body(); // ← idem
    $inventarioItem->save();
```

Se a exception for lançada **antes** de `$response = Http::post(...)` (por exemplo, uma `ConnectionException` ou timeout), `$response` será `undefined`. O PHP 8 lança `TypeError` ao tentar chamar `->body()` em `undefined`.

Resultado: o catch que deveria registrar o erro **gera um segundo erro**, e o `$inventarioItem` não é salvo corretamente.

**Solução:**
```php
$response = null;
try {
    $response = Http::post($url, $data);
} catch (Throwable $th) {
    $inventarioItem->response = $th->getMessage();
    $inventarioItem->descricao_status = 'Erro de conexão: ' . $th->getMessage();
}
```

---

### 4.2 [ALTO] Lógica invertida na condição de `createAjuste` em `TransferJob`

**Arquivo:** `app/Jobs/TransferJob.php:143`

```php
if (($movimento->quan >= 0)
    && (in_array(! $movimento->status, [null, MovimentoStatus::Erro]))  // ← lógica invertida
    && ($movimento->id_ajuste === null)
    && $movimento->valor > 0
) {
```

`! $movimento->status` nega o valor do status antes de passar para `in_array`. Isso significa que a condição verifica se `false` (ou `true`) está no array, não o status em si. O comportamento real é imprevisível.

Compare com `InventarioJob:153-156` que usa a lógica correta:
```php
&& (! in_array($inventarioItem->status, [InventarioItemStatus::Erro, InventarioItemStatus::SemCmc]))
```

**Impacto:** movimentos podem ser processados quando não deveriam, ou ignorados quando deveriam ser processados.

---

### 4.3 [ALTO] `IntegrationAttemptsTrait` — `model_id` nunca é populado

**Arquivo:** `app/Services/IntegrationAttemptsTrait.php:17`

```php
private $model_id;  // ← declarado mas nunca setado em nenhum lugar
```

Em `beforeAttemptLog()`, `model_id` não é incluído no `IntegrationAttempt`. Sem o ID do modelo relacionado, é impossível associar um log de integração a um `InventarioItem` ou `Movimento` específico em investigações.

Ao investigar "por que o item 1234 do inventário 567 falhou?", o log só mostra que um `InventarioItem` falhou — sem saber qual.

---

### 4.4 [MÉDIO] `TransferJob` loga modelo errado no `IntegrationAttempt`

**Arquivo:** `app/Jobs/TransferJob.php:174`

```php
$this->model = 'InventarioItem';  // ← Deveria ser 'Movimento'
```

Logs de transferência são registrados com `model = 'InventarioItem'`, misturando logs de inventário e transferência na mesma categoria.

---

### 4.5 [MÉDIO] Acesso a `json_decode()` sem verificação de null

**Arquivo:** `app/Jobs/InventarioJob.php:81`

```php
} elseif (json_decode($inventarioItem->produto->full_object)->inativo === 'S') {
```

Se `full_object` for `null` ou JSON inválido, `json_decode()` retorna `null` e o acesso a `->inativo` lança um `TypeError`. O relacionamento `$inventarioItem->produto` também pode ser `null` se o produto foi excluído.

---

### 4.6 [MÉDIO] `TransferenciaJob` usa valor `0.01` como magic number

**Arquivo:** `app/Jobs/TransferenciaJob.php:71`

```php
'valor' => $movimento->valor == 0 ? 0.01 : $movimento->valor,
```

Um valor de custo de `0.01` é enviado para a Omie quando o valor real é 0. Isso pode criar inconsistências contábeis. Não há comentário explicando por que `0.01` e não `0` ou outro valor. Provavelmente um workaround para evitar rejeição da API.

**Ação:** Documentar o comportamento esperado da Omie para `valor = 0` e avaliar se o workaround é adequado ou se o movimento deveria ser marcado como `SemCmc`.

---

## 5. Multi-tenancy — Isolamento de Dados por Loja

### 5.1 [ALTO] Nenhum mecanismo garante isolamento automático por loja

Todos os controllers filtram manualmente por `loja_id`:

```php
Inventario::where('loja_id', Auth::user()->current_loja_id)->...
```

Não há Global Scope, Policy, ou middleware que garanta o isolamento. Um único endpoint esquecido de adicionar o `where('loja_id', ...)` expõe dados de todas as lojas.

Casos de risco concreto encontrados:
- `IntegrationAttemptController` — verificar se lista apenas tentativas da loja atual.
- Qualquer rota futura criada sem o filtro manual.

**Solução:** Implementar um `LojaScope` como Global Scope nos models sensíveis (`Inventario`, `Transferencia`, `Movimento`, `PosicaoEstoque`, `NotaFiscal`, `OrdemProducao`, `LocalEstoque`, `Produto`, `Webhook`).

---

### 5.2 [MÉDIO] `current_loja_id` nunca validado contra lojas do usuário

O middleware `CheckCurrentLoja` verifica se o usuário tem uma loja atual definida, mas não verifica se o usuário pertence à loja em `current_loja_id`. Um usuário poderia alterar seu `current_loja_id` para uma loja à qual não pertence e potencialmente acessar dados dela (dependendo de como os filtros são aplicados).

---

## 6. Performance

### 6.1 [ALTO] `TransferJob` consulta `Loja::find()` em loop de espera por posição de estoque

**Arquivo:** `app/Jobs/TransferJob.php:56-63`

```php
while (Loja::find($this->transferencia->loja_id)->posicao_estoque_status !== SincronizacaoStatus::Concluido) {
    $esperaPosicao += 1;
    sleep(1);
    if ($esperaPosicao >= 30) { break; }
}
```

A cada segundo, executa um `SELECT * FROM lojas WHERE id = ?`. Em 30 segundos de espera: 30 queries desnecessárias. Usar `->refresh()` no model já carregado seria mais eficiente e semanticamente correto.

Além disso, o `InventarioJob` tinha esse mesmo loop comentado — indicando incerteza sobre quando aguardar posição de estoque.

---

### 6.2 [MÉDIO] Sem paginação/chunking em jobs com grande volume

Jobs carregam todos os itens/movimentos pendentes de uma vez com `->get()`. Para inventários com centenas de produtos, isso carrega toda a coleção em memória.

**Solução:** Usar `->chunk(50, ...)` ou `->lazy()` para processar em lotes.

---

## 7. Arquitetura de Serviços

### 7.1 [ALTO] Três implementações paralelas de `IncluirAjusteEstoque`

O mesmo endpoint da Omie é chamado de três lugares distintos com implementações ligeiramente diferentes:

| Arquivo | cod_int_ajuste | Tratamento 425/429 | Usa OmieService |
|---------|---------------|-------------------|-----------------|
| `InventarioJob::createAjuste` | `'ITEM' . $id` | Sim (recursivo) | Não |
| `TransferJob::createAjuste` | `'MOV-' . $id` | Não | Não |
| `TransferenciaJob::createTransferencia` | `'MOV-' . $id` | Não | Não |

Mudanças na API da Omie precisam ser aplicadas em três lugares. Divergências de comportamento (tratamento de 425, formato de `cod_int_ajuste`) já existem entre `InventarioJob` e `TransferJob`.

---

### 7.2 [MÉDIO] Lógica de negócio no `booted()` do Model `Webhook`

**Arquivo:** `app/Models/Webhook.php:33-83`

O `static::created` do `Webhook` contém 50 linhas de lógica de negócio que instanciam e chamam serviços diretamente. Isso viola o princípio de que models devem representar dados, não executar lógica de aplicação.

Consequências práticas:
- Testes de feature que salvam um `Webhook` disparam efeitos colaterais inesperados.
- Não é possível criar um `Webhook` em seeds/factories sem acionar sincronizações.
- A `WebhookFactory` precisará de mocks ou tratamento especial para testes.

---

### 7.3 [BAIXO] `OmieService::makeRequest` é `private` mas poderia ser `protected`

**Arquivo:** `app/Services/OmieService.php:55`

Se futuramente um serviço estender `OmieService` para adicionar métodos específicos de domínio, `makeRequest` não estará acessível. Hoje não é um problema, mas é uma limitação de extensibilidade.

---

## 8. Logging e Observabilidade

### 8.1 [MÉDIO] Log com response body completo pode gerar entradas gigantes

**Arquivo:** `app/Services/OmieService.php:135-141`

```php
Log::warning('Falha na requisição à API Omie', [
    'response' => $this->response,  // ← body completo, pode ter KBs de HTML de erro
    'context' => $context,
]);
```

A Omie pode retornar páginas HTML de erro com centenas de KB. Logar o body completo pode saturar arquivos de log rapidamente.

**Solução:** Truncar o response no log: `'response' => substr($this->response, 0, 500)`.

---

### 8.2 [BAIXO] Ausência de canal de log dedicado para integrações Omie

Todos os logs da Omie vão para o canal padrão (`daily`), misturados com logs da aplicação. Não é possível configurar retenção diferenciada ou alertas específicos para falhas de integração.

**Solução:** Criar um canal `omie` em `config/logging.php` e usar `Log::channel('omie')->warning(...)`.

---

### 8.3 [BAIXO] `IntegrationAttempt` sem índice em `loja_id` e `created_at`

A tabela `integration_attempts` cresce rapidamente (toda operação gera registros). Consultas na tela de auditoria que filtram por loja e período serão lentas sem índices adequados.

---

## 9. Configuração e Ambiente

### 9.1 [MÉDIO] Throttle do webhook (`60,1`) pode ser insuficiente ou excessivo

**Arquivo:** `routes/api.php:8`

```php
->middleware('throttle:60,1');
```

60 requisições por minuto por IP. A Omie pode enviar webhooks em burst para múltiplos eventos simultâneos. Se o servidor estiver atrás de um proxy/load balancer, todos os webhooks podem vir do mesmo IP (o do proxy), disparando throttle. 

Adicionalmente, o throttle usa cache por IP, e se o IP do servidor da Omie mudar (CDN, balanceamento), o limite é "resetado".

**Solução:** Avaliar se o throttle deve ser por `app_key` da loja em vez de IP.

---

### 9.2 [BAIXO] `Webhook::prunable()` remove registros após 7 dias sem considerar não-processados

**Arquivo:** `app/Models/Webhook.php:21-23`

```php
public function prunable(): Builder
{
    return static::where('created_at', '<=', now()->subDays(7));
}
```

Webhooks que falharam ao ser processados (e que poderiam ser reprocessados manualmente) são removidos junto com os processados com sucesso após 7 dias.

**Solução:** Adicionar condição para manter registros com erro por mais tempo, ou adicionar campo `processed_at` e só prunar os processados.

---

## 10. Casos Especiais e Comportamentos Não Documentados

### 10.1 [BAIXO] Comportamento do erro SOAP `Client-1035` não está documentado

**Arquivos:** `app/Jobs/InventarioJob.php:210-219`, `app/Jobs/TransferJob.php:190-199`

```php
} elseif ($response->status() === 500 
    && stripos($response->object()->faultcode, 'SOAP-ENV:Client-1035') !== false) {
    preg_match('/com o ID \[(\d+)\]/', $response->object()->faultstring, $matches);
    $idAjuste = isset($matches[1]) ? $matches[1] : '';
    $obj = new stdClass;
    $obj->codigo_status = '0';
    $obj->descricao_status = 'Ajuste realizado';
    $obj->id_movest = '';
    $obj->id_ajuste = $idAjuste;
    return $obj;
```

Esse tratamento especial indica que a Omie retorna HTTP 500 quando um ajuste com o mesmo `cod_int_ajuste` já existe, mas inclui o ID do ajuste existente na mensagem de erro. O código extrai esse ID para considerar o ajuste como bem-sucedido.

Esse comportamento é crítico para idempotência, mas não está documentado em nenhum lugar. Se a Omie mudar o formato da mensagem de erro, o regex quebra silenciosamente e o `$idAjuste` fica vazio.

**Ação:** Documentar esse comportamento e adicionar um teste específico para ele. Considerar adicionar log explícito quando esse caminho é percorrido.

---

### 10.2 [BAIXO] Código comentado com lógica relevante em `Webhook::booted()`

**Arquivo:** `app/Models/Webhook.php:44-57`

Há código comentado para atualizar posição de estoque quando chega `Produto.MovimentacaoEstoque` ou `Produto.AjusteEstoque`. Os comentários indicam incerteza sobre o que fazer, mas a decisão final não está registrada.

Se esses tópicos forem relevantes para manter o estoque atualizado em tempo real (sem aguardar sync agendado), a ausência de processamento pode causar discrepâncias que só são corrigidas no próximo ciclo de sincronização.

---

## Roadmap Complementar ao `plano-implementacao.md`

Itens novos que devem ser incorporados ao plano existente:

### Urgente (antes da próxima iteração)
1. **Mover mutação de model do constructor para `handle()` em `TransferenciaJob`** — bug ativo em produção.
2. **Corrigir `$response` indefinida no catch do `InventarioJob`** — bug ativo.
3. **Corrigir lógica invertida em `TransferJob::createAjuste`** — comportamento incorreto.
4. **Desencriptar `omie_app_key`** — credencial exposta.

### Alta Prioridade
5. **Implementar `incluirAjusteEstoque()` no `OmieService`** e unificar as três implementações paralelas.
6. **Corrigir uso de `request()->ip()` em contexto de Job**.
7. **Adicionar `$tries`, `$backoff` e `retryUntil()` em todos os Jobs**.
8. **Implementar autenticação real no webhook** (campo secreto separado + validação).
9. **Garantir que webhook retorne resposta em todos os caminhos** do controller.
10. **Mover lógica do `Webhook::booted()` para o Job**.

### Média Prioridade
11. **Resolver `sleep()` dentro de lock** no `OmieService`.
12. **Corrigir HALF_OPEN para permitir apenas uma requisição de teste** no CircuitBreaker.
13. **Implementar `model_id` no `IntegrationAttemptsTrait`**.
14. **Corrigir nome do model em `TransferJob`** (`'InventarioItem'` → `'Movimento'`).
15. **Adicionar listener para `JobFailed`** em jobs críticos.
16. **Documentar o comportamento do erro SOAP `Client-1035`** e adicionar teste.

---

*Documento gerado em 2026-04-01. Complementa `melhorias-sistema.md` e `plano-implementacao.md`.*
