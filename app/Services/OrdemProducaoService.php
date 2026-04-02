<?php

namespace App\Services;

use App\Enums\SincronizacaoStatus;
use App\Events\NotificaUserEvent;
use App\Helpers\Constants;
use App\Jobs\UpdateOmieLocalData\OrdemProducaoUpdateJob;
use App\Models\Loja;
use App\Models\OrdemProducao;
use App\Models\Produto;
use Carbon\Carbon;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use stdClass;
use Throwable;

class OrdemProducaoService
{
    use IntegrationAttemptsTrait;

    private string $urlBase = 'https://app.omie.com.br/api/';

    public function __construct(protected Loja $loja) {}

    public function fetchAll($lastPages = 0, $dataIni = '', $dataFim = ''): void
    {
        if ($this->loja->ordem_producao_status !== SincronizacaoStatus::Processando) {
            // Aciona a Variavel de Controle
            $this->loja->ordem_producao_status = SincronizacaoStatus::Processando;
            $this->loja->save();
            $first = $this->fetchPage(1, $dataIni, $dataFim);
            $total = $lastPages > 0 ? $lastPages : ($first->total_de_paginas ?? 1);
            $jobs = [];
            for ($i = 1; $i <= $total; $i++) {
                $jobs[] = new OrdemProducaoUpdateJob($this->loja, $i);
            }
            // Dispara o batch
            Bus::batch($jobs)
                ->then(function () {
                    // Todos os Jobs concluídos com sucesso
                    $this->loja->ordem_producao_ultima_atualizacao = date('Y-m-d H:i:s');
                    $this->loja->ordem_producao_status = SincronizacaoStatus::Concluido;
                    $this->loja->save();
                    if (auth()->check()) {
                        broadcast(new NotificaUserEvent(auth()->user(), 'success', "Ordens de Produção da loja {$this->loja->nome}, atualizadas com sucesso!"));
                    }
                })
                ->catch(function (Throwable $e) {
                    Log::error('Falha ao processar atualização das Ordens de Produção', [
                        'erro' => $e->getMessage(),
                        'Loja' => $this->loja->nome,
                    ]);
                    $this->loja->ordem_producao_status = SincronizacaoStatus::Erro;
                    $this->loja->save();
                })
                ->finally(function () {
                    // Executado sempre, mesmo com falhas
                })
                ->onQueue('ordemproducao')
                ->dispatch();

        }
    }

    public function fetchPage($pagina = 1, $dataIni = '', $dataFim = ''): object
    {
        $url = $this->urlBase.'v1/produtos/op/';
        $data = [
            'call' => 'ListarOrdemProducao',
            'app_key' => $this->loja->omie_app_key,
            'app_secret' => $this->loja->omie_app_secret,
            'param' => [
                [
                    'pagina' => $pagina,
                    'registros_por_pagina' => 500,
                    'ordem_decrescente' => 'S',
                    'ordenar_por' => 'dConclusao',
                ],
            ],
        ];

        if (($dataIni !== '') && ($dataFim !== '')) {
            $data['param']['dDtConclusaoDe'] = $dataIni;
            $data['param']['dDtConclusaoAte'] = $dataFim;
        }

        // Inicializando Log de integração
        $this->loja_id = $this->loja->id;
        $this->model = 'OrdemProducao';
        $this->request = json_encode(['method' => 'POST', 'path' => $url, 'payload' => $data]);
        $this->beforeAttemptLog();

        try {
            $response = Http::withHeaders([
                'Content-Type' => 'application/json',
            ])->post($url, $data);

            // Log de integração
            $this->response = $response->getBody()->getContents();
            $this->code = $response->getStatusCode();

            if ($response->status() === 200) {
                return $response->object();
            } elseif ($response->status() === 429) {
                $this->error = true;
                $this->code = 429;
                throw new \RuntimeException("Omie API rate limited (HTTP 429) na página {$pagina}");
            } elseif ($response->status() === 500) {
                return new stdClass;
            }
        } catch (Throwable $th) {
            // Log de erro.
            $this->integrationAttempt->error_message = json_encode($th->getMessage());
            $this->code = $th->getCode();
            $this->error = true;

        } finally {
            $this->afterAttemptLog();
        }

        return new stdClass;
    }

    public function fetchOrdemProducao(int $nCodOP): object
    {
        $url = $this->urlBase.'v1/produtos/op/';
        $data = [
            'call' => 'ConsultarOrdemProducao',
            'app_key' => $this->loja->omie_app_key,
            'app_secret' => $this->loja->omie_app_secret,
            'param' => [
                [
                    'cCodIntOP' => '',
                    'nCodOP' => $nCodOP,
                ],
            ],
        ];

        // Inicializando Log de integração
        $this->loja_id = $this->loja->id;
        $this->model = 'OrdemProducao';
        $this->request = json_encode(['method' => 'POST', 'path' => $url, 'payload' => $data]);
        $this->beforeAttemptLog();

        try {
            $response = Http::withHeaders([
                'Content-Type' => 'application/json',
            ])->post($url, $data);

            // Log de integração
            $this->response = $response->getBody()->getContents();
            $this->code = $response->getStatusCode();

            if ($response->status() === 200) {
                return $response->object();
            } elseif ($response->status() === 500) {
                return new stdClass;
            }
        } catch (Throwable $th) {
            // Log de erro.
            $this->integrationAttempt->error_message = json_encode($th->getMessage());
            $this->code = $th->getCode();
            $this->error = true;
        } finally {
            $this->afterAttemptLog();
        }

        return new stdClass;
    }

    public function concluirOrdemProducao(int $nCodOP, string $dataConclusao, float $quantidade, string $observacao): object
    {
        $url = $this->urlBase.'v1/produtos/op/';
        $data = [
            'call' => 'ConcluirOrdemProducao',
            'app_key' => $this->loja->omie_app_key,
            'app_secret' => $this->loja->omie_app_secret,
            'param' => [
                [
                    'cCodIntOP' => '',
                    'nCodOP' => $nCodOP,
                    'dDtConclusao' => $dataConclusao,
                    'nQtdeProduzida' => $quantidade,
                    'cObsConclusao' => $observacao,
                ],
            ],
        ];

        // Inicializando Log de integração
        $this->loja_id = $this->loja->id;
        $this->model = 'OrdemProducao';
        $this->request = json_encode(['method' => 'POST', 'path' => $url, 'payload' => $data]);
        $this->beforeAttemptLog();

        try {
            $response = Http::withHeaders([
                'Content-Type' => 'application/json',
            ])->post($url, $data);

            // Log de integração
            $this->response = $response->getBody()->getContents();
            $this->code = $response->getStatusCode();

            if ($response->status() === 200) {
                return $response->object();
            } elseif ($response->status() === 500) {
                return new stdClass;
            }
        } catch (Throwable $th) {
            // Log de erro.
            $this->integrationAttempt->error_message = json_encode($th->getMessage());
            $this->code = $th->getCode();
            $this->error = true;
        } finally {
            $this->afterAttemptLog();
        }

        return new stdClass;
    }

    public function saveOrdensProducao(array $ordens): void
    {
        foreach ($ordens as $ordem) {
            $this->saveOrdemProducao((object) $ordem);
        }
    }

    public function saveOrdemProducao(object $ordem): void
    {
        if (isset($ordem->identificacao)) {
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
                        'identificacao_n_cod_op' => $op['identificacao_n_cod_op'],
                    ],
                    $op
                );
            } catch (Throwable $th) {
                Log::error('Erro ao salvar ordem de produção nº: '.$op['num_ordem'].', Loja: '.$this->loja->nome.$th->getMessage());
            }
        }
    }

    public function deleteOrdemProducao(array $ordem): void
    {
        try {
            OrdemProducao::where('loja_id', $this->loja->id)
                ->where('identificacao_n_cod_op', $ordem['nCodOP'])
                ->delete();
        } catch (Throwable $th) {
            Log::error('Erro ao excluir ordem de produção nº: '.$ordem['nCodOP'].', Loja: '.$this->loja->nome.$th->getMessage());
        }
    }
}
