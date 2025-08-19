<?php

namespace App\Services;

use App\Helpers\Constants;
use App\Models\Loja;
use App\Models\OrdemProducao;
use Carbon\Carbon;
use Exception;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use stdClass;

class OrdemProducaoService
{
    use IntegrationAttemptsTrait;

    private $urlBase = "https://app.omie.com.br/api/";

    public function __construct(protected Loja $loja)
    {
    }

    public function fetchAll($lastPages = 0): void
    {
        $response = $this->fetchPage(1);
        if (isset($response->cadastros) && count($response->cadastros) > 0) {
            $this->saveOrdensProducao((array)$response->cadastros);
            if (($response->total_de_paginas > 1) && ($lastPages > 1 || $lastPages == 0)) {
                for ($i = 2; $i <= ($lastPages > 0 ? $lastPages : $response->total_de_paginas); $i++) {
                    $resp = $this->fetchPage($i);
                    if (isset($resp->cadastros) && count($resp->cadastros) > 0) {
                        $this->saveOrdensProducao((array)$resp->cadastros);
                    }
                }
            }
        }
    }

    public function fetchPage($pagina = 1): object
    {
        $url = $this->urlBase . 'v1/produtos/op/';
        $data = [
            "call" => "ListarOrdemProducao",
            "app_key" => $this->loja->omie_app_key,
            "app_secret" => $this->loja->omie_app_secret,
            "param" => [
                [
                    "pagina" => $pagina,
                    "registros_por_pagina" => 1000,
                    "ordem_decrescente" => "S"
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

    public function fetchOrdemProducao(int $nCodOP): object
    {
        $url = $this->urlBase . 'v1/produtos/op/';
        $data = [
            "call" => "ConsultarOrdemProducao",
            "app_key" => $this->loja->omie_app_key,
            "app_secret" => $this->loja->omie_app_secret,
            "param" => [
                [
                    "cCodIntOP" => "",
                    "nCodOP" => $nCodOP
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

    public function saveOrdensProducao(array $ordens): void
    {
        foreach ($ordens as $ordem) {
            $this->saveOrdemProducao((object)$ordem);
        }
    }

    public function saveOrdemProducao(object $ordem): void
    {
        $op['loja_id'] = $this->loja->id;
        $op['num_ordem'] = $ordem->identificacao->cNumOP ?? null;
        $op['identificacao_n_cod_op'] = $ordem->identificacao->nCodOP ?? null;
        $op['identificacao_c_cod_int_op'] = $ordem->identificacao->cCodIntOP ?? null;
        $op['identificacao_c_num_op'] = $ordem->identificacao->cNumOP ?? null;
        $op['identificacao_n_cod_produto'] = $ordem->identificacao->nCodProduto ?? null;
        $op['identificacao_c_cod_int_prod'] = $ordem->identificacao->cCodIntProd ?? null;
        $op['identificacao_d_dt_previsao'] = $ordem->identificacao->dDtPrevisao ? Carbon::createFromFormat(Constants::DATE_FORMAT_PT_BR, $ordem->identificacao->dDtPrevisao) : null;
        $op['identificacao_n_qtde'] = $ordem->identificacao->nQtde ?? null;
        $op['identificacao_codigo_local_estoque'] = $ordem->identificacao->codigo_local_estoque ?? null;
        $op['adicionais_c_etapa'] = $ordem->infAdicionais->cEtapa ?? null;
        $op['adicionais_n_cod_projeto'] = $ordem->infAdicionais->nCodProjeto ?? null;
        $op['adicionais_d_dt_inicio'] = $ordem->infAdicionais->dDtInicio ? Carbon::createFromFormat(Constants::DATE_FORMAT_PT_BR, $ordem->infAdicionais->dDtInicio) : null;
        $op['adicionais_d_dt_conclusao'] = $ordem->infAdicionais->dDtConclusao ? Carbon::createFromFormat(Constants::DATE_FORMAT_PT_BR, $ordem->infAdicionais->dDtConclusao) : null;

        $produto = Produto::where('loja_id', $this->loja->id)->where('codigo_produto', $ordem->identificacao->nCodProduto)->first();

        $op['produto_codigo'] = $produto->codigo ?? null;
        $op['produto_descricao'] = $produto->descricao ?? null;
        $op['produto_tipo_item'] = $produto->tipo_item ?? null;
        $op['produto_unidade'] = $produto->unidade ?? null;

        $op['full_object'] = json_encode($ordem);

        try {
            OrdemProducao::updateOrCreate(
                [
                    'loja_id' => $this->loja->id,
                    'identificacao_n_cod_op' => $op['identificacao_n_cod_op']
                ],
                $op
            );
        } catch (Exception $e) {
            Log::error("Erro ao salvar ordem de produção nº: " . $op['num_ordem'] . ', Loja: ' . $this->loja->nome . $e->getMessage());
        }
    }

    public function deleteOrdemProducao(array $ordem): void
    {
        try {
            OrdemProducao::where('loja_id', $this->loja->id)
                ->where('identificacao_n_cod_op', $ordem->nCodOP)
                ->delete();
        } catch (Exception $e) {
            Log::error("Erro ao excluir ordem de produção nº: " . $ordem->nCodOP . ', Loja: ' . $this->loja->nome . $e->getMessage());
        }
    }
}
