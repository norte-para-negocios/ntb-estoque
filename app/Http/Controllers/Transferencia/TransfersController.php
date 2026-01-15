<?php

namespace App\Http\Controllers\Transferencia;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreTransferenciaItemRequest;
use App\Http\Requests\StoreTransferenciaRequest;
use App\Http\Requests\UpdateQuantidadeRequest;
use App\Jobs\TransferJob;
use App\Models\LocalEstoque;
use App\Models\Movimento;
use App\Models\PosicaoEstoque;
use App\Models\Produto;
use App\Models\Transferencia;
use App\Services\CanService;
use App\Services\OmieService;
use App\Services\PosicaoEstoqueService;
use Barryvdh\Snappy\Facades\Pdf;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class TransfersController extends Controller
{
    public function __construct()
    {
        $this->middleware('auth');
    }

    public function index(Request $request)
    {
        if (! CanService::canPermissionLoja('Transferências - Ver', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Transferências - Ver!');
        }
        $data_inicio = Carbon::parse($request->has('data_inicio') ? $request->get('data_inicio') : session('inicio', Carbon::now()->subDays(30)));
        $data_final = Carbon::parse($request->has('data_final') ? $request->get('data_final') : session('final', Carbon::now()));
        $tipo = $request->get('tipo', null);
        session([
            'inicio' => $data_inicio->format('Y-m-d'),
            'final' => $data_final->format('Y-m-d'),
            'tipo' => $tipo,
            'familia' => $request->get('familia', null),
        ]);

        $transferencias = Transferencia::where('loja_id', auth()->user()->current_loja_id)
            ->whereBetween('data', [$data_inicio->startOfDay(), $data_final->endOfDay()])
            ->when($request->get('familia'), function ($familia) use ($request) {
                $familia->whereHas('movimentos', function ($items) use ($request) {
                    $items->whereHas('produto', function ($produto) use ($request) {
                        $produto->where('descricao_familia', $request->get('familia'));
                    });
                });
            })
            ->when($request->get('tipo'), function ($q) use ($request) {
                $q->whereHas('movimentos', function ($items) use ($request) {
                    $items->whereHas('produto', function ($produto) use ($request) {
                        $produto->where('tipo_item', $request->get('tipo'));
                    });
                });
            })
            ->orderBy('id', 'desc')
            ->paginate(20)
            ->withQueryString();

        $locaisEstoque = LocalEstoque::where('loja_id', auth()->user()->current_loja_id)->orderBy('descricao', 'asc')->get();

        return view('transfers.index', compact('data_inicio', 'data_final', 'transferencias', 'locaisEstoque', 'tipo'));
    }

    public function store(StoreTransferenciaRequest $request)
    {
        if (! CanService::canPermissionLoja('Transferências - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Transferências - Criar!');
        }

        $emContagem = Transferencia::where('status', 'Processando')
            ->where('codigo_local_origem', $request->input('codigo_local_origem'))
            ->where('codigo_local_destino', $request->input('codigo_local_destino'))
            ->where('loja_id', auth()->user()->current_loja_id)
            ->where('data', $request->input('data'))
            ->first();

        if ($emContagem) {
            return redirect()->route('transfers.index')->with('info', "Transferência nº $emContagem->id ainda em processamento, finalize-o antes de iniciar nova transferência!");
        }

        $transferencia = Transferencia::create([
            'loja_id' => auth()->user()->current_loja_id,
            'codigo_local_origem' => $request->input('codigo_local_origem'),
            'codigo_local_destino' => $request->input('codigo_local_destino'),
            'data' => Carbon::parse($request->input('data')),
            'status' => 'Processando',
            'motivo' => $request->input('motivo'),
        ]);

        return redirect()->route('transfers.contagem', $transferencia->id);
    }

    public function storeItem(StoreTransferenciaItemRequest $request, Transferencia $transferencia)
    {
        if (! CanService::canPermissionLoja('Transferências - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Transferências - Criar!');
        }

        $produto = Produto::where('loja_id', $transferencia->loja_id)
            ->where('codigo', $request->get('codigo'))
            ->first();

        if (! $produto) {
            return response(['mensagem' => 'Produto não encontrado'], 404);
        }

        $posicaoEstoque = PosicaoEstoque::where('loja_id', $transferencia->loja_id)
            ->where('codigo_local_estoque', $transferencia->codigo_local_origem)
            ->where('n_cod_prod', $produto->codigo_produto)
            ->where('data_posicao', $transferencia->data->format('Y-m-d'))
            ->first();

        if (! $posicaoEstoque || ($posicaoEstoque->n_cmc === 0) || ($posicaoEstoque->n_cmc === null)) {
            $posicaoService = new PosicaoEstoqueService($transferencia->loja);
            $posicaoProd = $posicaoService->fetchPosicaoProduto($transferencia->codigo_local_origem, $produto->codigo_produto, $transferencia->data->format('d/m/Y'));
            $posicaoService->savePosicao($posicaoProd, $transferencia->data->format('d/m/Y'));
            $posicaoEstoque = PosicaoEstoque::where('loja_id', $transferencia->loja_id)
                ->where('codigo_local_estoque', $transferencia->codigo_local_origem)
                ->where('n_cod_prod', $produto->codigo_produto)
                ->where('data_posicao', $transferencia->data->format('Y-m-d'))
                ->first();
        }

        try {
            $item = $transferencia->movimentos()->create([
                'loja_id' => $transferencia->loja_id,
                'codigo_local_estoque' => $transferencia->codigo_local_origem,
                'id_prod' => $produto->codigo_produto,
                'data' => $transferencia->data,
                'tipo' => $transferencia->motivo,
                'quan' => $request->quantidade,
                'valor' => ($posicaoEstoque?->n_cmc > 0) ? $posicaoEstoque->n_cmc : 0,
                'obs' => 'NTB - Estoque|Usuário:'.auth()->user()->name,
                'origem' => 'AJU',
                'motivo' => $transferencia->motivo,
                'codigo_local_estoque_destino' => $transferencia->codigo_local_destino,
                'status' => 'Iniciado',

                'codigo_status' => null,
                'descricao_status' => null,
                'id_movest' => null,
                'id_ajuste' => null,
                'response' => null,
            ]);

            return response([
                'key' => $item->id,
                'id' => $produto->codigo,
                'nome' => $produto->descricao,
                'unidade' => $produto->unidade,
            ], 201);
        } catch (\Exception $e) {
            Log::error('Erro ao inserir item na transferência', [
                'transferencia_id' => $transferencia->id,
                'produto_codigo' => $request->get('codigo'),
                'erro' => $e->getMessage(),
            ]);

            return response(['mensagem' => "Não foi possível inserir o item, erro: {$e->getMessage()}"], 500);
        }
    }

    public function pdf(Request $request, Transferencia $transferencia)
    {
        if (! CanService::canPermissionLoja('Transferências - Ver', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Transferências - Ver!');
        }
        $pdf = Pdf::loadView('transfers.pdf', ['transferencia' => $transferencia, 'loja' => auth()->user()->loja, 'params' => $request->all()]);

        return $pdf->inline("transferencia-{$transferencia->id}.pdf");
    }

    public function finish(Request $request, Transferencia $transferencia)
    {
        if (! CanService::canPermissionLoja('Transferências - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Transferências - Criar!');
        }
        (new PosicaoEstoqueService($transferencia->loja))->fetchAll($transferencia->codigo_local_origem, $transferencia->data->format('d/m/Y'));
        TransferJob::dispatch($transferencia, auth()->user())->delay(10);

        return redirect()
            ->route('transfers.index', [
                'data_inicio' => $transferencia->data->format('Y-m-d'),
                'data_final' => $transferencia->data->format('Y-m-d'),
            ])
            ->with('success', 'Transferência processando no Omie, só aguardar a finalização do processamento. :)');
    }

    public function contagem(Transferencia $transferencia)
    {
        if (! CanService::canPermissionLoja('Transferências - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Transferências - Criar!');
        }

        return view('transfers.contagem', compact('transferencia'));
    }

    public function setQuantidade(Movimento $movimento, UpdateQuantidadeRequest $request)
    {
        if (! CanService::canPermissionLoja('Transferências - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Transferências - Criar!');
        }

        $movimento->update(['quan' => $request->input('quantidade')]);

        return response()->json(['success' => true]);
    }

    public function editQuantidade(Movimento $movimento, UpdateQuantidadeRequest $request)
    {
        if (! CanService::canPermissionLoja('Transferências - Editar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Transferências - Editar!');
        }

        if ($movimento->id_ajuste !== null) {
            $omieService = new OmieService($movimento->transferencia->loja);
            $excluido = $omieService->excluirAjusteEstoque($movimento->id_ajuste);

            if (! $excluido) {
                Log::warning('Falha ao excluir ajuste no Omie ao editar quantidade', [
                    'movimento_id' => $movimento->id,
                    'id_ajuste' => $movimento->id_ajuste,
                ]);

                return response()->json([
                    'success' => false,
                    'mensagem' => 'Não foi possível excluir o ajuste no Omie. Tente novamente.',
                ], 500);
            }
        }

        $movimento->update([
            'response' => null,
            'codigo_status' => null,
            'descricao_status' => null,
            'id_movest' => null,
            'id_ajuste' => null,
            'status' => null,
            'quan' => $request->input('quantidade'),
        ]);

        TransferJob::dispatch($movimento->transferencia, auth()->user());

        return response()->json(['success' => true]);
    }

    public function duplicar(Request $request, Transferencia $transferencia)
    {
        $clone = $transferencia->replicate();
        $clone->data = $request->get('data');
        $clone->finalizado = null;
        $clone->status = 'Em contagem';
        $clone->save();

        foreach ($transferencia->movimentos as $item) {
            $clonedItem = $item->replicate();
            $clonedItem->transferencia_id = $clone->id;
            $clonedItem->quan = null;
            $clonedItem->valor = null;
            $clonedItem->response = null;
            $clonedItem->codigo_status = null;
            $clonedItem->descricao_status = null;
            $clonedItem->id_movest = null;
            $clonedItem->id_ajuste = null;
            $clonedItem->status = null;
            $clonedItem->save();
        }

        return redirect()->route('transfers.contagem', $clone)
            ->with('success', 'Tranferência duplicado com sucesso!');
    }

    public function destroy(Transferencia $transferencia)
    {
        if (! CanService::canPermissionLoja('Transferências - Excluir', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Transferências - Excluir!');
        }

        $falhas = [];
        foreach ($transferencia->movimentos as $movimento) {
            if ($movimento->id_ajuste !== null) {
                $omieService = new OmieService($transferencia->loja);
                $excluido = $omieService->excluirAjusteEstoque($movimento->id_ajuste);

                if (! $excluido) {
                    $falhas[] = $movimento->id_ajuste;
                    Log::warning('Falha ao excluir ajuste no Omie ao deletar transferência', [
                        'transferencia_id' => $transferencia->id,
                        'movimento_id' => $movimento->id,
                        'id_ajuste' => $movimento->id_ajuste,
                    ]);
                }
            }
            $movimento->delete();
        }
        $transferencia->delete();

        if (! empty($falhas)) {
            return redirect()
                ->route('transfers.index', [
                    'data_inicio' => $transferencia->data->format('Y-m-d'),
                    'data_final' => $transferencia->data->format('Y-m-d'),
                ])
                ->with('warning', 'Transferência cancelada, mas alguns ajustes não puderam ser excluídos no Omie. Verifique os logs.');
        }

        return redirect()
            ->route('transfers.index', [
                'data_inicio' => $transferencia->data->format('Y-m-d'),
                'data_final' => $transferencia->data->format('Y-m-d'),
            ])
            ->with('success', 'Transferência cancelada com sucesso!');
    }

    public function destroyItem(Movimento $movimento)
    {
        if (! CanService::canPermissionLoja('Transferências - Editar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Transferências - Editar!');
        }

        if ($movimento->id_ajuste !== null) {
            $omieService = new OmieService($movimento->transferencia->loja);
            $excluido = $omieService->excluirAjusteEstoque($movimento->id_ajuste);

            if (! $excluido) {
                Log::warning('Falha ao excluir ajuste no Omie ao deletar item', [
                    'movimento_id' => $movimento->id,
                    'id_ajuste' => $movimento->id_ajuste,
                ]);

                return redirect()->back()->with('warning', 'Item excluído localmente, mas não foi possível excluir o ajuste no Omie. Verifique os logs.');
            }
        }
        $movimento->delete();

        return redirect()->back()->with('success', 'Item excluído com sucesso!');
    }
}
