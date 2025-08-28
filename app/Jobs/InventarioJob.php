<?php

namespace App\Jobs;

use App\Events\NotificaUserEvent;
use App\Models\Inventario;
use App\Models\InventarioItem;
use App\Models\LocalEstoque;
use App\Models\PosicaoEstoque;
use App\Models\Produto;
use App\Models\User;
use App\Services\IntegrationAttemptsTrait;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class InventarioJob implements ShouldQueue
{
    use Queueable, IntegrationAttemptsTrait;

    /**
     * Create a new job instance.
     */
    public function __construct(protected Inventario $inventario, protected User $user)
    {
        //
    }

    /**
     * Execute the job.
     */
    public function handle(): void
    {
        broadcast(new NotificaUserEvent($this->user, "info", "Estamos registrando toda a informação no Omie, outras mensagens como essa lhe atualizará em breve. Só aguardar! ;)"));

        $this->inventario->status = 'Processando no Omie';
        $this->inventario->save();

        $localOrigem = LocalEstoque::where('loja_id', $this->inventario->loja_id)->where('codigo_local_estoque', $this->inventario->codigo_local_estoque)->first();

        while (InventarioItem::where('inventario_id', $this->inventario->id)->whereNull('inventario_items.status')->orWhere('inventario_items.status', 'Iniciado')->orWhere('inventario_items.status', 'Erro')->count() > 0) {

            foreach ($this->inventario->items()->get() as $inventarioItem) {

                if ($inventarioItem->quan === null) {
                    $inventarioItem->delete();
                } else {
                    if ($inventarioItem->valor === null || $inventarioItem->valor <= 0) {
                        $posicaoEstoque = PosicaoEstoque::where('loja_id', $this->inventario->loja_id)
                            ->where('codigo_local_estoque', $this->inventario->codigo_local_estoque)
                            ->where('n_cod_prod', $inventarioItem->produto_codigo_produto)
                            ->where('data_posicao', $this->inventario->data->format('Y-m-d'))
                            ->first();
                        $inventarioItem->valor = $posicaoEstoque->n_cmc ?? 0.01; // Default to 0.01 if not found
                        $inventarioItem->save();
                    }

                    $produto = Produto::where('loja_id', $this->inventario->loja_id)->where('codigo_produto', $inventarioItem->produto_codigo_produto)->first();

                    $response = $this->createAjuste($inventarioItem);
                    if ($response) {
                        $inventarioItem->response = json_encode($response);
                        $inventarioItem->codigo_status = $response->codigo_status;
                        $inventarioItem->descricao_status = $response->descricao_status;
                        $inventarioItem->id_movest = $response->id_movest;
                        $inventarioItem->id_ajuste = $response->id_ajuste;
                        $inventarioItem->status = 'Concluído';
                        broadcast(new NotificaUserEvent($this->user, "success", "Inventário do produto {$produto->descricao} <br> No estoque {$localOrigem->descricao} <br>Processado com sucesso no Omie!"));
                    } else {
                        $inventarioItem->status = 'Erro';
                    }
                    $inventarioItem->save();
                }
            }
        }

        Inventario::where('id', $this->inventario->id)->update([
            'status' => 'Finalizado',
            'finalizado' => now(),
        ]);
        broadcast(new NotificaUserEvent($this->user, "success", "Inventário do estoque {$localOrigem->descricao}, <br>concluído processamento com sucesso no Omie!"));
    }

    private function createAjuste(InventarioItem $inventarioItem): null|object
    {
        if (($inventarioItem->quan >= 0)
            && (in_array(!$inventarioItem->status, [null, 'Erro']))
            && ($inventarioItem->id_ajuste === null)
        ) {
            $inventarioItem->status = 'Iniciado';
            $inventarioItem->save();
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
                        "obs" => 'NTB - Estoque|Usuário:' . $this->user->name,
                        "origem" => $inventarioItem->inventario->origem,
                        "tipo" => $inventarioItem->inventario->tipo,
                        "motivo" => $inventarioItem->inventario->motivo,
                    ]
                ]
            ];

            // Inicializando Log de integração
            $this->loja_id = $loja->id;
            $this->model = 'InventarioItem';
            $this->request = json_encode(['method' => 'POST', 'path' => $url, 'payload' => $data]);
            $this->beforeAttemptLog();

            try {
                try {
                    $response = Http::withHeaders([
                        'Content-Type' => 'application/json'
                    ])->connectTimeout(60)->timeout(60)->post($url, $data);

                    // Log de integração
                    $this->response = $response->getBody()->getContents();
                    $this->code = $response->getStatusCode();

                    if ($response->status() === 200) {
                        return $response->object();
                    } else {
                        $inventarioItem->status = 'Erro';
                        $inventarioItem->response = $response->body();
                        $inventarioItem->save();
                    }
                } catch (\Throwable $th) {
                    $this->error_message = json_encode($th->getMessage());
                    $this->code = $th->getCode();
                    $this->error = true;
                    Log::critical($th->getMessage(), [
                        'Code' => $th->getCode(),
                        'File' => $th->getFile(),
                        'Line' => $th->getLine()
                    ]);
                }
            } finally {
                $this->afterAttemptLog();
            }
        }
        return null;
    }
}
