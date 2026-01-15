<?php

namespace App\Http\Controllers\Transferencia;

use App\Http\Controllers\Controller;
use App\Jobs\TransferJob;
use App\Models\LocalEstoque;
use App\Models\Loja;
use App\Models\Movimento;
use App\Models\PosicaoEstoque;
use App\Models\Produto;
use App\Models\Transferencia;
use App\Services\CanService;
use App\Services\PosicaoEstoqueService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use PDF;

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
        $data_inicio = Carbon::parse($request->has('data_inicio') ? $request->get('data_inicio') : session('inicio'));
        $data_final = Carbon::parse($request->has('data_final') ? $request->get('data_final') : session('final'));
        $tipo = $request->get('tipo', null);
        session([
            'inicio' => $data_inicio->format('Y-m-d'),
            'final' => $data_final->format('Y-m-d'),
            'tipo' => $tipo,
            'familia' => $request->get('familia', null),
        ]);

        $transferencias = Transferencia::where('loja_id', auth()->user()->current_loja_id)
            ->whereBetween('data', [Carbon::parse($data_inicio)->startOfDay(), Carbon::parse($data_final)->endOfDay()])
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

    public function store(Request $request)
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

        $request->validate([
            'codigo_local_origem' => 'required|integer',
            'codigo_local_destino' => 'required|integer',
            'data' => 'required|date',
            'motivo' => 'required|string|max:3|in:'.implode(',', array_keys(\App\Helpers\Constants::TIPO_MOVIMENTO_TRANSFERENCIA)),
        ]);

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

    public function storeItem(Request $request, Transferencia $transferencia)
    {
        if (! CanService::canPermissionLoja('Transferencia - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Transferencia - Criar!');
        }

        $request->validate([
            'codigo' => 'required|string|max:60',
            'quantidade' => 'required|numeric',
        ]);

        $produto = Produto::where('loja_id', $transferencia->loja_id)
            ->where('codigo', $request->get('codigo'))
            ->first();

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
            return response(['mensagem' => "Não foi possível inserir o item, erro: {$e->getMessage()}"], 500);
        }
    }

    public function pdf(Request $request, Transferencia $transferencia)
    {
        if (! CanService::canPermissionLoja('Transferencia - Ver', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Transferencia - Ver!');
        }
        $pdf = PDF::loadView('transferencia.pdf', ['transferencia' => $transferencia, 'loja' => auth()->user()->loja, 'params' => $request->all()]);

        return $pdf->inline("inventario-{$transferencia->id}.pdf");
    }

    public function finish(Request $request, Transferencia $transferencia)
    {
        if (! CanService::canPermissionLoja('Transferencia - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Transferencia - Criar!');
        }
        (new PosicaoEstoqueService(Loja::find($transferencia->loja_id)))->fetchAll($transferencia->codigo_local_origem, $transferencia->data->format('d/m/Y'));
        TransferJob::dispatch($transferencia, auth()->user())->delay(10);

        return redirect()
            ->route('transfers.index', [
                'data_inicio' => $transferencia->data->format('Y-m-d'),
                'data_final' => $transferencia->data->format('Y-m-d')]
            )->with('success', 'Transferência processando no Omie, só aguardar a finalização do processamento. :)');
    }

    public function contagem(Transferencia $transferencia)
    {
        if (! CanService::canPermissionLoja('Transferencia - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Transferencia - Criar!');
        }

        return view('transfers.contagem', compact('transferencia'));
    }

    public function setQuantidade(Movimento $movimento, Request $request)
    {
        if (! CanService::canPermissionLoja('Transferencia - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Transferencia - Criar!');
        }

        $request->validate([
            'quantidade' => 'required|numeric|min:0',
        ]);

        $movimento->update(['quan' => $request->input('quantidade')]);

        return response()->json(['success' => true]);
    }

    public function editQuantidade(Movimento $movimento, Request $request)
    {
        if (! CanService::canPermissionLoja('Transferencia - Editar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Transferencia - Editar!');
        }

        $request->validate([
            'quantidade' => 'required|numeric|min:0',
        ]);

        if ($movimento->id_ajuste !== null) {
            $loja = $movimento->inventario->loja;
            $url = 'https://app.omie.com.br/api/v1/estoque/ajuste/';
            $data = [
                'call' => 'ExcluirAjusteEstoque',
                'app_key' => $loja->omie_app_key,
                'app_secret' => $loja->omie_app_secret,
                'param' => [
                    [
                        'id_ajuste' => $movimento->id_ajuste,
                    ],
                ],
            ];
            Http::withHeaders([
                'Content-Type' => 'application/json',
            ])->connectTimeout(60)->timeout(60)->post($url, $data);
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

        TransferJob::dispatch($movimento->inventario, auth()->user());

        return response()->json(['success' => true]);
    }

    public function duplicar(Request $request, Transferencia $transferencia)
    {
        $clone = $transferencia->replicate();
        $clone->data = $request->get('data');
        $clone->finalizado = null;
        $clone->status = 'Em contagem';
        $clone->save();

        foreach ($transferencia->items as $item) {
            $clonedItem = $item->replicate();
            $clonedItem->inventario_id = $clone->id;
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

        return redirect()->route('transfers.contagem', $clonedItem->inventario)
            ->with('success', 'Tranferência duplicado com sucesso!');
    }

    public function destroy(Transferencia $transferencia)
    {
        if (! CanService::canPermissionLoja('Transferencia - Excluir', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Transferencia - Excluir!');
        }

        foreach ($transferencia->movimentos as $movimento) {
            if ($movimento->id_ajuste !== null) {
                $loja = $transferencia->loja;
                $url = 'https://app.omie.com.br/api/v1/estoque/ajuste/';
                $data = [
                    'call' => 'ExcluirAjusteEstoque',
                    'app_key' => $loja->omie_app_key,
                    'app_secret' => $loja->omie_app_secret,
                    'param' => [
                        [
                            'id_ajuste' => $movimento->id_ajuste,
                        ],
                    ],
                ];
                Http::withHeaders([
                    'Content-Type' => 'application/json',
                ])->connectTimeout(60)
                    ->timeout(60)
                    ->post($url, $data);
            }
            $movimento->delete();
        }
        $transferencia->delete();

        return redirect()->route('transfers.index', ['data_inicio' => $transferencia->data->format('Y-m-d'), 'data_final' => $transferencia->data->format('Y-m-d')])->with('success', 'Transferência cancelada com sucesso!');
    }

    public function destroyItem(Movimento $movimento)
    {
        if (! CanService::canPermissionLoja('Transferencia - Editar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Transferencia - Editar!');
        }

        if ($movimento->id_ajuste !== null) {
            $loja = $movimento->inventario->loja;
            $url = 'https://app.omie.com.br/api/v1/estoque/ajuste/';
            $data = [
                'call' => 'ExcluirAjusteEstoque',
                'app_key' => $loja->omie_app_key,
                'app_secret' => $loja->omie_app_secret,
                'param' => [
                    [
                        'id_ajuste' => $movimento->id_ajuste,
                    ],
                ],
            ];
            Http::withHeaders([
                'Content-Type' => 'application/json',
            ])->connectTimeout(60)
                ->timeout(60)
                ->post($url, $data);
        }
        $movimento->delete();

        return redirect()->back()->with('success', 'Item excluído com sucesso!');
    }
}
