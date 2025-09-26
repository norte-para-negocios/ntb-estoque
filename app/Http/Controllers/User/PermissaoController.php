<?php

namespace App\Http\Controllers\User;

use App\Http\Controllers\Controller;
use App\Models\Loja;
use App\Models\Permissao;
use App\Models\PermissaoUser;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class PermissaoController extends Controller
{
    public function __construct()
    {
        $this->middleware('auth');
    }

    public function attach(Request $request, User $user)
    {
        if (auth()->user()->perfil !== 'Admin') {
            abort(403, "Você não é um usuário Administrador!");
        }

        try {
            $user->permissoes()->attach($request->get('permissao_id'), ['loja_id' => $request->get('loja_id')]);
            return response(['success', 'Registro realizado com sucesso!']);
        } catch (\Throwable $th) {
            return response(['error', $th->getMessage()]);
        }
    }

    public function detach(Request $request, User $user, Loja $loja, Permissao $permissao)
    {
        if (auth()->user()->perfil !== 'Admin') {
            abort(403, "Você não é um usuário Administrador!");
        }

        try {
            PermissaoUser::where('user_id', $user->id)
                ->where('loja_id', $loja->id)
                ->where('permissao_id', $permissao->id)
                ->delete();
            return response(['success', 'Registro excluído com sucesso!']);
        } catch (\Throwable $th) {
            return response(['error', $th->getMessage()]);
        }
    }
}
