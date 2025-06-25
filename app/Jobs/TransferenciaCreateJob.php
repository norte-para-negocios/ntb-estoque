<?php

namespace App\Jobs;

use App\Models\Movimento;
use App\Services\OmieService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class TransferenciaCreateJob implements ShouldQueue
{
    use Queueable;

    /**
     * Create a new job instance.
     */
    public function __construct(protected Movimento $movimento)
    {
        //
    }

    /**
     * Execute the job.
     */
    public function handle(): void
    {
        $omie = new OmieService();
        $response = $omie->createTransferencia($this->movimento);
        if ($response) {
            $this->movimento->codigo_status = $response->codigo_status;
            $this->movimento->descricao_status = $response->descricao_status;
            $this->movimento->id_movest = $response->id_movest;
            $this->movimento->id_ajuste = $response->id_ajuste;
            $this->movimento->save();
        }
    }
}
