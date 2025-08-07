<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

class CheckCurrentLoja
{
    /**
     * Handle an incoming request.
     *
     * @param  \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = Auth::user();

        // Verifica se o usuário está autenticado e se o campo está nulo
        if ($user && is_null($user->current_loja_id)) {
            return redirect()->route('home.index')->with('error', 'Você precisa selecionar uma loja antes de continuar.');
        }

        return $next($request);
    }
}
