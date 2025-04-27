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

    public function ordempro(Request $request)
    {

        $dtInicio = Carbon::parse($request->get('data_inicio'));
        $dtFinal = Carbon::parse($request->get('data_final'));
        
        $ordenspro=$this->omie->getOrdensPro($dtInicio, $dtFinal);
        return view('notafiscal.ordenspro', compact('ordenspro'));
    }
}
