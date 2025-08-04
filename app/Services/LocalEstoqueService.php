<?php

namespace App\Services;

use App\Models\LocalEstoque;
use App\Models\Loja;
use Exception;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use stdClass;

class LocalEstoqueService
{
    private $urlBase = "https://app.omie.com.br/api/";

    public function __construct(protected Loja $loja) {}

    public function fetchAll($lastPages = 0): void
    {
        $response = $this->fetchPage(1);
        if (isset($response->locaisEncontrados) && count($response->locaisEncontrados) > 0) {
            $this->saveLocais((array)$response->locaisEncontrados);
            if (($response->nTotPaginas > 1) && ($lastPages > 1 || $lastPages == 0)) {
                for ($i = 2; $i <= ($lastPages > 0 ? $lastPages : $response->nTotPaginas); $i++) {
                    $resp = $this->fetchPage($i);
                    if (isset($resp->locaisEncontrados) && count($resp->locaisEncontrados) > 0) {
                        $this->saveLocais((array)$resp->locaisEncontrados);
                    }
                }
            }
        }
    }

    public function fetchPage($pagina = 1): object
    {
        $url = $this->urlBase . 'v1/estoque/local/';
        $data = [
            "call" => "ListarLocaisEstoque",
            "app_key" => $this->loja->omie_app_key,
            "app_secret" => $this->loja->omie_app_secret,
            "param" => [
                [
                    "nPagina" => $pagina,
                    "nRegPorPagina" => 20
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

    public function saveLocais(array $locais): void
    {
        foreach ($locais as $local) {
            $this->saveLocal((object)$local);
        }
    }

    public function saveLocal(object $local): void
    {

        $item['loja_id'] = $this->loja->id;
        $item['codigo_local_estoque'] = $local->codigo_local_estoque ?? null;
        $item['codigo'] = $local->codigo ?? null;
        $item['descricao'] = $local->descricao ?? null;
        $item['tipo'] = $local->tipo ?? null;
        $item['padrao'] = $local->padrao ?? null;
        $item['inativo'] = $local->inativo ?? null;
        $item['codigo_cliente'] = $local->codigo_cliente ?? null;
        $item['dispOrdemProducao'] = $local->dispOrdemProducao ?? null;
        $item['dispConsumoOP'] = $local->dispConsumoOP ?? null;
        $item['dispRemessa'] = $local->dispRemessa ?? null;
        $item['dispVenda'] = $local->dispVenda ?? null;
        $item['dInc'] = $local->dInc ?? null;
        $item['hInc'] = $local->hInc ?? null;
        $item['uInc'] = $local->uInc ?? null;
        $item['dAlt'] = $local->dAlt ?? null;
        $item['hAlt'] = $local->hAlt ?? null;
        $item['uAlt'] = $local->uAlt ?? null;

        try {
            LocalEstoque::updateOrCreate(
                [
                    'loja_id' => $this->loja->id,
                    'codigo_local_estoque' => $item['codigo_local_estoque']
                ],
                $item
            );
        } catch (Exception $e) {
            Log::error("Erro ao salvar local de estoque nº: " . $item['codigo_local_estoque'] . ', Loja: ' . $this->loja->nome . $e->getMessage());
        }

    }

    public function webhook(array $data): void
    {
        Log::info('Webhook Local Estoque', $data);
        // if (isset($data['event']['codigo_produto'])) {
        //     $produto = $this->fetchProduto($data['event']['codigo_produto']);
        //     if (isset($produto->codigo_produto)) {
        //         $this->saveProduto($produto);
        //     }
        // }
    }
}
