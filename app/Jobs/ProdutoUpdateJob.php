<?php

namespace App\Jobs;

use App\Models\Loja;
use App\Services\ProdutoService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class ProdutoUpdateJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    // Tentativas antes de falhar de vez
    public int $tries = 5;

    // Intervalos em segundos para cada retry
    public array|int $backoff = [10, 30, 60, 120];

    public function __construct(
        protected Loja $loja,
        protected int  $pagina
    )
    {
    }

    public function handle(): void
    {
        $service = new ProdutoService($this->loja);
        $response = $service->fetchPage($this->pagina);

        if (!empty($response->produto_servico_cadastro)) {
            $service->saveProdutos((array)$response->produto_servico_cadastro);
        }
    }

    public function failed(\Throwable $exception)
    {
        // Logue a falha ou dispare alerta
        \Log::error("Job falhou na página {$this->pagina}: {$exception->getMessage()}");
    }

}
