<?php

namespace App\Jobs;

use App\Models\Loja;
use App\Models\Webhook;
use App\Services\OrdemProducaoService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

class ProdutoWebhookJob implements ShouldQueue
{
    use Queueable;

    protected OrdemProducaoService $ordemProducaoService;

    /**
     * Create a new job instance.
     */
    public function __construct(protected Loja $loja, protected array $receivedData)
    {
        $this->ordemProducaoService = new OrdemProducaoService($loja);
    }

    /**
     * Execute the job.
     */
    public function handle(): void
    {
        try {
            $webhook = Webhook::firstOrCreate([
                'loja_id' => $this->loja->id,
                'message_id' => $this->receivedData['messageId']
            ], [
                'message' => $this->receivedData['message']
            ]);
            $this->ordemProducaoService->webhook($webhook->message);
        } catch (\Exception $e) {
            Log::error('Failed to save webhook: ' . $e->getMessage(), [
                'loja_id' => $this->loja->id,
                'webhook_data' => $webhook
            ]);
        }
    }
}
