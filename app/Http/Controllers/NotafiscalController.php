<?php

namespace App\Http\Controllers;

use App\Services\OmieService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class NotafiscalController extends Controller
{
    public function index(Request $request)
    {
        $omie = new OmieService();
        $dtInicio = Carbon::parse($request->get('data_inicio'));
        $dtFinal = Carbon::parse($request->get('data_final'));
        $chaveNfe = $request->get('chave_nfe');
        
        if (is_null($chaveNfe)) {
            $notasfiscais = $omie->getNotasFiscais($dtInicio, $dtFinal);
        } else {
            $notasfiscais = $omie->getNotaFiscalPorChave($chaveNfe);
        }
        return view('notafiscal.index', compact('notasfiscais'));
    }
}
