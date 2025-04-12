<?php

namespace App\Services;

use Carbon\Carbon;
use DateTime;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use stdClass;

class OmieService
{
    private $urlBase = "https://app.omie.com.br/api/";

    public function getNotasFiscais(DateTime $dataInicio, DateTime $dataFinal, $pagina = 1): object
    {

        $url = $this->urlBase . 'v1/produtos/recebimentonfe/';

        $data = [
            "call" => "ListarRecebimentos",
            "app_key" => config('omie.app_key'),
            "app_secret" => config('omie.app_secret'),
            "param" => [
                [
                    "nPagina" => $pagina,
                    "nRegistrosPorPagina" => 50,
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
    }

    public function getOS($os): object
    {

        $url = "https://app.omie.com.br/api/v1/servicos/os/";

        $data = [
            "call" => "ConsultarOS",
            "app_key" => config('omie.app_key'),
            "app_secret" => config('omie.app_secret'),
            "param" => [
                [
                    "cCodIntOS" => "",
                    "nCodOS" => 0,
                    "cNumOS" => $os,

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
                Log::critical('OMIE - getOS - Retorno inexperado', [
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

    public function getOSs($pagina = 1): object
    {

        $url = "https://app.omie.com.br/api/v1/servicos/os/";

        $data = [
            "call" => "ListarOS",
            "app_key" => config('omie.app_key'),
            "app_secret" => config('omie.app_secret'),
            "param" => [
                [
                    "pagina" => $pagina,
                    "registros_por_pagina" => 50,
                    "apenas_importado_api" => "N",
                    "filtrar_por_data_de" => Carbon::now()->subMonths(2)->format('d/m/Y'),
                    "filtrar_por_data_ate" => Carbon::now()->addMonth()->format('d/m/Y'),
                    "filtrar_por_etapa" => "30" // Gerar OS
                ]
            ]
        ];

        try {
            $response = Http::withHeaders([
                'Content-Type' => 'application/json'
            ])->connectTimeout(60)->timeout(60)->post($url, $data);

            if (in_array($response->status(), [200, 500])) {
                return $response->object();
            } else {
                Log::critical('OMIE - getOSs - Retorno inexperado', [
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

    public function getCliente(string $id): object
    {
        $url = "https://app.omie.com.br/api/v1/geral/clientes/";

        $data = [
            "call" => "ConsultarCliente",
            "app_key" => config('omie.app_key'),
            "app_secret" => config('omie.app_secret'),
            "param" => [
                [
                    "codigo_cliente_omie" => $id,
                    "codigo_cliente_integracao" => ""
                ]
            ]
        ];

        try {
            $response = Http::withHeaders([
                'Content-Type' => 'application/json'
            ])->connectTimeout(60)->timeout(60)->post($url, $data);

            if (in_array($response->status(), [200,500])) {
                return $response->object();
            } else {
                Log::critical('OMIE - getCliente - Retorno inexperado', [
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

    // O campo Projeto está sendo utilizado para identificar o Técnico que realizará o serviço.
    public function getProjeto(string $id): object
    {
        $url = "https://app.omie.com.br/api/v1/geral/projetos/";

        $data = [
            "call" => "ConsultarProjeto",
            "app_key" => config('omie.app_key'),
            "app_secret" => config('omie.app_secret'),
            "param" => [
                [
                    "codigo" => $id,
                    "codint" => ""
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
                Log::critical('OMIE - getProjeto - Retorno inexperado', [
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
