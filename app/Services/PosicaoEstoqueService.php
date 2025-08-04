<?php

namespace App\Services;

use App\Models\Loja;
use App\Models\PosicaoEstoque;
use Carbon\Carbon;
use Exception;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use stdClass;

class PosicaoEstoqueService
{
    private $urlBase = "https://app.omie.com.br/api/";

    public function __construct(protected Loja $loja) {}

    public function fetchAll(int $codigoLocalEstoque, $dataPosicao, $lastPages = 0): void
    {
        $response = $this->fetchPage($codigoLocalEstoque, $dataPosicao, 1);
        if (isset($response->produtos) && count($response->produtos) > 0) {
            $this->savePosicoes((array)$response->produtos, $dataPosicao);
            if (($response->nTotPaginas > 1) && ($lastPages > 1 || $lastPages == 0)) {
                for ($i = 2; $i <= ($lastPages > 0 ? $lastPages : $response->nTotPaginas); $i++) {
                    $resp = $this->fetchPage($codigoLocalEstoque, $dataPosicao, $i);
                    if (isset($resp->produtos) && count($resp->produtos) > 0) {
                        $this->savePosicoes((array)$resp->produtos, $dataPosicao);
                    }
                }
            }
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
                    "nRegPorPagina" => 200,
                    "dDataPosicao" => $dataPosicao,
                    "cExibeTodos" => 'S',
                    "codigo_local_estoque" => $codigoLocalEstoque,
                ]
            ]
        ];

        try {
            $response = Http::withHeaders([
                'Content-Type' => 'application/json'
            ])->post($url, $data);

            if ($response->status() === 200) {
                return $response->object();
            } elseif ($response->status() === 500) {
                return new stdClass();
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
            PosicaoEstoque::updateOrCreate(
                [
                    'loja_id' => $this->loja->id,
                    'codigo_local_estoque' => $item['codigo_local_estoque'],
                    'n_cod_prod' => $item['n_cod_prod'],
                    'data_posicao' => $item['data_posicao'],
                ],
                $item
            );
        } catch (Exception $e) {
            Log::error(
                "Erro ao salvar posição de estoque" . $e->getMessage(),
                $item
            );
        }
    }

    public function webhook(array $data): void
    {
        Log::info('Webhook Posicao Estoque', $data);
        // if (isset($data['event']['codigo_produto'])) {
        //     $produto = $this->fetchProduto($data['event']['codigo_produto']);
        //     if (isset($produto->codigo_produto)) {
        //         $this->saveProduto($produto);
        //     }
        // }
    }
}
