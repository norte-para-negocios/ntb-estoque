<?php

namespace App\Services;

use App\Events\NotificaUserEvent;
use App\Jobs\UpdateOmieLocalData\NotaFiscalUpdateJob;
use App\Models\Loja;
use App\Models\NotaFiscal;
use App\Models\NotaFiscalItem;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use stdClass;

class NotaFiscalService
{
    use IntegrationAttemptsTrait;

    private $urlBase = "https://app.omie.com.br/api/";

    public function __construct(protected Loja $loja)
    {
    }

    public function fetchAll($lastPages = 0, $dataIni = '', $dataFim = ''): void
    {
        if ($this->loja->nota_fiscal_status !== 'Processando') {
            // Aciona a Variavel de Controle
            $this->loja->nota_fiscal_status = 'Processando';
            $this->loja->save();
            $first = $this->fetchPage(1, $dataIni = '', $dataFim = '');
            $total = $lastPages > 0 ? $lastPages : ($first->nTotalPaginas ?? 1);
            $jobs = [];
            for ($i = 1; $i <= $total; $i++) {
                $jobs[] = new NotaFiscalUpdateJob($this->loja, $i, $dataIni = '', $dataFim = '')->onQueue('nf');
            }
            // Dispara o batch
            Bus::batch($jobs)
                ->then(function () {
                    // Todos os Jobs concluídos com sucesso
                    $this->loja->nota_fiscal_ultima_atualizacao = date('Y-m-d H:i:s');
                    $this->loja->nota_fiscal_status = 'Concluído';
                    $this->loja->save();
                    foreach (User::where('perfil', 'Admin')->get() as $user) {
                        broadcast(new NotificaUserEvent($user, "success", "Notas fiscais da loja {$this->loja->nome}, atualizada com sucesso!"));
                    }
                })
                ->catch(function (Throwable $e) {
                    // Algum Job falhou — você pode logar ou tratar aqui
                    $this->loja->nota_fiscal_status = 'Erro';
                    $this->loja->save();
                })
                ->finally(function () {
                    // Executado sempre, mesmo com falhas
                })
                ->onQueue('notafiscal')
                ->dispatch();

        }
    }

    public function fetchPage($pagina = 1, $dataIni = '', $dataFim = ''): object
    {
        $url = $this->urlBase . 'v1/produtos/recebimentonfe/';
        $data = [
            "call" => "ListarRecebimentos",
            "app_key" => $this->loja->omie_app_key,
            "app_secret" => $this->loja->omie_app_secret,
            "param" => [
                [
                    "nPagina" => $pagina,
                    "nRegistrosPorPagina" => 100,
                    "cExibirDetalhes" => "S"
                ]
            ]
        ];

        if (($dataIni !== '') && ($dataFim !== '')) {
            $data["param"]["dtAltDe"] = $dataIni;
            $data["param"]["dtAltAte"] = $dataFim;
        }

        // Inicializando Log de integração
        $this->loja_id = $this->loja->id;
        $this->model = 'NotaFiscal';
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
                } elseif ($response->status() === 425) {
                    $data = $response->object();
                    preg_match('/em (\d+) segundos/', $data->faultstring, $matches);
                    if (isset($matches[1])) {
                        sleep((int)$matches[1]);
                        foreach (User::where('perfil', 'Admin')->get() as $user) {
                            broadcast(new NotificaUserEvent($user, "error", "A API de Notas Fiscais da loja: {$this->loja->nome}, retorno a seguinte mensagem de erro: {$data->faultstring}!"));
                        }
                    }
                    return new stdClass();
                } elseif ($response->status() === 500) {
                    return new stdClass();
                }
            } catch (\Throwable $th) {
                // Log de erro.
                $this->error_message = json_encode($th->getMessage());
                $this->code = $th->getCode();
                $this->error = true;
            }
        } finally {
            $this->afterAttemptLog();
        }
    }

    public function saveNotasFiscais(array $notasFiscais): void
    {
        foreach ($notasFiscais as $notaFiscal) {
            $this->saveNotaFiscal((object)$notaFiscal);
        }
    }

    public function saveNotaFiscal(object $notaFiscal): void
    {
        $item['loja_id'] = $this->loja->id;
        $item['n_id_receb'] = $notaFiscal->cabec->nIdReceb ?? null;
        $item['n_id_fornecedor'] = $notaFiscal->cabec->nIdFornecedor ?? null;
        $item['c_pessoa_fisica'] = $notaFiscal->cabec->cPessoaFisica ?? null;
        $item['c_nome'] = $notaFiscal->cabec->cNome ?? null;
        $item['c_razao_social'] = $notaFiscal->cabec->cRazaoSocial ?? null;
        $item['c_inscricao'] = $notaFiscal->cabec->cInscricao ?? null;
        $item['c_cnpj_cpf'] = $notaFiscal->cabec->cCNPJ_CPF ?? null;
        $item['c_chave_nfe'] = $notaFiscal->cabec->cChaveNfe ?? null;
        $item['c_etapa'] = $notaFiscal->cabec->cEtapa ?? null;
        $item['c_numero_nfe'] = $notaFiscal->cabec->cNumeroNFe ?? null;
        $item['c_serie_nfe'] = $notaFiscal->cabec->cSerieNFe ?? null;
        $item['c_modelo_nfe'] = $notaFiscal->cabec->cModeloNFe ?? null;
        $item['d_emissao_nfe'] = Carbon::createFromFormat('d/m/Y', ($notaFiscal->cabec->dEmissaoNFe ?? null));
        $item['n_valor_nfe'] = $notaFiscal->cabec->nValorNFe ?? null;
        $item['c_ambiente_nfe'] = $notaFiscal->cabec->cAmbienteNFe ?? null;
        $item['c_natureza_operacao'] = $notaFiscal->cabec->cNaturezaOperacao ?? null;
        $item['full_object'] = json_encode($notaFiscal);

        try {
            $nf = NotaFiscal::updateOrCreate(
                [
                    'loja_id' => $this->loja->id,
                    'n_id_receb' => $item['n_id_receb'],
                    'n_id_fornecedor' => $item['n_id_fornecedor']
                ],
                $item
            );

            $batchItems = [];
            foreach ($notaFiscal->itensRecebimento ?? [] as $nfItem) {
                $batchItems[] = [
                    'loja_id' => $this->loja->id,
                    'nota_fiscal_id' => $nf->id,

                    'n_id_receb' => $item['n_id_receb'],
                    'produto_codigo' => $nfItem->itensCabec->nIdProduto ?? null,

                    'n_id_item' => $nfItem->itensCabec->nIdItem ?? null,
                    'n_id_pedido' => $nfItem->itensCabec->nIdPedido ?? null,
                    'n_id_it_pedido' => $nfItem->itensCabec->nIdItPedido ?? null,
                    'n_id_produto' => $nfItem->itensCabec->nIdProduto ?? null,
                    'n_sequencia' => $nfItem->itensCabec->nSequencia ?? null,
                    'c_codigo_produto' => $nfItem->itensCabec->cCodigoProduto ?? null,
                    'c_descricao_produto' => $nfItem->itensCabec->cDescricaoProduto ?? null,
                    'c_ignorar_item' => $nfItem->itensCabec->cIgnorarItem ?? null,
                    'c_adicionar_novo' => $nfItem->itensCabec->cAdicionarNovo ?? null,
                    'c_associar_existente' => $nfItem->itensCabec->cAssociarExistente ?? null,
                    'c_item_devolvido' => $nfItem->itensCabec->cItemDevolvido ?? null,
                    'c_ncm' => $nfItem->itensCabec->cNCM ?? null,
                    'c_ean' => $nfItem->itensCabec->cEAN ?? null,
                    'c_cfop' => $nfItem->itensCabec->cCFOP ?? null,
                    'n_qtde_nfe' => $nfItem->itensCabec->nQtdeNFe ?? null,
                    'c_unidade_nfe' => $nfItem->itensCabec->cUnidadeNfe ?? null,
                    'n_preco_unit' => $nfItem->itensCabec->nPrecoUnit ?? null,
                    'v_desconto' => $nfItem->itensCabec->vDesconto ?? null,
                    'v_frete' => $nfItem->itensCabec->vFrete ?? null,
                    'v_total_item' => $nfItem->itensCabec->vTotalItem ?? null,

                    'full_object' => json_encode($nfItem),
                ];
            }

            if (count($batchItems) > 0) {
                NotaFiscalItem::upsert(
                    $batchItems,
                    ['loja_id', 'nota_fiscal_id', 'n_id_receb', 'n_sequencia'],
                    array_keys($batchItems[0])
                );
            }

        } catch (\Throwable $th) {
            Log::error(
                "Erro ao salvar nota fiscal" . $th->getMessage(),
                $item
            );
        }
    }
}
