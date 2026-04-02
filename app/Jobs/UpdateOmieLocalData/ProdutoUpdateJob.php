<?php

namespace App\Jobs\UpdateOmieLocalData;

use App\Models\Loja;
use App\Services\ProdutoService;
use Illuminate\Bus\Batchable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\Middleware\RateLimited;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Queue\SerializesModels;

class ProdutoUpdateJob implements ShouldQueue
{
    use Batchable, Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 15;

    public array|int $backoff = [10, 30, 60, 120];

    public function __construct(
        public Loja $loja,
        protected int $pagina
    ) {}

    public function middleware(): array
    {
        return [
            new RateLimited('omie-api'),
            (new WithoutOverlapping($this->loja->id))->releaseAfter(10),
        ];
    }

    public function handle(): void
    {
        $service = new ProdutoService($this->loja);
        $response = $service->fetchPage($this->pagina);

        if (! empty($response->produto_servico_cadastro)) {
            $service->saveProdutos((array) $response->produto_servico_cadastro);
        }
    }

    public function failed(\Throwable $exception)
    {
        // Logue a falha ou dispare alerta
        \Log::error("Job falhou na página {$this->pagina}: {$exception->getMessage()}");
    }
}
