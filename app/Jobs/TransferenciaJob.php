<?php

namespace App\Jobs;

use App\Events\NotificaAllEvent;
use App\Events\NotificaUserEvent;
use App\Models\LocalEstoque;
use App\Models\Movimento;
use App\Models\Produto;
use App\Models\User;
use App\Services\IntegrationAttemptsTrait;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class TransferenciaJob implements ShouldQueue
{
    use Queueable, IntegrationAttemptsTrait;

    /**
     * Create a new job instance.
     */
    public function __construct(protected User $user, protected Movimento $movimento)
    {
        $this->movimento->status = 'Processando';
        $this->movimento->save();
    }

    /**
     * Execute the job.
     */
    public function handle(): void
    {
        $response = $this->createTransferencia($this->movimento);

        $produto = Produto::where('loja_id', $this->movimento->loja_id)->where('codigo_produto', $this->movimento->id_prod)->first();
        $localOrigem = LocalEstoque::where('loja_id', $this->movimento->loja_id)->where('codigo_local_estoque', $this->movimento->codigo_local_estoque)->first();
        $localDestino = LocalEstoque::where('loja_id', $this->movimento->loja_id)->where('codigo_local_estoque', $this->movimento->codigo_local_estoque_destino)->first();

        if ($response) {
            $this->movimento->codigo_status = $response->codigo_status;
            $this->movimento->descricao_status = $response->descricao_status;
            $this->movimento->id_movest = $response->id_movest;
            $this->movimento->id_ajuste = $response->id_ajuste;
            $this->movimento->status = 'Concluído';

            broadcast(new NotificaUserEvent($this->user, "success", "Transferência do produto {$produto->descricao}, do estoque {$localOrigem->descricao} para {$localDestino->descricao}, concluída!"));
        } else {
            $this->movimento->status = 'Erro';
            broadcast(new NotificaUserEvent($this->user, "error", "Não foi possível concluir a transferência do produto {$produto->descricao}, do estoque {$localOrigem->descricao} para {$localDestino->descricao}, tentaremos novamente logo mais, só aguardar!"));
        }
        $this->movimento->save();
    }

    private function createTransferencia(Movimento $movimento): null|object
    {
        $loja = $movimento->loja;
        $url = 'https://app.omie.com.br/api/v1/estoque/ajuste/';
        $data = [
            "call" => "IncluirAjusteEstoque",
            "app_key" => $loja->omie_app_key,
            "app_secret" => $loja->omie_app_secret,
            "param" => [
                [
                    "codigo_local_estoque" => $movimento->codigo_local_estoque,
                    "id_prod" => $movimento->id_prod,
                    "cod_int_ajuste" => $movimento->id,
                    "data" => $movimento->data->format('d/m/Y'),
                    "quan" => $movimento->quan,
                    "valor" => $movimento->valor == 0 ? 0.01 : $movimento->valor,
                    "obs" => $movimento->obs ?? "NTB - Estoque #{$movimento->id}",
                    "origem" => $movimento->origem,
                    "tipo" => $movimento->tipo,
                    "motivo" => $movimento->motivo,
                    "codigo_local_estoque_destino" => $movimento->codigo_local_estoque_destino,
                ]
            ]
        ];
        // Inicializando Log de integração
        $this->loja_id = $loja->id;
        $this->model = 'Movimento';
        $this->request = json_encode(['method' => 'POST', 'path' => $url, 'payload' => $data]);
        $this->beforeAttemptLog();
        try {
            try {
                $response = Http::withHeaders([
                    'Content-Type' => 'application/json'
                ])->connectTimeout(60)->timeout(60)->post($url, $data);

                // Log de integração
                $this->response = $response->getBody()->getContents();
                $this->code = $response->getStatusCode();

                if ($response->status() === 200) {
                    return $response->object();
                } else {
                    $movimento->response = $response->body();
                    $movimento->save();
                }
            } catch (\Throwable $th) {
                // Log de erro.
                $this->error_message = json_encode($th->getMessage());
                $this->code = $th->getCode();
                $this->error = true;
                Log::critical($th->getMessage(), [
                    'Code' => $th->getCode(),
                    'File' => $th->getFile(),
                    'Line' => $th->getLine()
                ]);
            }
        } finally {
            $this->afterAttemptLog();
        }
        return null;
    }
}
