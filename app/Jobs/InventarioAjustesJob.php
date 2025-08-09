<?php

namespace App\Jobs;

use App\Models\Inventario;
use App\Models\InventarioItem;
use App\Models\Loja;
use App\Models\PosicaoEstoque;
use App\Services\PosicaoEstoqueService;
use Carbon\Carbon;
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
    public function __construct(protected Inventario $inventario)
    {
        //
    }

    /**
     * Execute the job.
     */
    public function handle(): void
    {
        (new PosicaoEstoqueService(Loja::find($this->inventario->loja_id)))->fetchAll($this->inventario->codigo_local_estoque, $this->inventario->data->format('d/m/Y'));

        foreach ($this->inventario->items()->whereNotNull('inventario_items.quan')->get() as $inventarioItem) {

            if ($inventarioItem->valor === null || $inventarioItem->valor <= 0) {
                $posicaoEstoque = PosicaoEstoque::where('loja_id', $this->inventario->loja_id)
                    ->where('codigo_local_estoque', $this->inventario->codigo_local_estoque)
                    ->where('n_cod_prod', $inventarioItem->produto_codigo_produto)
                    ->where('data_posicao', $this->inventario->data->format('Y-m-d'))
                    ->first();
                $inventarioItem->valor = $posicaoEstoque->n_cmc ?? 0.01; // Default to 0.01 if not found
                $inventarioItem->save();
            }

            $response = $this->createAjuste($inventarioItem);
            if ($response) {
                $inventarioItem->response = json_encode($response);
                $inventarioItem->codigo_status = $response->codigo_status;
                $inventarioItem->descricao_status = $response->descricao_status;
                $inventarioItem->id_movest = $response->id_movest;
                $inventarioItem->id_ajuste = $response->id_ajuste;
                $inventarioItem->save();
            }
        }
    }

    private function createAjuste(InventarioItem $inventarioItem): null|object
    {
        if ($inventarioItem->quan !== null) {
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
                        "cod_int_ajuste" => 'ITEM' . $inventarioItem->id,
                        "data" => $inventarioItem->inventario->data->format('d/m/Y'),
                        "quan" => $inventarioItem->quan,
                        "valor" => $inventarioItem->valor == 0 ? 0.01 : $inventarioItem->valor,
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
        } else {
            $inventarioItem->response = 'Não ajustado, quantidade não informada!';
            $inventarioItem->save();
        }
        return null;
    }
}
