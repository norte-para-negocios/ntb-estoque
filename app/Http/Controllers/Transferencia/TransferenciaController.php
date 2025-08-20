<?php

namespace App\Http\Controllers\Transferencia;

use App\Http\Controllers\Controller;
use App\Jobs\TransferenciaCreateJob;
use App\Models\LocalEstoque;
use App\Models\Movimento;
use App\Models\PosicaoEstoque;
use App\Models\Produto;
use App\Services\CanService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class TransferenciaController extends Controller
{
    private $omie;

    public function __construct()
    {
        $this->middleware('auth');
    }

    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        if (!CanService::canPermissionLoja('Transferência', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Transferência!");
        }

        $data_inicio = Carbon::parse($request->has('data_inicio') ? $request->get('data_inicio') : session('inicio'));
        $data_final = Carbon::parse($request->has('data_final') ? $request->get('data_final') : session('final'));
        session(['inicio' => $data_inicio->format('Y-m-d'), 'final' => $data_final->format('Y-m-d')]);

        $transferencias = Movimento::where('loja_id', Auth::user()->current_loja_id)
            ->where('tipo', 'TRF')
            ->whereBetween('data', [Carbon::parse($data_inicio)->startOfDay(), Carbon::parse($data_final)->endOfDay()])
            ->orderBy('id', 'desc')
            ->paginate(20)
            ->withQueryString();
        return view('transferencia.index', compact('transferencias', 'data_inicio', 'data_final'));
    }

    /**
     * Show the form for creating a new resource.
     */
    public function create()
    {
        if (!CanService::canPermissionLoja('Transferência', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Transferência!");
        }

        $locaisEstoque = LocalEstoque::where('loja_id', Auth::user()->current_loja_id)->orderBy('descricao')->get();
        return view('transferencia.create', compact('locaisEstoque'));
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        if (!CanService::canPermissionLoja('Transferência', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Transferência!");
        }

        $validated = $request->validate([
            'data' => 'required|date',
            'estoque_origem' => 'required|integer',
            'estoque_destino' => 'required|integer',
            'motivo' => 'required|string',
            'produtos' => 'required|array',
            'quantidades' => 'required|array',
            'valores' => 'required|array',
        ]);

        DB::transaction(function () use ($request) {
            foreach ($request->produtos as $index => $produtoId) {
                $produto = Produto::where('loja_id', auth()->user()->current_loja_id)->where('codigo', $produtoId)->first();

                $movimentacao = new Movimento();
                $movimentacao->loja_id = auth()->user()->current_loja_id;

                $movimentacao->codigo_local_estoque = $request->estoque_origem;
                $movimentacao->id_prod = $produto->codigo_produto;
                $movimentacao->data = $request->data;
                $movimentacao->tipo = 'TRF';
                $movimentacao->quan = $request->quantidades[$index];
                $movimentacao->valor = str_replace(',', '.', str_replace('.', '', $request->valores[$index]));
                $movimentacao->obs = $request->observacao ?? 'Transferências entre estoques - NTB Estoque';
                $movimentacao->origem = 'AJU';
                $movimentacao->motivo = $request->motivo;
                $movimentacao->codigo_local_estoque_destino = $request->estoque_destino;
                $movimentacao->save();
                // Dispara o job para processar a movimentação no OMIE
                TransferenciaCreateJob::dispatch($movimentacao);
            }
        });

        return redirect()->route('transferencia.index')->with('success', 'Movimentação registrada com sucesso!');
    }

    /**
     * Busca produto pelo código de QR Code.
     */
    public function produto($local, $codigo, $data)
    {
        if (!CanService::canPermissionLoja('Transferência', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Transferência!");
        }

        try {
            // Validação básica do parâmetro
            if (empty($codigo)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Código do produto é obrigatório'
                ], 400);
            }

            // Busca o produto na API do Omie
            $produto = Produto::where('loja_id', auth()->user()->current_loja_id)->where('codigo', $codigo)->first();
            $posicaoEstoque = PosicaoEstoque::where('loja_id', auth()->user()->current_loja_id)
                ->where('codigo_local_estoque', $local)
                ->where('c_codigo', $produto->codigo_produto)
                ->where('data_posicao', Carbon::parse($data)->format('Y-m-d'))
                ->first();

            // Verifica se o produto foi encontrado
            if (!$produto) {
                return response()->json([
                    'success' => false,
                    'message' => 'Produto não encontrado'
                ], 404);
            }

            // Retorna os dados do produto
            return response()->json([
                'success' => true,
                'data' => [
                    'id' => $produto->codigo,
                    'nome' => $produto->descricao,
                    'valor_unitario' => number_format(($posicaoEstoque->cmc ?? 0), 2, ',', '.'),
                ]
            ], 200);
        } catch (\Exception $e) {

            // Log do erro para debug
            Log::error('Erro ao buscar produto por QR Code', [
                'codigo' => $codigo,
                'erro' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Erro interno do servidor'
            ], 500);
        }
    }

    public function produtos(Request $request)
    {
        if (!CanService::canPermissionLoja('Transferência', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Transferência!");
        }

        // Termo de busca vindo do Select2 (parâmetro "q")
        $term = $request->get('q', '');

        // Consulta simples com filtro e limite
        $results = Produto::where('loja_id', auth()->user()->current_loja_id)
            ->where('descricao', 'LIKE', "%{$term}%")
            ->orWhere('codigo', 'LIKE', "%{$term}%")
            ->orderBy('descricao')
            ->select(['codigo', 'descricao'])
            ->paginate(20);

        $formatted = $results->map(function ($item) {
            return [
                'id' => $item->codigo,
                'text' => $item->descricao,
            ];
        });

        return response()->json([
            'data' => $formatted,
            'current_page' => $results->currentPage(),
            'last_page' => $results->lastPage(),
        ]);
    }

    /**
     * Display the specified resource.
     */
    public function reprocess(Movimento $movimento)
    {
        // Dispara o job para processar a movimentação no OMIE
        TransferenciaCreateJob::dispatch($movimento);
        return redirect()->route('transferencia.index')->with('success', 'Transferência reenviada para OMIE!');
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Movimento $movimento)
    {
        if (!CanService::canPermissionLoja('Transferência', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Transferência!");
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
        } catch (\Exception $e) {
            return redirect()->route('transferencia.index')->with('warning', 'Ops! :(, Algo de errado aconteceu ao excluir a movimentação: ' . $e->getMessage());
        }
    }
}
