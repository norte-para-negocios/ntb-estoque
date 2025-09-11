<?php

namespace App\Console\Commands;

use App\Jobs\InventarioJob;
use App\Models\InventarioItem;
use App\Models\Loja;
use App\Services\IntegrationAttemptsTrait;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;

class RecalculaCustoMedioCommand extends Command
{
    use IntegrationAttemptsTrait;

    protected $signature = 'recalcula:custo-medio {loja} {produtoCodigoProduto}';

    protected $description = 'Recalcula o que foi forçado com 0,01';

    public function handle(): void
    {
        $loja = Loja::findOrFail($this->argument('loja'));

        $inventarioItems = InventarioItem::join('inventarios', 'inventarios.id', '=', 'inventario_items.inventario_id')
            ->where('inventario_items.loja_id', $loja->id)
            ->where('inventario_items.produto_codigo_produto', $this->argument('produtoCodigoProduto'))
            ->where('inventario_items.id_ajuste', '>', 0)
            ->where('inventario_items.valor', '=', 0.01)
            ->select('inventario_items.*', 'inventarios.data')
            ->orderBy('inventarios.data')
            ->get();

        foreach ($inventarioItems as $inventarioItem) {
            $movimentos = $this->listarMovimentoEstoque(

                $loja,
                $inventarioItem->produto_codigo_produto,
                Carbon::parse($inventarioItem->data)->subYears(3)->format('d/m/Y'),
                Carbon::parse($inventarioItem->data)->format('d/m/Y')
            );

            if (isset($movimentos->movProdutoListar)) {
                foreach (array_reverse($movimentos->movProdutoListar) as $movimento) {
                    if (floatval($movimento->cmc) > 0.01) {

                        //Excluir
                        //Processa o JOB de Inventário Novamente

                        if ($inventarioItem->id_ajuste > 0) {
                            $loja = $inventarioItem->inventario->loja;
                            $url = 'https://app.omie.com.br/api/v1/estoque/ajuste/';
                            $data = [
                                "call" => "ExcluirAjusteEstoque",
                                "app_key" => $loja->omie_app_key,
                                "app_secret" => $loja->omie_app_secret,
                                "param" => [
                                    [
                                        "id_ajuste" => $inventarioItem->id_ajuste,
                                    ]
                                ]
                            ];
                            Http::withHeaders([
                                'Content-Type' => 'application/json'
                            ])->connectTimeout(60)->timeout(60)->post($url, $data);
                        }

                        $inventarioItem->update([
                            'response' => null,
                            'codigo_status' => null,
                            'descricao_status' => null,
                            'id_movest' => null,
                            'id_ajuste' => null,
                            'status' => null,
                            'valor' => floatval($movimento->cmc),
                        ]);

                        InventarioJob::dispatch($inventarioItem->inventario, auth()->user());
                    }
                }
            }
        }
    }

    private function listarMovimentoEstoque($loja, $idProd, $dDtInicial, $dDtFinal)
    {
        $url = 'https://app.omie.com.br/api/v1/estoque/consulta/';
        $data = [
            "call" => "ListarMovimentoEstoque",
            "app_key" => $loja->omie_app_key,
            "app_secret" => $loja->omie_app_secret,
            "param" => [
                [
                    "nPagina" => 1,
                    "nRegPorPagina" => 1000,
                    "codigo_local_estoque" => "",
                    "idProd" => $idProd,
                    "dDtInicial" => $dDtInicial,
                    "dDtFinal" => $dDtFinal,
                    "lista_local_estoque" => 'TODOS',
                ]
            ]
        ];

        // Inicializando Log de integração
        $this->loja_id = $loja->id;
        $this->model = 'ListarMovimentoEstoque';
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
                    return new \stdClass();
                }
            } catch (\Throwable $th) {
                // Log de erro.
                $this->error_message = json_encode($th->getMessage());
                $this->code = $th->getCode();
                $this->error = true;
            }
            return new \stdClass();
        } finally {
            $this->afterAttemptLog();
        }
    }
}
