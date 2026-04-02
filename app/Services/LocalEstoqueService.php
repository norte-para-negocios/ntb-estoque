<?php

namespace App\Services;

use App\Enums\SincronizacaoStatus;
use App\Events\NotificaUserEvent;
use App\Jobs\UpdateOmieLocalData\LocalEstoqueUpdateJob;
use App\Models\LocalEstoque;
use App\Models\Loja;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use stdClass;
use Throwable;

class LocalEstoqueService
{
    use IntegrationAttemptsTrait;

    private $urlBase = 'https://app.omie.com.br/api/';

    public function __construct(protected Loja $loja) {}

    public function fetchAll($lastPages = 0): void
    {
        if ($this->loja->local_estoque_status !== SincronizacaoStatus::Processando) {
            // Aciona a Variavel de Controle
            $this->loja->local_estoque_status = SincronizacaoStatus::Processando;
            $this->loja->save();
            $first = $this->fetchPage(1);
            $total = $lastPages > 0 ? $lastPages : ($first->nTotPaginas ?? 1);
            $jobs = [];
            for ($i = 1; $i <= $total; $i++) {
                $jobs[] = new LocalEstoqueUpdateJob($this->loja, $i);
            }
            // Dispara o batch
            Bus::batch($jobs)
                ->then(function () {
                    // Todos os Jobs concluídos com sucesso
                    $this->loja->local_estoque_ultima_atualizacao = date('Y-m-d H:i:s');
                    $this->loja->local_estoque_status = SincronizacaoStatus::Concluido;
                    $this->loja->save();
                    if (auth()->check()) {
                        broadcast(new NotificaUserEvent(auth()->user(), 'success', "Locais de Estoque da loja {$this->loja->nome},  atualizados com sucesso!"));
                    }
                })
                ->catch(function (Throwable $e) {
                    // Algum Job falhou — você pode logar ou tratar aqui
                    $this->loja->local_estoque_status = SincronizacaoStatus::Erro;
                    $this->loja->save();
                })
                ->finally(function () {
                    // Executado sempre, mesmo com falhas
                })
                ->dispatch();
        }
    }

    public function fetchPage($pagina = 1): object
    {
        $url = $this->urlBase.'v1/estoque/local/';
        $data = [
            'call' => 'ListarLocaisEstoque',
            'app_key' => $this->loja->omie_app_key,
            'app_secret' => $this->loja->omie_app_secret,
            'param' => [
                [
                    'nPagina' => $pagina,
                    'nRegPorPagina' => 1000,
                ],
            ],
        ];

        // Inicializando Log de integração
        $this->loja_id = $this->loja->id;
        $this->model = 'LocalEstoque';
        $this->request = json_encode(['method' => 'POST', 'path' => $url, 'payload' => $data]);
        $this->beforeAttemptLog();
        try {
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
            }

            return new stdClass;
        } finally {
            $this->afterAttemptLog();
        }
    }

    public function saveLocais(array $locais): void
    {
        foreach ($locais as $local) {
            $this->saveLocal((object) $local);
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
                    'codigo_local_estoque' => $item['codigo_local_estoque'],
                ],
                $item
            );
        } catch (Throwable $th) {
            Log::error('Erro ao salvar local-estoque de estoque nº: '.$item['codigo_local_estoque'].', Loja: '.$this->loja->nome.$th->getMessage());
        }

    }

    public function deleteLocal(object $local): void
    {
        try {
            LocalEstoque::where('loja_id', $this->loja->id)
                ->where('codigo_local_estoque', $local->codigo_local_estoque)
                ->delete();
        } catch (Throwable $th) {
            Log::error('Erro ao excluir local-estoque de estoque nº: '.$local->codigo_local_estoque.', Loja: '.$this->loja->nome.$th->getMessage());
        }
    }
}
