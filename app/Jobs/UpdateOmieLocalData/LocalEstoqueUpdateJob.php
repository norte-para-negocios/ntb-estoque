<?php

namespace App\Jobs\UpdateOmieLocalData;

use App\Events\NotificaAllEvent;
use App\Events\NotificaUserEvent;
use App\Models\Loja;
use App\Services\LocalEstoqueService;
use Illuminate\Bus\Batchable;
use Illuminate\Bus\Queueable;
use  Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class LocalEstoqueUpdateJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels, Batchable;

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
        $service = new LocalEstoqueService($this->loja);
        $response = $service->fetchPage($this->pagina);
        if (!empty($response->locaisEncontrados)) {
            $service->saveLocais((array)$response->locaisEncontrados);
            broadcast(new NotificaAllEvent("success", "Locais de Estoque da loja {$this->loja->nome}, etapa {$this->pagina} de {$response->nTotPaginas}, atualizada com sucesso!"));
        }
    }

    public function failed(\Throwable $exception)
    {
        // Logue a falha ou dispare alerta
        \Log::error("Job falhou na página {$this->pagina}: {$exception->getMessage()}");
    }

}
