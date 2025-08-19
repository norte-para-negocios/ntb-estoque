<?php

namespace App\Services;

use App\Models\Loja;
use App\Models\PosicaoEstoque;
use Carbon\Carbon;
use Exception;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use stdClass;

class NotaFiscalService
{
    use IntegrationAttemptsTrait;

    private $urlBase = "https://app.omie.com.br/api/";

    public function __construct(protected Loja $loja)
    {
    }

    public function fetchAll($lastPages = 0): void
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

    public function fetchPage($pagina = 1): object
    {
        $url = $this->urlBase . 'v1/produtos/recebimentonfe/';
        $data = [
            "call" => "ListarRecebimentos",
            "app_key" => $this->loja->omie_app_key,
            "app_secret" => $this->loja->omie_app_secret,
            "param" => [
                [
                    "nPagina" => $pagina,
                    "nRegistrosPorPagina" => 200,
                    "cExibirDetalhes" => "S"
                ]
            ]
        ];

        // Inicializando Log de integração
        $this->request = json_encode(['method' => 'POST', 'path' => $url, 'payload' => $data]);
        $this->beforeAttemptLog();

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

        } catch (\Throwable $th) {
            // Log de erro.
            $this->error_message = json_encode($th->getMessage());
            $this->code = $th->getCode();
            $this->error = true;
        }
        return new stdClass();
    }

    public function saveNotasFiscais(array $notasFiscais): void
    {
        foreach ($notasFiscais as $notaFiscal) {
            $this->saveNotaFiscal((object)$notaFiscal);
        }
    }

    public function saveNotaFiscal(object $notaFiscal): void
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
}
