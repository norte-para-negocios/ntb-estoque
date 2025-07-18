<?php

namespace App\Jobs;

use App\Models\Movimento;
use App\Services\OmieService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

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
        $response = $this->createTransferencia($this->movimento);
        if ($response) {
            $this->movimento->codigo_status = $response->codigo_status;
            $this->movimento->descricao_status = $response->descricao_status;
            $this->movimento->id_movest = $response->id_movest;
            $this->movimento->id_ajuste = $response->id_ajuste;
            $this->movimento->save();
        }
    }

    private function createTransferencia(Movimento $movimento): null|object
    {
        $loja = $movimento->loja;
        $url = 'https://app.omie.com.br/api/v1/estoque/ajuste/';
        $data = [
            "call" => "IncluirAjusteEstoque",
            "app_key" => $loja->omie_app_key,
            "app_secret" => $loja->omie_app_secret,
            "param" => [
                [
                    "codigo_local_estoque" => $movimento->codigo_local_estoque,
                    "id_prod" => $movimento->id_prod,
                    "cod_int_ajuste" => $movimento->id,
                    "data" => $movimento->data->format('d/m/Y'),
                    "quan" => $movimento->quan,
                    "valor" => $movimento->valor,
                    "obs" => $movimento->obs ?? "NTB - Estoque #{$movimento->id}",
                    "origem" => $movimento->origem,
                    "tipo" => $movimento->tipo,
                    "motivo" => $movimento->motivo,
                    "codigo_local_estoque_destino" => $movimento->codigo_local_estoque_destino,
                ]
            ]
        ];
        try {
            $response = Http::withHeaders([
                'Content-Type' => 'application/json'
            ])->connectTimeout(60)->timeout(60)->post($url, $data);
            if ($response->status() === 200) {
                return $response->object();
            } else {
                $movimento->response = $response->body();
                $movimento->save();
            }
        } catch (\Throwable $th) {
            Log::critical($th->getMessage(), [
                'Code' => $th->getCode(),
                'File' => $th->getFile(),
                'Line' => $th->getLine()
            ]);
        }
        return null;
    }
}
