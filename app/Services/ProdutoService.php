<?php

namespace App\Services;

use App\Jobs\ProdutoUpdateJob;
use App\Models\Loja;
use App\Models\Produto;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use stdClass;

class ProdutoService
{
    use IntegrationAttemptsTrait;

    private $urlBase = "https://app.omie.com.br/api/";

    public function __construct(protected Loja $loja)
    {
    }

    public function fetchAll($lastPages = 0): void
    {
        $first = $this->fetchPage(1);
        $total = $lastPages > 0 ? $lastPages : ($first->total_de_paginas ?? 1);

        // Dispara um Job para cada página
        for ($i = 1; $i <= $total; $i++) {
            ProdutoUpdateJob::dispatch($this->loja, $i);
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

        // Inicializando Log de integração
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
            } catch (\Throwable $th) {
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
        } catch (\Throwable $th) {
            Log::error("Erro ao salvar produto nº: " . $prod['codigo_produto'] . ', Loja: ' . $this->loja->nome . $th->getMessage());
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

        // Inicializando Log de integração
        $this->request = json_encode(['method' => 'POST', 'path' => $url, 'payload' => $data]);
        $this->beforeAttemptLog();

        try {
            try {
                $response = Http::withHeaders([
                    'Content-Type' => 'application/json'
                ])->timeout(60)->post($url, $data);

                // Log de integração
                $this->response = $response->getBody()->getContents();
                $this->code = $response->getStatusCode();

                if ($response->status() === 200) {
                    return $response->object();
                }
            } catch (\Throwable $th) {
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

    public function deleteProduto(object $produto): void
    {
        try {
            Produto::where('loja_id', $this->loja->id)
                ->where('codigo_produto', $produto->codigo_produto)
                ->delete();
        } catch (\Throwable $th) {
            Log::error("Erro ao excluir produto nº: " . $produto->codigo_produto . ', Loja: ' . $this->loja->nome . $th->getMessage());
        }
    }
}
