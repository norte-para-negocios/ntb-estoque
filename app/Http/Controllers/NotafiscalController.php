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

    public function imprimir(Request $request, $nIdReceb, $nIdProduto = "")
    {
        $etiquetas = [];

        $recebimento = $this->omie->getConsultarRecebimento($nIdReceb);

        foreach ($recebimento->itensRecebimento as $it) {
            if ($it->itensCabec->nIdProduto > 0) {
                $produto = $this->omie->getConsultaProduto($it->itensCabec->nIdProduto);
                if (($it->itensCabec->nIdProduto == $nIdProduto && $nIdProduto !== '') || $nIdProduto == '') {
                    $etiquetas[] = [
                        'codigo_produto' => $produto->codigo ?? '',
                        'descricao'   => $it->itensCabec->cDescricaoProduto ?? '',
                        'lote'        => $recebimento->cabec->cNumeroNFe ?? '',
                        'quantidade'  => $it->itensAjustes->nQtdeRecebida ?? '' . ' ' . $it->itensAjustes->cUnidade ?? '',
                        'validade'    => $it->itensCabec->nIdValidade ?? '',
                    ];
                }
            }
        }

        // Gerar PDF
        $pdf = PDF::loadView('etiqueta.imprimir', compact('etiquetas'))
            ->setOption('margin-top', 5)
            ->setOption('margin-bottom', 5)
            ->setOption('margin-left', 5)
            ->setOption('margin-right', 5)
            // ->setOption('page-size', 'A4')
            ->setOption('page-width', '40')
            ->setOption('page-height', '70')
            ->setOption('orientation', 'portrait')
            ->setOption('enable-local-file-access', true);

        return $pdf->stream('etiquetas_Nfe.pdf');


        // return view('etiqueta.imprimir', [

        //     'etiquetas' => $etiquetas,
        // ]);
    }
}
