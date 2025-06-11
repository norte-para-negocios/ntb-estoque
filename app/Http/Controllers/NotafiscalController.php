<?php

namespace App\Http\Controllers;

use Carbon\Carbon;
use App\Services\OmieService;
use Illuminate\Http\Request;
use PDF;

class NotafiscalController extends Controller
{
    private $omie;

    public function __construct()
    {
        $this->middleware('auth');
        $this->omie = new OmieService();
    }

    public function index(Request $request)
    {
        $data_inicio = Carbon::parse($request->has('data_inicio') ? $request->get('data_inicio') : session('inicio'));
        $data_final = Carbon::parse($request->has('data_final') ? $request->get('data_final') : session('final'));
        session(['inicio' => $data_inicio->format('Y-m-d'), 'final' => $data_final->format('Y-m-d')]);

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
                        'descricao'     => $it->itensCabec->cDescricaoProduto ?? '',
                        'lote'          => "",
                        'quantidade'    => (number_format(($it->itensAjustes->nQtdeRecebida ?? 0), 3, ',', '') . ' ' . ($produto->unidade ?? '')),
                        'validade'      => $it->itensCabec->nIdValidade ?? '',
                        'fornecedor'    => $recebimento->cabec->cNome ?? '',
                        'nfe'           => intval($recebimento->cabec->cNumeroNFe),
                    ];
                }
            }
        }

        // Gerar PDF
        $pdf = PDF::loadView('etiqueta.imprimir', compact('etiquetas'))
            ->setOption('margin-top', 0)
            ->setOption('margin-bottom', 0)
            ->setOption('margin-left', 0)
            ->setOption('margin-right', 0)
            ->setOption('page-width', '72.56')
            ->setOption('page-height', '40.04')
            ->setOption('orientation', 'portrait')
            ->setOption('enable-local-file-access', true);

        return $pdf->stream("etiquetas_nfe_{$recebimento->cabec->cNumeroNFe}.pdf");
    }
}
