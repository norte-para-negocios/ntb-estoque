<?php

namespace App\Jobs;

use App\Models\InventarioItem;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class InventarioAjustesJob implements ShouldQueue
{
    use Queueable;

    /**
     * Create a new job instance.
     */
    public function __construct(protected InventarioItem $inventarioItem)
    {
        //
    }

    /**
     * Execute the job.
     */
    public function handle(): void
    {
        $response = $this->createAjuste($this->inventarioItem);
        if ($response) {
            $this->inventarioItem->codigo_status = $response->codigo_status;
            $this->inventarioItem->descricao_status = $response->descricao_status;
            $this->inventarioItem->id_movest = $response->id_movest;
            $this->inventarioItem->id_ajuste = $response->id_ajuste;
            $this->inventarioItem->save();
        }
    }

    private function createAjuste(InventarioItem $inventarioItem): null|object
    {
        $loja = $inventarioItem->inventario->loja;
        $url = 'https://app.omie.com.br/api/v1/estoque/ajuste/';
        $data = [
            "call" => "IncluirAjusteEstoque",
            "app_key" => $loja->omie_app_key,
            "app_secret" => $loja->omie_app_secret,
            "param" => [
                [
                    "codigo_local_estoque" => $inventarioItem->inventario->codigo_local_estoque,
                    "id_prod" => $inventarioItem->produto_codigo_produto,
                    "cod_int_ajuste" => 'ITEM'.$inventarioItem->id,
                    "data" => $inventarioItem->inventario->data->format('d/m/Y'),
                    "quan" => $inventarioItem->quan,
                    "valor" => $inventarioItem->valor,
                    "obs" => "NTB - Estoque Item: #{$inventarioItem->id}",
                    "origem" => $inventarioItem->inventario->origem,
                    "tipo" => $inventarioItem->inventario->tipo,
                    "motivo" => $inventarioItem->inventario->motivo,
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
                $inventarioItem->response = $response->body();
                $inventarioItem->save();
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
