<?php

namespace App\Services;

use Carbon\Carbon;
use DateTime;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use stdClass;

class OmieService
{
    private $urlBase = "https://app.omie.com.br/api/";

    public function getConsultarRecebimento($nIdReceb): object
    {
        $url = $this->urlBase . 'v1/produtos/recebimentonfe/';

        $data = [
            "call" => "ConsultarRecebimento",
            "app_key" => config('omie.app_key'),
            "app_secret" => config('omie.app_secret'),
            "param" => [
                [
                    "nIdReceb" => $nIdReceb
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
                Log::critical('OMIE - getNotasFiscais - Retorno inexperado', [
                    'statusCode' => $response->status(),
                    'response' => $response->body(),
                ]);
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

    public function getNotasFiscais(DateTime $dataInicio, DateTime $dataFinal, $pagina = 1): array
    {
        $recebimentos = [];
        $response = $this->getNFes($dataInicio, $dataFinal, $pagina);
        if (isset($response->recebimentos) && count($response->recebimentos) > 0) {
            if ($response->nTotalPaginas == 1) {
                $recebimentos = (array)$response->recebimentos;
            } else {
                $recebimentos = (array)$response->recebimentos;
                for ($i = 2; $i <= $response->nTotalPaginas; $i++) {
                    $recebimentos = array_merge($recebimentos, (array)$this->getNFes($dataInicio, $dataFinal, $i)->recebimentos);
                }
            }
        }
        return $recebimentos;
    }

    private function getNFes(DateTime $dataInicio, DateTime $dataFinal, $pagina = 1): object
    {
        $chave = "getNotasFiscais-" . Carbon::parse($dataInicio)->format('d/m/Y') . '-' . Carbon::parse($dataFinal)->format('d/m/Y') . $pagina;

        return Cache::remember($chave, 3600, function () use ($dataInicio, $dataFinal, $pagina) {
            $url = $this->urlBase . 'v1/produtos/recebimentonfe/';

            $data = [
                "call" => "ListarRecebimentos",
                "app_key" => config('omie.app_key'),
                "app_secret" => config('omie.app_secret'),
                "param" => [
                    [
                        "nPagina" => $pagina,
                        "nRegistrosPorPagina" => 50,
                        "cExibirDetalhes" => "S",
                        "dtAltDe" => Carbon::parse($dataInicio)->format('d/m/Y'),
                        "dtAltAte" => Carbon::parse($dataFinal)->format('d/m/Y'),
                        "hrAltDe" => "00:00:00",
                        "hrAltAte" => "23:59:59",
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
                    Log::critical('OMIE - getNotasFiscais - Retorno inexperado', [
                        'statusCode' => $response->status(),
                        'response' => $response->body(),
                    ]);
                }
            } catch (\Throwable $th) {
                Log::critical($th->getMessage(), [
                    'Code' => $th->getCode(),
                    'File' => $th->getFile(),
                    'Line' => $th->getLine()
                ]);
            }
            return new stdClass();
        });
    }

    //Listar Ordem de Producao
    public function getOrdensPro(DateTime $dataInicio, DateTime $dataFinal, $pagina = 1): array
    {
        $ordenspro = [];
        $response = $this->getOrds($dataInicio, $dataFinal, $pagina);

        if (isset($response->cadastros) && count($response->cadastros) > 0) {
            if ($response->total_de_paginas == 1) {
                $ordenspro = (array)$response->cadastros;
            } else {
                $ordenspro = (array)$response->cadastros;
                for ($i = 2; $i <= $response->total_de_paginas; $i++) {
                    $ordenspro = array_merge($ordenspro, (array)$this->getOrds($dataInicio, $dataFinal, $i)->cadastros);
                }
            }
        }

        return $ordenspro;
    }

    public function getOrds(DateTime $dataInicio, DateTime $dataFinal, $pagina = 1): object
    {
        $chave = "getOrdensPro-" . Carbon::parse($dataInicio)->format('d/m/Y') . '-' . Carbon::parse($dataFinal)->format('d/m/Y') . $pagina;
        return Cache::remember($chave, 3600, function () use ($dataInicio, $dataFinal, $pagina) {
            $url = $this->urlBase . 'v1/produtos/op/';

            $data = [
                "call" => "ListarOrdemProducao",
                "app_key" => config('omie.app_key'),
                "app_secret" => config('omie.app_secret'),
                "param" => [
                    [
                        "pagina" => $pagina,
                        "registros_por_pagina" => 50,
                        "dDtConclusaoDe" => Carbon::parse($dataInicio)->format('d/m/Y'),
                        "dDtConclusaoAte" => Carbon::parse($dataFinal)->format('d/m/Y')
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
                    Log::critical('OMIE - getOrdensPro - Retorno inexperado', [
                        'statusCode' => $response->status(),
                        'response' => $response->body(),
                    ]);
                }
            } catch (\Throwable $th) {
                Log::critical($th->getMessage(), [
                    'Code' => $th->getCode(),
                    'File' => $th->getFile(),
                    'Line' => $th->getLine()
                ]);
            }
            return new stdClass();
        });
    }

    //Consulta Produto
    public function getConsultaProduto(string $codigo_produto): object
    {
        $chave = "ConsultarProduto-" . $codigo_produto;
        return Cache::remember($chave, 3600, function () use ($codigo_produto) {
            $url = $this->urlBase . 'v1/geral/produtos/';

            $data = [
                "call" => "ConsultarProduto",
                "app_key" => config('omie.app_key'),
                "app_secret" => config('omie.app_secret'),
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
                ])->connectTimeout(60)->timeout(60)->post($url, $data);

                if ($response->status() === 200) {
                    return $response->object();
                } else {
                    Log::critical('OMIE - getConsultaProduto - Retorno inexperado', [
                        'statusCode' => $response->status(),
                        'response' => $response->body(),
                    ]);
                }
            } catch (\Throwable $th) {
                Log::critical($th->getMessage(), [
                    'Code' => $th->getCode(),
                    'File' => $th->getFile(),
                    'Line' => $th->getLine()
                ]);
            }
            return new stdClass();
        });
    }
}
