<?php

namespace App\Jobs\UpdateOmieLocalData;

use App\Models\Loja;
use App\Services\PosicaoEstoqueService;
use Illuminate\Bus\Batchable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\Middleware\RateLimited;
use Illuminate\Queue\SerializesModels;

class PosicaoEstoqueUpdateJob implements ShouldQueue
{
    use Batchable, Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 15;

    public array|int $backoff = [10, 30, 60, 120];

    public function __construct(
        public Loja $loja,
        protected int $codigoLocalEstoque,
        protected string $dataPosicao,
        protected int $pagina
    ) {}

    public function middleware(): array
    {
        return [new RateLimited('omie-api')];
    }

    public function handle(): void
    {
        $service = new PosicaoEstoqueService($this->loja);
        $response = $service->fetchPage($this->codigoLocalEstoque, $this->dataPosicao, $this->pagina);

        if (! empty($response->produtos)) {
            $service->savePosicoes((array) $response->produtos, $this->dataPosicao);
        }
    }

    public function failed(\Throwable $exception)
    {
        // Logue a falha ou dispare alerta
        \Log::error("Job falhou na página {$this->pagina}: {$exception->getMessage()}");
    }
}
