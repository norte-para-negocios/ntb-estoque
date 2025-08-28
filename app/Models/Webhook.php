<?php

namespace App\Models;

use App\Services\LocalEstoqueService;
use App\Services\OrdemProducaoService;
use App\Services\ProdutoService;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\MassPrunable;

class Webhook extends Model
{
    use MassPrunable;

    public function prunable(): Builder
    {
        return static::where('created_at', '<=', now()->subDays(7));
    }

    protected $fillable = [
        'loja_id',
        'message_id',
        'message',
    ];

    protected static function booted()
    {
        static::created(function ($webhook) {
            $message = $webhook->message;
            if (is_array($message)) {
                if (stripos($message['topic'], 'LocalEstoque.') !== false) {
                    $localService = new LocalEstoqueService($webhook->loja);
                    if ($message['topic'] === 'LocalEstoque.Excluido') {
                        $localService->deleteLocal($message['event']);
                    } else {
                        $localService->saveLocal($message['event']);
                    }
                } elseif (stripos($message['topic'], 'Produto.MovimentacaoEstoque') !== false) {
                    /*
                     * Identificar se deseja fazer algo quando houver movimento de estoque, não remover sem adicionar Produto.Inclusao, Edicao, Etc
                     * */
//                    $posicaoEstoqueService = new PosicaoEstoqueService($webhook->loja);
//                    $posicao = $posicaoEstoqueService->fetchPosicaoProduto($message['event']['codigo_local_estoque'], $message['event']['codigo_produto'], date('d/m/Y'));
//                    $posicaoEstoqueService->savePosicao($posicao, date('d/m/Y'));
                } elseif (stripos($message['topic'], 'Produto.AjusteEstoque') !== false) {
                    /*
                     * Identificar se deseja fazer algo quando houver movimento de estoque, não remover sem adicionar Produto.Inclusao, Edicao, Etc
                     * */
//                    $posicaoEstoqueService = new PosicaoEstoqueService($webhook->loja);
//                    $posicao = $posicaoEstoqueService->fetchPosicaoProduto($message['event']['codigo_local_estoque'], $message['event']['id_prod'], $message['event']['data']);
//                    $posicaoEstoqueService->savePosicao($posicao, Carbon::parse($message['event']['data'])->format('d/m/Y'));
                } elseif (stripos($message['topic'], 'Produto.') !== false) {
                    $produtoService = new ProdutoService($webhook->loja);
                    if ($message['topic'] === 'Produto.Excluido') {
                        $produtoService->deleteProduto($message['event']);
                    } else {
                        $produto = $produtoService->fetchProduto($message['event']['codigo_produto']);
                        $produtoService->saveProduto($produto);
                    }
                } elseif (stripos($message['topic'], 'OrdemProducao.') !== false) {
                    $ordemProducaoService = new OrdemProducaoService($webhook->loja);
                    if ($message['topic'] === 'OrdemProducao.Excluida') {
                        $ordemProducaoService->deleteOrdemProducao($message['event']);
                    } else {
                        $ordemProducao = $ordemProducaoService->fetchOrdemProducao($message['event']['nCodOP']);
                        $ordemProducaoService->saveOrdemProducao($ordemProducao);
                    }
                }
            } else {
                Log::error("A mensagem recebida no webhook não é um json:", ['message' => $message]);
            }
        });
    }

    protected function casts(): array
    {
        return [
            'message' => 'json:unicode',
        ];
    }

    public function loja()
    {
        return $this->belongsTo(Loja::class);
    }
}
