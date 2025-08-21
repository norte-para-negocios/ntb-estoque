<?php

namespace App\Http\Controllers;

use App\Models\Loja;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class LojaController extends Controller
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
        if (Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não é um usuário Administrador!");
        }

        $query = Loja::orderBy('nome_fantasia');
        if ($request->filled('search')) {
            $query->where('cnpj', 'like', "%{$request->get('search')}%")
                ->orWhere('nome', 'like', "%{$request->get('search')}%");
        }
        $lojas = $query->get();
        return view('loja.index', compact('lojas'));
    }

    /**
     * Show the form for creating a new resource.
     */
    public function create()
    {
        if (Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não é um usuário Administrador!");
        }

        $loja = new Loja();
        $action = 'create';
        return view('loja.loja', compact('action', 'loja'));
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        if (Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não é um usuário Administrador!");
        }

        try {
            $loja = new Loja();
            $loja->cnpj = $request->get('cnpj');
            $loja->nome = $request->get('nome');
            $loja->nome_fantasia = $request->get('fantasia');
            $loja->cep = $request->get('cep');
            $loja->uf = $request->get('uf');
            $loja->cidade = $request->get('cidade');
            $loja->bairro = $request->get('bairro');
            $loja->logradouro = $request->get('logradouro');
            $loja->numero = $request->get('numero');
            $loja->omie_app_key = $request->get('omie_app_key');
            $loja->omie_app_secret = $request->get('omie_app_secret');
            $loja->ativo = $request->has('ativo') ? true : false;
            $loja->save();
            return redirect()->route('loja.index')->with('success', 'Registro cadastrado com sucesso!');
        } catch (\Throwable $th) {
            return redirect()->route('loja.index')->with('error', $th->getMessage());
        }
    }

    /**
     * Show the form for editing the specified resource.
     */
    public function edit(Loja $loja)
    {
        if (Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não é um usuário Administrador!");
        }

        $action = 'edit';
        return view('loja.loja', compact('action', 'loja'));
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, Loja $loja)
    {
        if (Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não é um usuário Administrador!");
        }

        try {
            $update = [
                'cnpj' => $request->get('cnpj'),
                'nome' => $request->get('nome'),
                'nome_fantasia' => $request->get('fantasia'),
                'cep' => $request->get('cep'),
                'uf' => $request->get('uf'),
                'cidade' => $request->get('cidade'),
                'bairro' => $request->get('bairro'),
                'logradouro' => $request->get('logradouro'),
                'numero' => $request->get('numero'),
                'omie_app_key' => $request->get('omie_app_key'),
                'omie_app_secret' => $request->get('omie_app_secret'),
                'ativo' => $request->has('ativo') ? true : false,
            ];
            $loja->update($update);
            return redirect()->route('loja.index')->with('success', 'Registro atualizado com sucesso!');
        } catch (\Throwable $th) {
            return redirect()->route('loja.index')->with('error', $th->getMessage());
        }
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Loja $loja)
    {
        if (Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não é um usuário Administrador!");
        }

        try {
            $loja->delete();
            return redirect()->route('loja.index')->with('success', 'Registro excluído com sucesso!');
        } catch (\Throwable $th) {
            return redirect()->route('loja.index')->with('error', $th->getMessage());
        }
    }
}
