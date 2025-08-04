<?php

namespace App\Services;

use App\Models\Loja;
use App\Models\Produto;
use Exception;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use stdClass;

class ProdutoService
{
    private $urlBase = "https://app.omie.com.br/api/";

    public function __construct(protected Loja $loja) {}

    public function fetchAll($lastPages = 0): void
    {
        $response = $this->fetchPage(1);
        if (isset($response->produto_servico_cadastro) && count($response->produto_servico_cadastro) > 0) {
            $this->saveProdutos((array)$response->produto_servico_cadastro);
            if (($response->total_de_paginas > 1) && ($lastPages > 1 || $lastPages == 0)) {
                for ($i = 2; $i <= ($lastPages > 0 ? $lastPages : $response->total_de_paginas); $i++) {
                    $resp = $this->fetchPage($i);
                    if (isset($resp->produto_servico_cadastro) && count($resp->produto_servico_cadastro) > 0) {
                        $this->saveProdutos((array)$resp->produto_servico_cadastro);
                    }
                }
            }
        }
    }

    public function fetchPage($pagina = 1): object
    {
        $url = $this->urlBase . 'v1/geral/produtos/';
        $data = [
            "call" => "ListarProdutos",
            "app_key" => $this->loja->omie_app_key,
            "app_secret" => $this->loja->omie_app_secret,
            "param" => [
                [
                    "pagina" => $pagina,
                    "registros_por_pagina" => 500,
                    "apenas_importado_api" => "N",
                    "filtrar_apenas_omiepdv" => "N",
                    "ordem_decrescente" => "S",
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

    public function saveProdutos(array $produtos): void
    {
        foreach ($produtos as $produto) {
            $this->saveProduto((object)$produto);
        }
    }

    public function saveProduto(object $produto): void
    {
        $prod['loja_id'] = $this->loja->id;
        $prod['codigo_produto'] = $produto->codigo_produto ?? null;
        $prod['codigo'] = $produto->codigo ?? null;
        $prod['descricao'] = $produto->descricao ?? null;
        $prod['codigo_familia'] = $produto->codigo_familia ?? null;
        $prod['descricao_familia'] = $produto->descricao_familia ?? null;
        $prod['tipo_item'] = $produto->tipoItem ?? null;
        $prod['unidade'] = $produto->unidade ?? null;
        $prod['valor_unitario'] = $produto->valor_unitario ?? null;

        $prod['full_object'] = json_encode($produto);

        try {
            Produto::updateOrCreate(
                [
                    'loja_id' => $this->loja->id,
                    'codigo_produto' => $prod['codigo_produto']
                ],
                $prod
            );
        } catch (Exception $e) {
            Log::error("Erro ao salvar produto nº: " . $prod['codigo_produto'] . ', Loja: ' . $this->loja->nome . $e->getMessage());
        }
    }

    public function fetchProduto(string $codigo_produto): object
    {
        $url = $this->urlBase . 'v1/geral/produtos/';
        $data = [
            "call" => "ConsultarProduto",
            "app_key" => $this->loja->omie_app_key,
            "app_secret" => $this->loja->omie_app_secret,
            "param" => [
                [
                    "codigo_produto" => $codigo_produto,
                    "codigo_produto_integracao" => "",
                    "codigo" => "",
                ]
            ]
        ];
        try {
            $response = Http::withHeaders([
                'Content-Type' => 'application/json'
            ])->timeout(60)->post($url, $data);
            if ($response->status() === 200) {
                return $response->object();
            }
        } finally {
            // Evitar qualquer erro.
        }
        return new stdClass();
    }

    public function webhook(array $data): void
    {
        Log::debug('ProdutoService Webhook', $data);
        if (isset($data['event']['codigo_produto'])) {
            $produto = $this->fetchProduto($data['event']['codigo_produto']);
            if (isset($produto->codigo_produto)) {
                $this->saveProduto($produto);
            }
        }
    }
}
