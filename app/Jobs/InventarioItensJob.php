<?php

namespace App\Jobs;

use App\Models\Inventario;
use App\Models\InventarioItem;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use stdClass;

class InventarioItensJob implements ShouldQueue
{
    use Queueable;

    /**
     * Create a new job instance.
     */
    public function __construct(protected Inventario $inventario) {}

    /**
     * Execute the job.
     */
    public function handle(): void
    {
        foreach ($this->inventario->items as $item) {
            $posicaoEstoque = $this->getPosicaoEstoque($this->inventario, $item);
            $item->valor = $posicaoEstoque->cmc ?? 0.01;
            $item->save();
            sleep(1);
        }
    }

    private function getPosicaoEstoque(Inventario $inventario, InventarioItem $item): null|object
    {
        $url =  "https://app.omie.com.br/api/v1/estoque/consulta/";
        $data = [
            "call" => "PosicaoEstoque",
            "app_key" => $inventario->loja->omie_app_key,
            "app_secret" => $inventario->loja->omie_app_secret,
            "param" => [
                [
                    "codigo_local_estoque" => $inventario->codigo_local_estoque,
                    "id_prod" => $item->produto_codigo_produto,
                    "cod_int" => "",
                    "data" => $inventario->data->format('d/m/Y')
                ]
            ]
        ];
        try {
            $response = Http::withHeaders([
                'Content-Type' => 'application/json'
            ])->connectTimeout(60)->timeout(60)->post($url, $data);
            if ($response->status() === 200) {
                return $response->object();
            } elseif ($response->status() === 500) {
                return new stdClass();
            } else {
                Log::critical('OMIE - getPosicaoEstoque - Retorno inexperado', [
                    'statusCode' => $response->status(),
                    'response' => $response->body(),
                    'payload' => $data,
                ]);
            }
        } catch (\Throwable $th) {
            Log::critical($th->getMessage(), [
                'Code' => $th->getCode(),
                'File' => $th->getFile(),
                'Line' => $th->getLine()
            ]);
        }
        return new stdClass();
    }
}
