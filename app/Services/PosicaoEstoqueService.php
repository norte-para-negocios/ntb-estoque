<?php

namespace App\Services;

use App\Events\NotificaUserEvent;
use App\Jobs\UpdateOmieLocalData\PosicaoEstoqueUpdateJob;
use App\Models\Loja;
use App\Models\PosicaoEstoque;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use stdClass;
use Throwable;

class PosicaoEstoqueService
{
    use IntegrationAttemptsTrait;

    private $urlBase = "https://app.omie.com.br/api/";

    public function __construct(protected Loja $loja)
    {
    }

    public function fetchAll(int $codigoLocalEstoque, $dataPosicao, $lastPages = 0): void
    {
        if ($this->loja->posicao_estoque_status !== 'Processando') {
            // Aciona a Variavel de Controle
            PosicaoEstoque::where('loja_id', $this->loja->id)
                ->where('data_posicao', Carbon::createFromFormat('d/m/Y', $dataPosicao)->format('Y-m-d'))
                ->delete();
            $this->loja->posicao_estoque_status = 'Processando';
            $this->loja->save();
            $first = $this->fetchPage($codigoLocalEstoque, $dataPosicao, 1);
            $total = $lastPages > 0 ? $lastPages : ($first->nTotPaginas ?? 1);
            $jobs = [];
            for ($i = 1; $i <= $total; $i++) {
                $jobs[] = new PosicaoEstoqueUpdateJob($this->loja, $codigoLocalEstoque, $dataPosicao, $i);
            }
            // Dispara o batch
            Bus::batch($jobs)
                ->then(function () {
                    // Todos os Jobs concluídos com sucesso
                    $this->loja->posicao_estoque_ultima_atualizacao = date('Y-m-d H:i:s');
                    $this->loja->posicao_estoque_status = 'Concluído';
                    $this->loja->save();
                    if (auth()->check()) {
                        broadcast(new NotificaUserEvent(auth()->user(), "success", "Posição de Estoque da loja {$this->loja->nome}, atualizada com sucesso!"));
                    }
                })
                ->catch(function (Throwable $e) {
                    // Algum Job falhou — você pode logar ou tratar aqui
                    $this->loja->posicao_estoque_status = 'Erro';
                    $this->loja->save();
                })
                ->finally(function () {
                    // Executado sempre, mesmo com falhas
                })
                ->onQueue('posicaoestoque')
                ->dispatch();
        }
    }

    public function fetchPage(int $codigoLocalEstoque, $dataPosicao, $pagina = 1): object
    {
        $url = $this->urlBase . 'v1/estoque/consulta/';
        $data = [
            "call" => "ListarPosEstoque",
            "app_key" => $this->loja->omie_app_key,
            "app_secret" => $this->loja->omie_app_secret,
            "param" => [
                [
                    "nPagina" => $pagina,
                    "nRegPorPagina" => 1000,
                    "dDataPosicao" => $dataPosicao,
                    "codigo_local_estoque" => $codigoLocalEstoque,
                ]
            ]
        ];

        // Inicializando Log de integração
        $this->loja_id = $this->loja->id;
        $this->model = 'PosicaoEstoque';
        $this->request = json_encode(['method' => 'POST', 'path' => $url, 'payload' => $data]);
        $this->beforeAttemptLog();

        try {
            try {
                $response = Http::withHeaders([
                    'Content-Type' => 'application/json'
                ])->post($url, $data);

                // Log de integração
                $this->response = $response->getBody()->getContents();
                $this->code = $response->getStatusCode();

                if ($response->status() === 200) {
                    return $response->object();
                } elseif ($response->status() === 500) {
                    return new stdClass();
                }
            } catch (Throwable $th) {
                // Log de erro.
                $this->error_message = json_encode($th->getMessage());
                $this->code = $th->getCode();
                $this->error = true;
            }
            return new stdClass();
        } finally {
            $this->afterAttemptLog();
        }
    }

    public function fetchPosicaoProduto(int $codigoLocalEstoque, $produtoCodigo, $dataPosicao): object
    {
        $url = $this->urlBase . 'v1/estoque/consulta/';
        $data = [
            "call" => "ListarPosEstoque",
            "app_key" => $this->loja->omie_app_key,
            "app_secret" => $this->loja->omie_app_secret,
            "param" => [
                [
                    "nPagina" => 1,
                    "nRegPorPagina" => 1,
                    "dDataPosicao" => $dataPosicao,
                    "codigo_local_estoque" => $codigoLocalEstoque,
                    "lista_produtos" => ["nCodProd" => $produtoCodigo],
                    "cExibeTodos" => 'S',
                ]
            ]
        ];

        // Inicializando Log de integração
        $this->loja_id = $this->loja->id;
        $this->model = 'PosicaoEstoque';
        $this->request = json_encode(['method' => 'POST', 'path' => $url, 'payload' => $data]);
        $this->beforeAttemptLog();

        try {
            try {
                $response = Http::withHeaders([
                    'Content-Type' => 'application/json'
                ])->post($url, $data);

                // Log de integração
                $this->response = $response->getBody()->getContents();
                $this->code = $response->getStatusCode();

                if ($response->status() === 200 && isset($response->object()->produtos[0])) {
                    return  $response->object()->produtos[0];
                } elseif ($response->status() === 500) {
                    return new stdClass();
                }
            } catch (Throwable $th) {
                // Log de erro.
                $this->error_message = json_encode($th->getMessage());
                $this->code = $th->getCode();
                $this->error = true;
            }
            return new stdClass();
        } finally {
            $this->afterAttemptLog();
        }
    }

    public function savePosicoes(array $posicoes, $dataPosicao): void
    {
        foreach ($posicoes as $posicao) {
            $this->savePosicao((object)$posicao, $dataPosicao);
        }
    }

    public function savePosicao(object $posicao, $dataPosicao): void
    {
        $item['loja_id'] = $this->loja->id;
        $item['codigo_local_estoque'] = $posicao->codigo_local_estoque ?? null;
        $item['n_cod_prod'] = $posicao->nCodProd ?? null;
        $item['data_posicao'] = Carbon::createFromFormat('d/m/Y', $dataPosicao)->format('Y-m-d');
        $item['c_cod_int'] = $posicao->cCodInt ?? null;
        $item['c_codigo'] = $posicao->cCodigo ?? null;
        $item['c_descricao'] = $posicao->cDescricao ?? null;
        $item['n_preco_unitario'] = $posicao->nPrecoUnitario ?? null;
        $item['n_saldo'] = $posicao->nSaldo ?? null;
        $item['n_cmc'] = $posicao->nCMC ?? null;
        $item['n_pendente'] = $posicao->nPendente ?? null;
        $item['estoque_minimo'] = $posicao->estoque_minimo ?? null;
        $item['reservado'] = $posicao->reservado ?? null;
        $item['fisico'] = $posicao->fisico ?? null;
        try {
            if (!empty($item['codigo_local_estoque']) && !empty($item['n_cod_prod']) && !empty($item['data_posicao'])) {
                PosicaoEstoque::updateOrCreate(
                    [
                        'loja_id' => $this->loja->id,
                        'codigo_local_estoque' => $item['codigo_local_estoque'],
                        'n_cod_prod' => $item['n_cod_prod'],
                        'data_posicao' => $item['data_posicao'],
                    ],
                    $item
                );
            }
        } catch (Throwable $th) {
            Log::error(
                "Erro ao salvar posição de estoque" . $th->getMessage(),
                $item
            );
        }
    }
}
