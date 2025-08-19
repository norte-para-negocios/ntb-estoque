<?php

namespace App\Jobs;

use App\Models\Loja;
use App\Models\Webhook;
use App\Services\OrdemProducaoService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

class OmieWebhookJob implements ShouldQueue
{
    use Queueable;

    /**
     * Create a new job instance.
     */
    public function __construct(protected Loja $loja, protected array $receivedData)
    {
        //
    }

    /**
     * Execute the job.
     */
    public function handle(): void
    {
        try {
            $webhook = Webhook::updateOrCreate(
                [
                    'loja_id' => $this->loja->id,
                    'message_id' => $this->receivedData['messageId'],
                ],
                [
                    'message' => $this->receivedData['message']
                ]
            );
        } catch (\Exception $e) {
            Log::error('Failed to save webhook: ' . $e->getMessage(), [
                'loja_id' => $this->loja->id,
                'webhook_data' => $this->receivedData
            ]);
        }
    }
}
