<?php

namespace App\Http\Controllers\Transferencia;

use App\Http\Controllers\Controller;
use App\Jobs\TransferenciaJob;
use App\Models\LocalEstoque;
use App\Models\Movimento;
use App\Models\PosicaoEstoque;
use App\Models\Produto;
use App\Services\CanService;
use App\Services\PosicaoEstoqueService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class TransferenciaController extends Controller
{
    public function __construct()
    {
        $this->middleware('auth');
    }

    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        if (!CanService::canPermissionLoja('Transferências - Ver', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Transferências - Ver!");
        }

        $data_inicio = Carbon::parse($request->has('data_inicio') ? $request->get('data_inicio') : session('inicio'));
        $data_final = Carbon::parse($request->has('data_final') ? $request->get('data_final') : session('final'));
        $tipo = $request->get('tipo', null);
        session(['inicio' => $data_inicio->format('Y-m-d'), 'final' => $data_final->format('Y-m-d')]);

        $transferencias = Movimento::where('loja_id', Auth::user()->current_loja_id)
            ->where('tipo', 'TRF')
            ->whereBetween('data', [Carbon::parse($data_inicio)->startOfDay(), Carbon::parse($data_final)->endOfDay()])
            ->when($request->get('familia'), function ($familia) use ($request) {
                $familia->whereHas('produto', function ($produto) use ($request) {
                    $produto->where('descricao_familia', $request->get('familia'));
                });
            })
            ->when($request->get('tipo'), function ($q) use ($request) {
                $q->whereHas('produto', function ($produto) use ($request) {
                    $produto->where('tipo_item', $request->get('tipo'));
                });
            })
            ->orderBy('data', 'desc')
            ->paginate(10)
            ->withQueryString();

        return view('transferencia.index', compact('transferencias', 'data_inicio', 'data_final', 'tipo'));
    }

    /**
     * Show the form for creating a new resource.
     */
    public function create()
    {
        if (!CanService::canPermissionLoja('Transferências - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Transferências - Criar!");
        }

        $locaisEstoque = LocalEstoque::where('loja_id', Auth::user()->current_loja_id)->orderBy('descricao')->get();
        return view('transferencia.create', compact('locaisEstoque'));
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        if (!CanService::canPermissionLoja('Transferências - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Transferências - Criar!");
        }

        $validated = $request->validate([
            'data' => 'required|date',
            'estoque_origem' => 'required|integer',
            'estoque_destino' => 'required|integer',
            'motivo' => 'required|string',
            'produtos' => 'required|array',
            'quantidades' => 'required|array',
        ]);

        DB::transaction(function () use ($request) {
            foreach ($request->produtos as $index => $produtoId) {
                $produto = Produto::where('loja_id', auth()->user()->current_loja_id)->where('codigo', $produtoId)->first();

                $posicaoEstoque = PosicaoEstoque::where('loja_id', auth()->user()->current_loja_id)
                    ->where('codigo_local_estoque', $request->get('estoque_origem'))
                    ->where('c_codigo', $produto->codigo_produto)
                    ->where('data_posicao', normalizarData($request->get('data')))
                    ->first();

                if (!$posicaoEstoque) {
                    $posicaoEstoque = (new PosicaoEstoqueService(auth()->user()->loja))->fetchPosicaoProduto($request->get('estoque_origem'), $produto->codigo_produto, Carbon::parse(normalizarData($request->get('data')))->format('d/m/Y'));
                    $cmc = $posicaoEstoque ? $posicaoEstoque->nCMC : 0;
                } else {
                    $cmc = $posicaoEstoque->cmc;
                }

                $movimentacao = new Movimento();
                $movimentacao->loja_id = auth()->user()->current_loja_id;

                $movimentacao->codigo_local_estoque = $request->estoque_origem;
                $movimentacao->id_prod = $produto->codigo_produto;
                $movimentacao->data = $request->data;
                $movimentacao->tipo = 'TRF';
                $movimentacao->quan = $request->quantidades[$index];
                $movimentacao->valor = $cmc;
                $movimentacao->obs = $request->observacao ?? 'NTB - Estoque|Usuário:' . auth()->user()->name;
                $movimentacao->origem = 'AJU';
                $movimentacao->motivo = $request->motivo;
                $movimentacao->codigo_local_estoque_destino = $request->estoque_destino;
                $movimentacao->status = 'Iniciado';
                $movimentacao->save();
                // Dispara o job para processar a movimentação no OMIE
                TransferenciaJob::dispatch(auth()->user(), $movimentacao);
            }
        });

        return redirect()->route('transferencia.index')->with('success', 'Movimentação registrada com sucesso!');
    }

    /**
     * Busca produto pelo código de QR Code.
     */
    public function produto($local, $codigo, $data)
    {
        if (!CanService::canPermissionLoja('Transferências - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Transferências - Criar!");
        }

        try {
            if (empty($codigo)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Código do produto é obrigatório'
                ], 400);
            }

            $produto = Produto::where('loja_id', auth()->user()->current_loja_id)
                ->where('codigo', $codigo)
                ->first();

            if (!$produto) {
                return response()->json([
                    'success' => false,
                    'message' => 'Produto não encontrado'
                ], 404);
            }

            return response()->json([
                'success' => true,
                'data' => [
                    'id' => $produto->codigo,
                    'nome' => $produto->descricao . '(' . $produto->codigo . ')',
                    'unidade' => $produto->unidade ?? ''
                ]
            ], 200);
        } catch (\Throwable $th) {
            Log::error('Erro ao buscar produto por QR Code', [
                'codigo' => $codigo,
                'erro' => $th->getMessage()
            ]);
            return response()->json([
                'success' => false,
                'message' => 'Erro interno do servidor'
            ], 500);
        }
    }

    public function produtos(Request $request)
    {
        if (!CanService::canPermissionLoja('Transferências - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Transferências - Criar!");
        }

        // Termo de busca vindo do Select2 (parâmetro "q")
        $term = $request->get('q', '');

        // Consulta simples com filtro e limite
        return Produto::where('loja_id', auth()->user()->current_loja_id)
            ->where(function ($query) use ($term) {
                $query->where('descricao', 'LIKE', "%{$term}%")
                    ->orWhere('codigo', 'LIKE', "%{$term}%")
                    ->orWhere('codigo_produto', 'LIKE', "%{$term}%")
                    ->orWhere('descricao_familia', 'LIKE', "%{$term}%");
            })
            ->orderBy('descricao')
            ->selectRaw("codigo, concat(descricao, ' (#', codigo, ')') as descricao, unidade")
            ->paginate(100);
    }

    /**
     * Display the specified resource.
     */
    public function reprocess(Movimento $movimento)
    {
        if (!CanService::canPermissionLoja('Transferências - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Transferências - Criar!");
        }

        if (!in_array($movimento->status, ['Processando', 'Concluído'])) {
            TransferenciaJob::dispatch(auth()->user(), $movimento);
        }
        return redirect()->route('transferencia.index')
            ->with('success', 'Transferência reenviada para OMIE!');
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Movimento $movimento)
    {
        if (!CanService::canPermissionLoja('Transferências - Excluir', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Transferências - Excluir!");
        }

        try {
            // Verifica se o movimento já foi processado
            if ($movimento->id_ajuste !== null) {
                $loja = $movimento->loja;
                $url = 'https://app.omie.com.br/api/v1/estoque/ajuste/';
                $data = [
                    "call" => "ExcluirAjusteEstoque",
                    "app_key" => $loja->omie_app_key,
                    "app_secret" => $loja->omie_app_secret,
                    "param" => [
                        [
                            "id_ajuste" => $movimento->id_ajuste,
                        ]
                    ]
                ];
                Http::withHeaders([
                    'Content-Type' => 'application/json'
                ])->connectTimeout(60)->timeout(60)->post($url, $data);
            }
            $movimento->delete();
            return redirect()->route('transferencia.index')->with('success', 'Movimentação excluída com sucesso!');
        } catch (\Throwable $th) {
            return redirect()->route('transferencia.index')->with('warning', 'Ops! :(, Algo de errado aconteceu ao excluir a movimentação: ' . $th->getMessage());
        }
    }
}
