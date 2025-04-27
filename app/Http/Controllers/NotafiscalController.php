<?php

namespace App\Http\Controllers;

use App\Services\OmieService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use SimpleSoftwareIO\QrCode\Facades\QrCode;
use PDF;

class NotafiscalController extends Controller
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
        $num_nfe = $request->get('num_nfe');

        $notasfiscais = [];
        $nfes = $this->omie->getNotasFiscais($data_inicio, $data_final);

        if ($request->filled("num_nfe")) {
            foreach ($nfes as $nfe) {
                if ((int)$nfe->cabec->cNumeroNFe == (int)$num_nfe) {
                    array_push($notasfiscais, $nfe);
                }
            }
        } else {
            $notasfiscais = $nfes;
        }
        return view('notafiscal.index', compact('notasfiscais', 'data_inicio', 'data_final', 'num_nfe'));
    }

    public function itens(Request $request, $nIdReceb)
    {
        $recebimento = $this->omie->getConsultarRecebimento($nIdReceb);
        return view('notafiscal.itens', compact("recebimento"));
    }

    public function imprimir(Request $request, $nIdReceb, $cCodigoProduto = "")
    {

        $recebimento = $this->omie->getConsultarRecebimento($nIdReceb);
        return view('notafiscal.imprimir', compact("recebimento", "cCodigoProduto"));
    }
}
