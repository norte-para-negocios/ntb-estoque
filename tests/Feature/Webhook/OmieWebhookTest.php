<?php

use App\Jobs\OmieWebhookJob;
use App\Models\Loja;
use App\Models\Webhook;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;

uses(RefreshDatabase::class);

$webhookPayload = fn (Loja $loja, array $overrides = []) => array_merge([
    'messageId' => fake()->uuid(),
    'appKey' => $loja->omie_app_key,
    'topic' => 'Produto.Incluido',
    'event' => ['codigo_produto' => 12345],
], $overrides);

it('rejects webhook when loja not found', function () {
    Queue::fake();

    $this->postJson('/api/webhook', [
        'messageId' => fake()->uuid(),
        'appKey' => 'chave-inexistente',
        'topic' => 'Produto.Incluido',
        'event' => [],
    ])->assertSuccessful();

    Queue::assertNothingPushed();
});

it('processes webhook and dispatches job', function () use ($webhookPayload) {
    Queue::fake();

    $loja = Loja::factory()->create();

    $this->postJson('/api/webhook', $webhookPayload($loja))
        ->assertSuccessful()
        ->assertJson(['message' => 'Webhook received']);

    Queue::assertPushed(OmieWebhookJob::class);
});

it('returns 200 for duplicate messageId (idempotency)', function () use ($webhookPayload) {
    Queue::fake();

    $loja = Loja::factory()->create();
    $messageId = fake()->uuid();

    Webhook::factory()->create([
        'loja_id' => $loja->id,
        'message_id' => $messageId,
    ]);

    $this->postJson('/api/webhook', $webhookPayload($loja, ['messageId' => $messageId]))
        ->assertSuccessful()
        ->assertJson(['message' => 'Webhook already processed']);

    Queue::assertNothingPushed();
});

it('does not dispatch job for Produto.AjusteEstoque topic', function () use ($webhookPayload) {
    Queue::fake();

    $loja = Loja::factory()->create();

    $this->postJson('/api/webhook', $webhookPayload($loja, ['topic' => 'Produto.AjusteEstoque']))
        ->assertSuccessful();

    Queue::assertNothingPushed();
});

it('does not dispatch job for Produto.MovimentacaoEstoque topic', function () use ($webhookPayload) {
    Queue::fake();

    $loja = Loja::factory()->create();

    $this->postJson('/api/webhook', $webhookPayload($loja, ['topic' => 'Produto.MovimentacaoEstoque']))
        ->assertSuccessful();

    Queue::assertNothingPushed();
});

it('has throttle:60,1 declared in the api routes file', function () {
    $routesFile = file_get_contents(base_path('routes/api.php'));

    expect($routesFile)->toContain('throttle:60,1');
});
