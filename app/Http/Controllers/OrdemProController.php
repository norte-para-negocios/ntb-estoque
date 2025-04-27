<?php

namespace App\Http\Controllers;

use App\Services\OmieService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use SimpleSoftwareIO\QrCode\Facades\QrCode;
use PDF;

class OrdemProController extends Controller
{
    private $omie;

    public function __construct()
    {
        $this->omie = new OmieService();
    }

    public function index(Request $request)
    {

        $data_inicio = Carbon::parse($request->get('data_inicio'));
        $data_final = Carbon::parse($request->get('data_final'));

        $ordem_producao = $request->get('ordem_producao');

        $ops = [];
        $ordenspro = $this->omie->getOrdensPro($data_inicio, $data_final);

        if ($request->filled("ordem_producao")) {
            foreach ($ordenspro as $op) {
                if ((int)$op->identificacao->cNumOP == (int)$ordem_producao) {
                    array_push($ops, $op);
                }
            }
            $ordenspro = $ops;
        }

        return view('ordemproducao.index', compact('ordenspro', 'data_inicio', 'data_final', 'ordem_producao'));
    }
}
