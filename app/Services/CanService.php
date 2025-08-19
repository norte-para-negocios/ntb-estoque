<?php

namespace App\Services;

use App\Models\Permissao;
use App\Models\PermissaoUser;
use Illuminate\Support\Facades\Auth;

class CanService
{
    public static function canPermission(string $permissaoNome)
    {
        if ($permissao = Permissao::where('nome', $permissaoNome)->first()) {
            return PermissaoUser::where('user_id', Auth::id())->where('permissao_id', $permissao->id)->count() > 0;
        }
        return false;
    }

    public static function canPermissionLoja(string $permissaoNome, int $lojaId)
    {
        if ($permissao = Permissao::where('nome', $permissaoNome)->first()) {
            return PermissaoUser::where('user_id', Auth::id())->where('permissao_id', $permissao->id)->where('loja_id', $lojaId)->count() > 0;
        }
        return false;
    }
}
