<?php

namespace App\Http\Controllers;

use App\Models\Produto;
use App\Services\CanService;
use App\Services\ProdutoService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class ProdutoController extends Controller
{
    public function __construct()
    {
        $this->middleware('auth');
    }

    public function index(Request $request)
    {
        if (!CanService::canPermissionLoja('Produtos - Ver', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Produtos - Ver!");
        }

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
        if (!CanService::canPermissionLoja('Produtos - Sincronizar', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Produtos - Sincronizar!");
        }

        try {
            $service = new ProdutoService(auth()->user()->loja);
            $service->fetchAll();
            return response()->json(["message" => "Iniciado processamento de atualização dos Produtos!"], 200);
        } catch (\Throwable $th) {
            return response()->json(["message" => "Ops! Ocorreu um erro ao solicitar atualização dos Produtos!" . $th->getMessage()], 500);
        }
    }
}
