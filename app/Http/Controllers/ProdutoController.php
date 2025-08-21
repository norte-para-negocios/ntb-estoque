<?php

namespace App\Http\Controllers;

use App\Models\Produto;
use App\Services\ProdutoService;
use Illuminate\Http\Request;

class ProdutoController extends Controller
{
    public function index(Request $request)
    {
        $produtos = Produto::where('loja_id', auth()->user()->current_loja_id)
            ->when($request->search, function ($query, $search) {
                $query->where('descricao', 'like', '%' . $search . '%');
            })
            ->orderBy('descricao_familia', 'asc')
            ->orderBy('descricao', 'asc')
            ->paginate(50)
            ->withQueryString();
        return view('produto.index', compact('produtos'));
    }

    public function update()
    {
        try {
            $service = new ProdutoService(auth()->user()->loja);
            $service->fetchAll();
            return response()->json(["message" => "Iniciado processamento de atualização dos Produtos!"], 200);
        } catch (\Throwable $th) {
            return response()->json(["message" => "Ops! Ocorreu um erro ao solicitar atualização dos Produtos!" . $th->getMessage()], 500);
        }
    }
}
