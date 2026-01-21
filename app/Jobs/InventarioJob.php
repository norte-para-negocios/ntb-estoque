<?php

namespace App\Jobs;

use App\Events\NotificaUserEvent;
use App\Models\Inventario;
use App\Models\InventarioItem;
use App\Models\LocalEstoque;
use App\Models\Loja;
use App\Models\PosicaoEstoque;
use App\Models\Produto;
use App\Models\User;
use App\Services\IntegrationAttemptsTrait;
use App\Services\PosicaoEstoqueService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use stdClass;
use Throwable;

class InventarioJob implements ShouldQueue
{
    use IntegrationAttemptsTrait, Queueable;

    public $timeout = 0;

    protected PosicaoEstoqueService $posicaoService;

    /**
     * Create a new job instance.
     */
    public function __construct(protected Inventario $inventario, protected User $user)
    {
        $this->posicaoService = new PosicaoEstoqueService($inventario->loja);
    }

    /**
     * Execute the job.
     */
    public function handle(): void
    {
        broadcast(new NotificaUserEvent($this->user, 'info', 'Estamos registrando toda a informação no Omie, outras mensagens como essa lhe atualizará em breve. Só aguardar! ;)'));

        $this->inventario->status = 'Processando no Omie';
        $this->inventario->save();

        $localOrigem = LocalEstoque::where('loja_id', $this->inventario->loja_id)
            ->where('codigo_local_estoque', $this->inventario->codigo_local_estoque)
            ->first();

        // $esperaPosicao = 0;
        // while (Loja::find($this->inventario->loja_id)->posicao_estoque_status !== 'Concluído') {
        //     $esperaPosicao += 1;
        //     sleep(1);

        //     if ($esperaPosicao >= 30) {
        //         break;
        //     }
        // }

        while (InventarioItem::where('inventario_id', $this->inventario->id)
            ->where(function ($q) {
                $q->whereNull('inventario_items.status')
                    ->orWhereIn('inventario_items.status', ['Iniciado']);
            })
            ->count() > 0) {

            foreach (InventarioItem::where('inventario_id', $this->inventario->id)
                ->where(function ($q) {
                    $q->whereNull('inventario_items.status')
                        ->orWhereIn('inventario_items.status', ['Iniciado']);
                })
                ->orderBy('quan')
                ->get() as $inventarioItem) {

                if ($inventarioItem->quan === null) {
                    $inventarioItem->delete();
                } elseif(json_decode($inventarioItem->produto->full_object)->inativo === 'S') {                    
                    $inventarioItem->status = 'Erro';
                    $inventarioItem->descricao_status = 'Produto INATIVO, não foi possível processar o ajuste no Omie!';
                    $inventarioItem->save();
                } else {
                    
                    if ($inventarioItem->valor === null || $inventarioItem->valor <= 0) {
                        $posicaoEstoque = PosicaoEstoque::where('loja_id', $this->inventario->loja_id)
                            ->where('codigo_local_estoque', $this->inventario->codigo_local_estoque)
                            ->where('n_cod_prod', $inventarioItem->produto_codigo_produto)
                            ->where('data_posicao', $this->inventario->data->format('Y-m-d'))
                            ->first();
                        if ($posicaoEstoque?->n_cmc > 0) {
                            $inventarioItem->valor = $posicaoEstoque->n_cmc;
                            $inventarioItem->save();
                        } else {
                            // Tenta depois novamente, aguardando a posição de estoque carregar.
                            try {
                                $posicaoProd = $this->posicaoService->fetchPosicaoProduto($this->inventario->codigo_local_estoque, $inventarioItem->produto_codigo_produto, $this->inventario->data->format('d/m/Y'));
                                $this->posicaoService->savePosicao($posicaoProd, $this->inventario->data->format('d/m/Y'));
                                $posicaoEstoque = PosicaoEstoque::where('loja_id', $this->inventario->loja_id)
                                    ->where('codigo_local_estoque', $this->inventario->codigo_local_estoque)
                                    ->where('n_cod_prod', $inventarioItem->produto_codigo_produto)
                                    ->where('data_posicao', $this->inventario->data->format('Y-m-d'))
                                    ->first();
                                if ($posicaoEstoque?->n_cmc > 0) {
                                    $inventarioItem->valor = $posicaoEstoque->n_cmc;
                                    $inventarioItem->save();
                                } else {
                                    $inventarioItem->valor = 0;
                                    $inventarioItem->status = 'Sem CMC';
                                    $inventarioItem->save();
                                }
                                break;
                            } catch (Throwable $e) {
                                Log::error('Não foi possível obter o CMC do Produto: '.$e->getMessage(),
                                    [
                                        'inventarioItem' => $inventarioItem,
                                    ]
                                );
                            }
                        }
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
                        broadcast(new NotificaUserEvent($this->user, 'success', "Inventário do produto $produto->descricao <br> No estoque $localOrigem->descricao <br>Processado com sucesso no Omie!"));
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
        broadcast(new NotificaUserEvent($this->user, 'success', "Inventário do estoque $localOrigem->descricao,<br>concluído processamento com sucesso no Omie!"));
    }

    private function createAjuste(InventarioItem $inventarioItem): ?object
    {
        if (($inventarioItem->quan >= 0)
            && (in_array(! $inventarioItem->status, [null, 'Erro', 'Sem CMC']))
            && ($inventarioItem->id_ajuste === null)
            && $inventarioItem->valor > 0
        ) {
            $inventarioItem->status = 'Iniciado';
            $inventarioItem->save();
            $loja = $inventarioItem->inventario->loja;
            $url = 'https://app.omie.com.br/api/v1/estoque/ajuste/';
            $data = [
                'call' => 'IncluirAjusteEstoque',
                'app_key' => $loja->omie_app_key,
                'app_secret' => $loja->omie_app_secret,
                'param' => [
                    [
                        'codigo_local_estoque' => $inventarioItem->inventario->codigo_local_estoque,
                        'id_prod' => $inventarioItem->produto_codigo_produto,
                        'cod_int_ajuste' => 'ITEM'.$inventarioItem->id,
                        'data' => $inventarioItem->inventario->data->format('d/m/Y'),
                        'quan' => $inventarioItem->quan,
                        'valor' => $inventarioItem->valor,
                        'obs' => 'NTB - Estoque|Usuário:'.$this->user->name,
                        'origem' => $inventarioItem->inventario->origem,
                        'tipo' => $inventarioItem->inventario->tipo,
                        'motivo' => $inventarioItem->inventario->motivo,
                    ],
                ],
            ];

            // Inicializando Log de integração
            $this->loja_id = $loja->id;
            $this->model = 'InventarioItem';
            $this->request = json_encode(['method' => 'POST', 'path' => $url, 'payload' => $data]);
            $this->beforeAttemptLog();

            try {
                try {
                    $response = Http::withHeaders([
                        'Content-Type' => 'application/json',
                    ])->connectTimeout(60)->timeout(60)->post($url, $data);

                    // Log de integração
                    $this->response = $response->getBody()->getContents();
                    $this->code = $response->getStatusCode();

                    if ($response->status() === 200) {
                        return $response->object();
                    } elseif ($response->status() === 429) {
                        sleep(60);

                        return $this->createAjuste($inventarioItem);
                    } elseif ($response->status() === 425) {
                        preg_match('/Tente novamente em \[(\d+)\]/', $response->object()->faultstring, $matches);
                        $idAjuste = isset($matches[1]) ? $matches[1] : '';
                        sleep(60);

                        return $this->createAjuste($inventarioItem);
                    } elseif ($response->status() === 500 && stripos($response->object()->faultcode, 'SOAP-ENV:Client-1035') !== false) {
                        preg_match('/com o ID \[(\d+)\]/', $response->object()->faultstring, $matches);
                        $idAjuste = isset($matches[1]) ? $matches[1] : '';
                        $obj = new stdClass;
                        $obj->codigo_status = '0';
                        $obj->descricao_status = 'Ajuste realizado';
                        $obj->id_movest = '';
                        $obj->id_ajuste = $idAjuste;

                        return $obj;
                    } else {
                        $inventarioItem->status = 'Erro';
                        $inventarioItem->response = $response->body();
                        $inventarioItem->descricao_status = $response->body();
                        $inventarioItem->save();
                    }
                } catch (Throwable $th) {

                    $inventarioItem->status = 'Erro';
                    $inventarioItem->response = $response->body();
                    $inventarioItem->descricao_status = $response->body();
                    $inventarioItem->save();

                    $this->error_message = json_encode($th->getMessage());
                    $this->code = $th->getCode();
                    $this->error = true;
                    Log::critical($th->getMessage(), [
                        'Code' => $th->getCode(),
                        'File' => $th->getFile(),
                        'Line' => $th->getLine(),
                    ]);
                }
            } finally {
                $this->afterAttemptLog();
            }
        } elseif ($inventarioItem->valor <= 0 || $inventarioItem->valor === null) {
            $inventarioItem->valor = 0;
            $inventarioItem->status = 'Sem CMC';
            $inventarioItem->save();
        }

        return null;
    }
}
