<?php

namespace App\Http\Controllers;

use App\Jobs\TransferenciaCreateJob;
use Illuminate\Http\Request;
use App\Models\Movimento;
use App\Services\CanService;
use Illuminate\Support\Facades\DB;
use App\Services\OmieService;
use Carbon\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class TransferenciaController extends Controller
{
    private $omie;

    public function __construct()
    {
        $this->middleware('auth');
        $this->omie = new OmieService();
    }

    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        if (!CanService::canPermissionLoja('Transferência', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Transferência!");
        }

        $data_inicio = $request->filled('data_inicio') ? Carbon::parse($request->get('data_inicio'))->format('Y-m-d') : Carbon::now()->format('Y-m-d');
        $data_final = $request->filled('data_final') ? Carbon::parse($request->get('data_final'))->format('Y-m-d') : Carbon::now()->format('Y-m-d');

        session([
            'data_inicio' => $data_inicio,
            'data_final' => $data_final,
        ]);

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

        $locaisEstoque = $this->omie->getLocaisEstoque();
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
                $produto = $this->omie->getConsultaProdutoCodigo($produtoId);

                $movimentacao = new Movimento();
                $movimentacao->loja_id = Auth::user()->current_loja_id;

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
            $produto = $this->omie->getConsultaProdutoCodigo($codigo);
            $posicaoEstoque = $this->omie->getPosicaoEstoque($local, $produto->codigo_produto, Carbon::parse($data)->format('d/m/Y'));

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
                    'valor_unitario' => number_format($posicaoEstoque->cmc, 2, ',', '.'),
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
            try {
                Http::withHeaders([
                    'Content-Type' => 'application/json'
                ])->connectTimeout(60)->timeout(60)->post($url, $data);
                return redirect()->route('transferencia.index')->with('success', 'Movimentação excluída com sucesso!');
            } finally {
                $movimento->delete();
            }
        }
    }
}
