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

        //dd($ordem_producao, $data_inicio, $data_final);
        //dd($ordenspro);

        foreach ($ordenspro as $op) {
            $produto = $this->omie->getConsultaProduto($op->identificacao->nCodProduto);
            dd($produto->tipoItem, $op->identificacao->nCodProduto);
            if (($produto->tipoItem == "03")
                // && (($request->filled("ordem_producao")) &&  ((int)$op->identificacao->cNumOP == (int)$ordem_producao))
            ) {

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
        try {
            $data_inicio = Carbon::parse($request->query('data_inicio'));
            $data_final = Carbon::parse($request->query('data_final'));
        } catch (\Exception $e) {
            return back()->withErrors(['datas' => 'Datas inválidas fornecidas.']);
        }

        $ordem_producao = $request->query('ordem_producao');

        $ordens_filtradas = [];
        $dadosInfoSection = [];

        $ordenspro = $this->omie->getOrdensPro($data_inicio, $data_final);

        foreach ($ordenspro as $op) {
            $cNumOP = (string) $op->identificacao->cNumOP;

            if (($cNumOP == $ordem_producao && $ordem_producao !== '') || $ordem_producao == '') {

                $produto = $this->omie->getConsultaProduto($op->identificacao->nCodProduto);

                $validade = \App\Models\Op::where('num_ordem', $cNumOP)->first()?->validade;
                $validade_formatada = $validade
                    ? Carbon::parse($validade)->format('d/m/Y')
                    : '';

                $dadosInfoSection[] = [
                    'descricao'   => $produto->descricao ?? '',
                    'lote'        => $cNumOP,
                    'cCodIntOP'   => $op->identificacao->cCodIntOP ?? '',
                    'nCodProduto' => $op->identificacao->nCodProduto ?? '',
                    'nQtde'       => $op->identificacao->nQtde ?? '',
                    'unidade'     => $produto->unidade ?? '',
                    'validade'    => $validade_formatada,
                ];

                $ordens_filtradas[] = $op;
            }
        }

        return view('etiqueta.imprimir', [
            'ordenspro'         => $ordens_filtradas,
            'data_inicio'       => $data_inicio,
            'data_final'        => $data_final,
            'ordem_producao'    => $ordem_producao,
            'dadosInfoSection'  => $dadosInfoSection,
        ]);
    }
}
