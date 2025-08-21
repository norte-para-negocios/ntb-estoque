<?php

namespace App\Jobs\UpdateOmieLocalData;

use App\Models\Loja;
use App\Services\OrdemProducaoService;
use Illuminate\Bus\Batchable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class OrdemProducaoUpdateJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels, Batchable;

    // Tentativas antes de falhar de vez
    public int $tries = 5;

    public array|int $backoff = [10, 30, 60, 120];

    public function __construct(
        protected Loja $loja,
        protected int  $pagina
    )
    {
    }

    public function handle(): void
    {
        $service = new OrdemProducaoService($this->loja);
        $response = $service->fetchPage($this->pagina);

        if (!empty($response->cadastros)) {
            $service->saveOrdensProducao((array)$response->cadastros);
        }
    }

    public function failed(\Throwable $exception)
    {
        // Logue a falha ou dispare alerta
        \Log::error("Job falhou na página {$this->pagina}: {$exception->getMessage()}");
    }

}
