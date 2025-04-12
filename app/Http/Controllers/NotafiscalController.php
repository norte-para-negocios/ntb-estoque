<?php

namespace App\Http\Controllers;

use App\Services\OmieService;
use Carbon\Carbon;
use Illuminate\Http\Request;

class NotafiscalController extends Controller
{
    public function index(Request $request)
    {
        $omie = new OmieService();
        $dtInicio = Carbon::now($request->get('dtInicio'));
        $dtFinal = Carbon::now($request->get('dtInicio'));

        $notasfiscais = $omie->getNotasFiscais($dtInicio, $dtFinal);

        return view('notafiscal.index', compact('notasfiscais'));
    }
}
