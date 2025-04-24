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

        $dtInicio = Carbon::parse($request->get('data_inicio'));
        $dtFinal = Carbon::parse($request->get('data_final'));
        $numNFe = $request->get('num_nfe');
   
         $notasfiscais = [];
         $nfes=$this->omie->getNotasFiscais($dtInicio, $dtFinal);
               
        if ($request->filled("num_nfe")) {
            foreach($nfes as $nfe){
                if ((int)$nfe->cabec->cNumeroNFe==(int)$numNFe){
                    array_push($notasfiscais, $nfe);
                }
            }
            /**
             * 1. Pegar recebimento Filtrar na objeto $$notasfiscais por recebimentos->cabec->cNumeroNFe.
             * 2. Achei o recebimento 1 único recebimento então retornar para tela que detalhe o Recebimento listando os produtos do mesmo.
             * 3. Senão retornar com apenas os recebimentos que possuem o número de nota fiscal pesquisado.
             **/

        }
        else{
            $notasfiscais = $nfes;
        }
        return view('notafiscal.index', compact('notasfiscais'));
    }
    
    public function itens(Request $request, $nIdReceb){

        $recebimento=$this->omie->getConsultarRecebimento($nIdReceb);
        return view('notafiscal.itens', compact("recebimento"));
    }

    public function imprimir(Request $request, $nIdReceb, $cCodigoProduto=""){

        $recebimento=$this->omie->getConsultarRecebimento($nIdReceb);
        return view('notafiscal.imprimir', compact("recebimento", "cCodigoProduto"));
    }

}
