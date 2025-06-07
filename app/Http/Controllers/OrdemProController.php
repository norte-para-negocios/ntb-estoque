<?php

namespace App\Http\Controllers;

use App\Models\Op;
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
        foreach ($ordenspro as $op) {
            $produto = $this->omie->getConsultaProduto($op->identificacao->nCodProduto);
            if (($produto->tipoItem == "03") && (($request->filled("ordem_producao") && ($op->identificacao->cNumOP == $ordem_producao)) || $ordem_producao == "")) {
                array_push($ops, $op);
            }
        }
        $ordenspro = $ops;

        return view('ordemproducao.index', compact('ordenspro', 'data_inicio', 'data_final', 'ordem_producao'));
    }

    public function sincValidade(Request $request)
    {
        $numOrdem = $request->get("num_ordem");
        $validadeRequest = $request->get("validade");
        $op = Op::where('num_ordem', $numOrdem)->first();

        if ($op && isset($op->validade) && $op->validade == $validadeRequest) {
            return $op;
        } else {
            return Op::updateOrCreate(
                ['num_ordem' => $numOrdem],
                ['validade' => $validadeRequest]
            );
        }
    }


    public function imprimir(Request $request)
    {
        $data_inicio = Carbon::parse($request->get('data_inicio') ?? date('Y-m-d'));
        $data_final = Carbon::parse($request->get('data_final') ?? date('Y-m-d'));
        $ordem_producao = $request->query('ordem_producao');
        $ordenspro = $this->omie->getOrdensPro($data_inicio, $data_final);
        $etiquetas = [];
        foreach ($ordenspro as $op) {
            $produto = $this->omie->getConsultaProduto($op->identificacao->nCodProduto);

            if (($produto->tipoItem == "03") && ((($ordem_producao !== "") && ($op->identificacao->cNumOP == $ordem_producao)) || $ordem_producao == "")) {
                $validade = Op::where('num_ordem', $op->identificacao->cNumOP)
                    ->first();
                $etiquetas[] = [
                    'codigo_produto' => $produto->codigo ?? '',
                    'descricao'   => $produto->descricao ?? '',
                    'lote'        => $op->identificacao->cNumOP ?? '',
                    'quantidade'  => $op->identificacao->nQtde ?? '' . ' ' . $produto->unidade ?? '',
                    'validade'    => $validade ? $validade->validade->format('d/m/Y') : '',
                ];
            }
        }

        // Gerar PDF
        $pdf = PDF::loadView('etiqueta.imprimir', [
            'etiquetas' => $etiquetas,
        ])
            ->setOption('margin-top', 5)
            ->setOption('margin-bottom', 5)
            ->setOption('margin-left', 5)
            ->setOption('margin-right', 5)
            ->setOption('page-size', 'A4')
            ->setOption('orientation', 'portrait')
            ->setOption('enable-local-file-access', true);

        return $pdf->stream('etiquetas_op.pdf');


        // return view('etiqueta.imprimir', [
        //     'etiquetas' => $etiquetas,
        // ]);
    }
}
