<?php

namespace App\Http\Controllers\Transferencia;

use App\Http\Controllers\Controller;
use App\Models\Movimento;
use App\Services\CanService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use PDF;

class RelatorioTransferenciaController extends Controller
{
    public function __construct()
    {
        $this->middleware('auth');
    }

    public function pdf(Request $request)
    {
        if (!CanService::canPermissionLoja('Relatório - Transferência', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Relatório - Transferência!");
        }

        $data_inicio = Carbon::parse($request->has('data_inicio') ? $request->get('data_inicio') : session('inicio'));
        $data_final = Carbon::parse($request->has('data_final') ? $request->get('data_final') : session('final'));
        session(['inicio' => $data_inicio->format('Y-m-d'), 'final' => $data_final->format('Y-m-d')]);

        $transferencias = Movimento::where('loja_id', Auth::user()->current_loja_id)
            ->where('tipo', 'TRF')
            ->whereBetween('data', [Carbon::parse($data_inicio)->startOfDay(), Carbon::parse($data_final)->endOfDay()])
            ->orderBy('id', 'asc')
            ->get();

        $pdf = PDF::loadView('transferencia.pdf', ['transferencias' => $transferencias, 'loja' => Auth::user()->loja, 'params' => $request->all()]);
        return $pdf->inline("relatorio-transferencias.pdf");
    }
}
