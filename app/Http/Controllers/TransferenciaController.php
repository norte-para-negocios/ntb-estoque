<?php

namespace App\Http\Controllers;

use App\Jobs\TransferenciaCreateJob;
use Illuminate\Http\Request;
use App\Models\Movimento;
use Illuminate\Support\Facades\DB;
use App\Services\OmieService;
use Carbon\Carbon;
use Illuminate\Support\Facades\Auth;
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
    public function index()
    {
        $transferencias = Movimento::where('loja_id', Auth::user()->current_loja_id)->orderBy('data', 'desc')->paginate(10);
        return view('transferencia.index', compact('transferencias'));
    }

    /**
     * Show the form for creating a new resource.
     */
    public function create()
    {
        $locaisEstoque = $this->omie->getLocaisEstoque();
        return view('transferencia.create', compact('locaisEstoque'));
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
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
                $movimentacao = new Movimento();
                $movimentacao->loja_id = Auth::user()->current_loja_id;

                $movimentacao->codigo_local_estoque = $request->estoque_origem;
                $movimentacao->id_prod = $produtoId;
                $movimentacao->data = $request->data;
                $movimentacao->tipo = 'TRF';
                $movimentacao->quan = $request->quantidades[$index];
                $movimentacao->valor = str_replace(',', '.', str_replace('.', '', $request->valores[$index]));
                $movimentacao->obs = $request->observacao ?? 'Transferências entre estoques - NTB Estoque';
                $movimentacao->origem = 'AJU';
                $movimentacao->motivo = $request->motivo;
                $movimentacao->codigo_local_estoque_destino = $request->estoque_destino;
                $movimentacao->save();

                // Aqui pode-se implementar lógica para atualizar os estoques de origem e destino
                TransferenciaCreateJob::dispatch($movimentacao);
            }
        });

        return redirect()->route('transferencia.index')->with('success', 'Movimentação registrada com sucesso!');
    }

    /**
     * Busca produto pelo código de QR Code.
     */
    public function buscarProdutoPorQrCode($local, $codigo, $data)
    {
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
    public function show(string $id)
    {
        //
    }

    /**
     * Show the form for editing the specified resource.
     */
    public function edit(string $id)
    {
        //
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, string $id)
    {
        //
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(string $id)
    {
        //
    }
}
