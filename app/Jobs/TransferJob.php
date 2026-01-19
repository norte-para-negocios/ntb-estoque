<?php

namespace App\Jobs;

use App\Events\NotificaUserEvent;
use App\Models\Movimento;
use App\Models\LocalEstoque;
use App\Models\Loja;
use App\Models\PosicaoEstoque;
use App\Models\Produto;
use App\Models\Transferencia;
use App\Models\User;
use App\Services\IntegrationAttemptsTrait;
use App\Services\PosicaoEstoqueService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use stdClass;
use Throwable;

class TransferJob implements ShouldQueue
{
    use Queueable, IntegrationAttemptsTrait;

    public $timeout = 0;

    protected PosicaoEstoqueService $posicaoService;

    /**
     * Create a new job instance.
     */
    public function __construct(protected Transferencia $transferencia, protected User $user)
    {
        $this->posicaoService = new PosicaoEstoqueService($transferencia->loja);
    }

    /**
     * Execute the job.
     */
    public function handle(): void
    {
        broadcast(new NotificaUserEvent($this->user, "info", "Estamos registrando toda a informação no Omie, outras mensagens como essa lhe atualizará em breve. Só aguardar! ;)"));

        $this->transferencia->status = 'Processando';
        $this->transferencia->save();

        $localOrigem = LocalEstoque::where('loja_id', $this->transferencia->loja_id)
            ->where('codigo_local_estoque', $this->transferencia->codigo_local_origem)
            ->first();

        $esperaPosicao = 0;
        while (Loja::find($this->transferencia->loja_id)->posicao_estoque_status !== 'Concluído') {
            $esperaPosicao += 1;
            sleep(1);

            if ($esperaPosicao >= 30) {
                break;
            }
        }

        for ($i=0; $i < 3; $i++) {
            $movimentos = Movimento::where('transferencia_id', $this->transferencia->id)
                ->where(function ($q) {
                    $q->whereNull('status')
                    ->orWhereIn('status', ['Iniciado']);
            })
            ->orderBy('quan')
            ->get();         
            foreach ($movimentos as $movimento) {
                if ($movimento->quan === null) {
                    $movimento->delete();
                } else {
                    if ($movimento->valor === null || $movimento->valor <= 0) {
                        $posicaoEstoque = PosicaoEstoque::where('loja_id', $this->transferencia->loja_id)
                            ->where('codigo_local_estoque', $this->transferencia->codigo_local_origem)
                            ->where('n_cod_prod', $movimento->produto->codigo_produto)
                            ->where('data_posicao', $this->transferencia->data->format('Y-m-d'))
                            ->first();
                        if ($posicaoEstoque?->n_cmc > 0) {
                            $movimento->valor = $posicaoEstoque->n_cmc;
                            $movimento->save();
                        } else {
                            // Tenta depois novamente, aguardando a posição de estoque carregar.
                            try {
                                $posicaoProd = $this->posicaoService->fetchPosicaoProduto($this->transferencia->codigo_local_origem, $movimento->produto->codigo_produto, $this->transferencia->data->format('d/m/Y'));
                                $this->posicaoService->savePosicao($posicaoProd, $this->transferencia->data->format('d/m/Y'));
                                $posicaoEstoque = PosicaoEstoque::where('loja_id', $this->transferencia->loja_id)
                                    ->where('codigo_local_estoque', $this->transferencia->codigo_local_origem)
                                    ->where('n_cod_prod', $movimento->produto->codigo_produto)
                                    ->where('data_posicao', $this->transferencia->data->format('Y-m-d'))
                                    ->first();
                                if ($posicaoEstoque?->n_cmc > 0) {
                                    $movimento->valor = $posicaoEstoque->n_cmc;
                                    $movimento->save();
                                } else {
                                    $movimento->valor = 0;
                                    $movimento->status = 'Erro';
                                    $movimento->save();
                                }
                                break;
                            } catch (Throwable $e) {
                                Log::error("Não foi possível obter o CMC do Produto: " . $e->getMessage(),
                                    [
                                        'movimento' => $movimento,
                                    ]
                                );
                            }
                        }
                    }

                    $produto = Produto::where('loja_id', $this->transferencia->loja_id)->where('codigo_produto', $movimento->produto->codigo_produto)->first();

                    $response = $this->createAjuste($movimento);
                    if ($response) {
                        $movimento->response = json_encode($response);
                        $movimento->codigo_status = $response->codigo_status;
                        $movimento->descricao_status = $response->descricao_status;
                        $movimento->id_movest = $response->id_movest;
                        $movimento->id_ajuste = $response->id_ajuste;
                        $movimento->status = 'Concluído';
                        broadcast(new NotificaUserEvent($this->user, "success", "Inventário do produto $produto->descricao <br> No estoque $localOrigem->descricao <br>Processado com sucesso no Omie!"));
                    } else {
                        $movimento->status = 'Erro';
                    }
                    $movimento->save();
                }
            }
        }

        $this->transferencia->update([
            'status' => 'Concluído'
        ]);
        broadcast(new NotificaUserEvent($this->user, "success", "Transferência de estoque $localOrigem->descricao,<br>concluído processamento com sucesso no Omie!"));
    }

    private function createAjuste(Movimento $movimento): null|object
    {
        if (($movimento->quan >= 0)
            && (in_array(!$movimento->status, [null, 'Erro']))
            && ($movimento->id_ajuste === null)
            && $movimento->valor > 0
        ) {
            $movimento->status = 'Iniciado';
            $movimento->save();
            $loja = $movimento->transferencia->loja;
            $url = 'https://app.omie.com.br/api/v1/estoque/ajuste/';
            $data = [
                "call" => "IncluirAjusteEstoque",
                "app_key" => $loja->omie_app_key,
                "app_secret" => $loja->omie_app_secret,
                "param" => [
                    [
                        "codigo_local_estoque" => $movimento->transferencia->codigo_local_destino,
                        "id_prod" => $movimento->produto->codigo_produto,
                        "cod_int_ajuste" => 'MOVIMENTO' . $movimento->id,
                        "data" => $movimento->transferencia->data->format('d/m/Y'),
                        "quan" => $movimento->quan,
                        "valor" => $movimento->valor,
                        "obs" => 'NTB - Estoque|Usuário:' . $this->user->name,
                        "origem" => $movimento->transferencia->codigo_local_origem,
                        "tipo" => $movimento->tipo,
                        "motivo" => $movimento->transferencia->motivo,
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
                    } elseif ($response->status() === 500 && stripos($response->object()->faultcode, 'SOAP-ENV:Client-1035') !== false) {
                        preg_match('/com o ID \[(\d+)\]/', $response->object()->faultstring, $matches);
                        $idAjuste = isset($matches[1]) ? $matches[1] : '';
                        $obj = new stdClass();
                        $obj->codigo_status = '0';
                        $obj->descricao_status = 'Ajuste realizado';
                        $obj->id_movest = '';
                        $obj->id_ajuste = $idAjuste;
                        return $obj;
                    } else {
                        $movimento->status = 'Erro';
                        $movimento->response = $response->body();
                        $movimento->save();
                    }
                } catch (Throwable $th) {
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
        } elseif ($movimento->valor <= 0 || $movimento->valor === null) {
            $movimento->valor = 0;
            $movimento->status = 'Erro';
            $movimento->save();
        }
        return null;
    }
}
