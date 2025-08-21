<?php

namespace App\Jobs\UpdateOmieLocalData;

use App\Events\NotificaAllEvent;
use App\Models\Loja;
use App\Services\PosicaoEstoqueService;
use Illuminate\Bus\Batchable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class PosicaoEstoqueUpdateJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels, Batchable;

    // Tentativas antes de falhar de vez
    public int $tries = 5;

    // Intervalos em segundos para cada retry
    public array|int $backoff = [10, 30, 60, 120];

    public function __construct(
        protected Loja $loja,
        protected int $codigoLocalEstoque,
        protected string $dataPosicao,
        protected int  $pagina
    )
    {
    }

    public function handle(): void
    {
        $service = new PosicaoEstoqueService($this->loja);
        $response = $service->fetchPage($this->codigoLocalEstoque, $this->dataPosicao, $this->pagina);

        if (!empty($response->produtos)) {
            $service->savePosicoes((array)$response->produtos, $this->dataPosicao);
            broadcast(new NotificaAllEvent("success", "Posição de Estoque da loja {$this->loja->nome}, etapa {$this->pagina} de {$response->nTotPaginas}, atualizada com sucesso!"));
        }
    }

    public function failed(\Throwable $exception)
    {
        // Logue a falha ou dispare alerta
        \Log::error("Job falhou na página {$this->pagina}: {$exception->getMessage()}");
    }

}
