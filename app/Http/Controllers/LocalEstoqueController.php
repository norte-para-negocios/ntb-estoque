<?php

namespace App\Http\Controllers;

use App\Models\LocalEstoque;
use App\Services\LocalEstoqueService;
use Illuminate\Http\Request;

class LocalEstoqueController extends Controller
{
    public function __construct()
    {
        $this->middleware('auth');
    }

    public function index(Request $request)
    {
        if (auth()->user()->perfil !== 'Admin') {
            abort(403, "Você não é um usuário Administrador!");
        }

        $locais = LocalEstoque::where('loja_id', auth()->user()->current_loja_id)
            ->when($request->descricao, function ($query, $descricao) {
                $query->where('descricao', 'like', '%' . $descricao . '%');
            })
            ->orderBy('descricao')
            ->paginate(20)
            ->withQueryString();
        return view('local-estoque.index', compact('locais'));
    }

    public function update()
    {
        if (auth()->user()->perfil !== 'Admin') {
            abort(403, "Você não é um usuário Administrador!");
        }

        try {
            $service = new LocalEstoqueService(auth()->user()->loja);
            $service->fetchAll();
            return response()->json(["message" => "Iniciado processamento de atualização dos Locais de Estoque!"], 200);
        } catch (\Throwable $th) {
            return response()->json(["message" => "Ops! Ocorreu um erro ao solicitar atualização dos Locais de Estoque!" . $th->getMessage()], 500);
        }
    }
}
