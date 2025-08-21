<?php

namespace App\Jobs\UpdateOmieLocalData;

use App\Models\Loja;
use App\Services\NotaFiscalService;
use Illuminate\Bus\Batchable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class NotaFiscalUpdateJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels, Batchable;

    public int $tries = 5;

    public array|int $backoff = [10, 30, 60, 120];

    public function __construct(
        protected Loja $loja,
        protected int  $pagina,
        protected string  $dataIni,
        protected string  $dataFim
    )
    {
    }

    public function handle(): void
    {
        $service = new NotaFiscalService($this->loja);
        $response = $service->fetchPage($this->pagina, $dataIni = '', $dataFim = '');
        if (!empty($response->recebimentos)) {
            $service->saveNotasFiscais((array)$response->recebimentos);
        }
    }

    public function failed(\Throwable $exception)
    {
        // Logue a falha ou dispare alerta
        \Log::error("Job falhou na página {$this->pagina}: {$exception->getMessage()}");
    }

}
