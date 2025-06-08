<?php

namespace App\Services;

use App\Helpers\Constants;
use App\Models\Transferencia;
use Carbon\Carbon;
use DateTime;
use Exception;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use stdClass;

class OmieService
{
    private $urlBase = "https://app.omie.com.br/api/";

    protected $key;
    protected $secret;
    protected $loja_id;

    private function init()
    {
        $user = Auth::user();
        if ($user && $user->loja && $user->loja->omie_app_key !== "" && $user->loja->omie_app_secret !== "") {
            $this->key = $user->loja->omie_app_key;
            $this->secret = $user->loja->omie_app_secret;
            $this->loja_id = $user->loja->id;
        } else {
            throw new Exception("APP_KEY e APP_SECRET não localizados!");
        }
    }

    public function getConsultarRecebimento($nIdReceb): object
    {
        $this->init();
        $chave = "getConsultarRecebimento-" . $this->loja_id . $nIdReceb;
        return Cache::remember($chave, 1800, function () use ($nIdReceb) {
            $url = $this->urlBase . 'v1/produtos/recebimentonfe/';
            $data = [
                "call" => "ConsultarRecebimento",
                "app_key" => $this->key,
                "app_secret" => $this->secret,
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
                } elseif ($response->status() === 500 && stripos($response->object()->faultstring, "Não existem registros para")) {
                    return new stdClass();
                } else {
                    Log::critical('OMIE - getConsultarRecebimento - Retorno inexperado', [
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
        $this->init();
        $chave = "getNFes-" . $this->loja_id . Carbon::parse($dataInicio)->format(Constants::DATE_FORMAT_YMD) . '-' . Carbon::parse($dataFinal)->format(Constants::DATE_FORMAT_YMD) . $pagina;
        return Cache::remember($chave, 1800, function () use ($dataInicio, $dataFinal, $pagina) {
            $url = $this->urlBase . 'v1/produtos/recebimentonfe/';

            $data = [
                "call" => "ListarRecebimentos",
                "app_key" => $this->key,
                "app_secret" => $this->secret,
                "param" => [
                    [
                        "nPagina" => $pagina,
                        "nRegistrosPorPagina" => 50,
                        "cExibirDetalhes" => "S",
                        "dtAltDe" => Carbon::parse($dataInicio)->format(Constants::DATE_FORMAT_PT_BR),
                        "dtAltAte" => Carbon::parse($dataFinal)->format(Constants::DATE_FORMAT_PT_BR),
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
                } elseif ($response->status() === 500 && stripos($response->object()->faultstring, "Não existem registros para")) {
                    return new stdClass();
                } else {
                    Log::critical('OMIE - getNFes - Retorno inexperado', [
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
        $this->init();
        $chave = "getOrds-" . $this->loja_id . Carbon::parse($dataInicio)->format(Constants::DATE_FORMAT_YMD) . '-' . Carbon::parse($dataFinal)->format(Constants::DATE_FORMAT_YMD) . $pagina;
        return Cache::remember($chave, 3600, function () use ($dataInicio, $dataFinal, $pagina) {
            $url = $this->urlBase . 'v1/produtos/op/';
            $data = [
                "call" => "ListarOrdemProducao",
                "app_key" => $this->key,
                "app_secret" => $this->secret,
                "param" => [
                    [
                        "pagina" => $pagina,
                        "registros_por_pagina" => 50,
                        "dDtConclusaoDe" => Carbon::parse($dataInicio)->format(Constants::DATE_FORMAT_PT_BR),
                        "dDtConclusaoAte" => Carbon::parse($dataFinal)->format(Constants::DATE_FORMAT_PT_BR),
                        "ordenar_por" => "dInclusao",
                        "ordem_decrescente" => "S"
                    ]
                ]
            ];

            try {
                $response = Http::withHeaders([
                    'Content-Type' => 'application/json'
                ])->connectTimeout(60)->timeout(60)->post($url, $data);

                if ($response->status() === 200) {
                    return $response->object();
                } elseif ($response->status() === 500 && stripos($response->object()->faultstring, "Não existem registros para")) {
                    return new stdClass();
                } {
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
        $this->init();
        $chave = "getConsultaProduto-" . $this->loja_id . $codigo_produto;
        return Cache::remember($chave, 1800, function () use ($codigo_produto) {
            $url = $this->urlBase . 'v1/geral/produtos/';

            $data = [
                "call" => "ConsultarProduto",
                "app_key" => $this->key,
                "app_secret" => $this->secret,
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
                } elseif ($response->status() === 500 && stripos($response->object()->faultstring, "Não existem registros para")) {
                    return new stdClass();
                } {
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

    public function getConsultaProdutoCodigo(string $codigo): object
    {
        $this->init();
        $chave = "getConsultaProdutoCodigo-" . $this->loja_id . $codigo;
        return Cache::remember($chave, 1800, function () use ($codigo) {
            $url = $this->urlBase . 'v1/geral/produtos/';

            $data = [
                "call" => "ConsultarProduto",
                "app_key" => $this->key,
                "app_secret" => $this->secret,
                "param" => [
                    [
                        "codigo_produto" => 0,
                        "codigo_produto_integracao" => "",
                        "codigo" => $codigo,
                    ]
                ]
            ];

            try {
                $response = Http::withHeaders([
                    'Content-Type' => 'application/json'
                ])->connectTimeout(60)->timeout(60)->post($url, $data);

                if ($response->status() === 200) {
                    return $response->object();
                } elseif ($response->status() === 500 && stripos($response->object()->faultstring, "Não existem registros para")) {
                    return new stdClass();
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


    //Listar Local Estoque
    public function getLocaisEstoque(): array
    {
        $localEstoque = [];
        $response = $this->getLocais();
        if (isset($response->locaisEncontrados) && count($response->locaisEncontrados) > 0) {
            if ($response->nTotPaginas == 1) {
                $localEstoque = (array)$response->locaisEncontrados;
            } else {
                $localEstoque = (array)$response->locaisEncontrados;
                for ($i = 2; $i <= $response->nTotPaginas; $i++) {
                    $localEstoque = array_merge($localEstoque, (array)$this->getLocais($i)->locaisEncontrados);
                }
            }
        }
        return $localEstoque;
    }

    public function getLocais(): object
    {
        $this->init();
        $chave = "getLocais-" . $this->loja_id;
        return Cache::remember($chave, 1800, function () {
            $url = $this->urlBase . 'v1/estoque/local/';
            $data = [
                "call" => "ListarLocaisEstoque",
                "app_key" => $this->key,
                "app_secret" => $this->secret,
                "param" => [
                    [
                        "nPagina" => 1,
                        "nRegPorPagina" => 20

                    ]
                ]
            ];
            try {
                $response = Http::withHeaders([
                    'Content-Type' => 'application/json'
                ])->connectTimeout(60)->timeout(60)->post($url, $data);
                if ($response->status() === 200) {
                    return $response->object();
                } elseif ($response->status() === 500 && stripos($response->object()->faultstring, "Não existem registros para")) {
                    return new stdClass();
                } else {
                    Log::critical('OMIE - getLocais - Retorno inexperado', [
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

    public function createTransferencia(Transferencia $transferencia): object
    {
        $this->init();
        $url = $this->urlBase . 'v1/estoque/ajuste/';
        $data = [
            "call" => "IncluirAjusteEstoque",
            "app_key" => $this->key,
            "app_secret" => $this->secret,
            "param" => [
                [
                    "codigo_local_estoque" => $transferencia->local_origem_id,
                    "id_prod" => $transferencia->produto_id,
                    "data" => $transferencia->data,
                    "quan" => $transferencia->quantidade,
                    "obs" => "NTB - Estoque #{$transferencia->id}",
                    "origem" => "AJU",
                    "tipo" => "TRF",
                    "motivo" => $transferencia->motivo,
                    "valor" => $transferencia->valor_unitario
                ]
            ]
        ];
        try {
            $response = Http::withHeaders([
                'Content-Type' => 'application/json'
            ])->connectTimeout(60)->timeout(60)->post($url, $data);
            if ($response->status() === 200) {
                return $response->object();
            } elseif ($response->status() === 500 && stripos($response->object()->faultstring, "Não existem registros para")) {
                return new stdClass();
            } else {
                Log::critical('OMIE - createTransferencia - Retorno inexperado', [
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
}
