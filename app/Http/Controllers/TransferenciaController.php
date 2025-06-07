<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\Transferencia;
use Illuminate\Support\Facades\DB;
use App\Services\OmieService;
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
        $transferencias = Transferencia::all();
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
            'tipo_movimento' => 'required|string',
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
                $movimentacao = new Transferencia();
                $movimentacao->produto_id = $produtoId;
                $movimentacao->tipo_movimento = $request->tipo_movimento;
                $movimentacao->data = $request->data;
                $movimentacao->local_origem_id = $request->estoque_origem;
                $movimentacao->local_destino_id = $request->estoque_destino;
                $movimentacao->motivo = $request->motivo;
                $movimentacao->quantidade = $request->quantidades[$index];
                $movimentacao->valor_unitario = $request->valores[$index];
                $movimentacao->observacao = $request->observacao ?? null;
                $movimentacao->save();

                // Aqui pode-se implementar lógica para atualizar os estoques de origem e destino
            }
        });

        return redirect()->route('transferencia.index')->with('success', 'Movimentação registrada com sucesso!');
    }

    /**
     * Busca produto pelo código de QR Code.
     */
    public function buscarProdutoPorQrCode($codigo)
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
                    'valor_unitario' => $produto->valor_unitario,
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
