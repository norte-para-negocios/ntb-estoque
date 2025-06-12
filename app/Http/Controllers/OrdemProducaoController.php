<?php

namespace App\Http\Controllers;

use App\Models\OrdemProducao;
use App\Services\CanService;
use App\Services\OmieService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use PDF;

class OrdemProducaoController extends Controller
{
    private $omie;

    public function __construct()
    {
        $this->middleware('auth');
        $this->omie = new OmieService();
    }

    public function index(Request $request)
    {
        if (!CanService::canPermissionLoja('Ordens de Produção', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Ordens de Produção!");
        }

        $data_inicio = Carbon::parse($request->has('data_inicio') ? $request->get('data_inicio') : session('inicio'));
        $data_final = Carbon::parse($request->has('data_final') ? $request->get('data_final') : session('final'));
        $ordem_producao = $request->get('ordem_producao');

        session(['inicio' => $data_inicio->format('Y-m-d'), 'final' => $data_final->format('Y-m-d')]);
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
        if (!CanService::canPermissionLoja('Ordens de Produção', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Ordens de Produção!");
        }

        $numOrdem = $request->get("num_ordem");
        $validadeRequest = $request->get("validade");
        $op = OrdemProducao::where('num_ordem', $numOrdem)->first();

        if ($op && isset($op->validade) && $op->validade == $validadeRequest) {
            return $op;
        } else {
            return OrdemProducao::updateOrCreate(
                [
                    'num_ordem' => $numOrdem,
                    'loja_id' => Auth::user()->current_loja_id,
                ],
                ['validade' => $validadeRequest]
            );
        }
    }


    public function imprimir(Request $request)
    {
        if (!CanService::canPermissionLoja('Ordens de Produção', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Ordens de Produção!");
        }

        $data_inicio = Carbon::parse($request->get('data_inicio') ?? date('Y-m-d'));
        $data_final = Carbon::parse($request->get('data_final') ?? date('Y-m-d'));
        $ordem_producao = $request->query('ordem_producao');
        $ordenspro = $this->omie->getOrdensPro($data_inicio, $data_final);
        $etiquetas = [];
        foreach ($ordenspro as $op) {
            $produto = $this->omie->getConsultaProduto($op->identificacao->nCodProduto);

            if (($produto->tipoItem == "03") && ((($ordem_producao !== "") && ($op->identificacao->cNumOP == $ordem_producao)) || $ordem_producao == "")) {
                $validade = OrdemProducao::where('num_ordem', $op->identificacao->cNumOP)
                    ->first();
                $etiquetas[] = [
                    'codigo_produto' => $produto->codigo ?? '',
                    'descricao'   => $produto->descricao ?? '',
                    'lote'        => $op->identificacao->cNumOP ?? '',
                    'quantidade'  => ($op->identificacao->nQtde ?? '') . ' ' . $produto->unidade ?? '',
                    'validade'    => $validade ? $validade->validade->format('d/m/Y') : '',
                    'fornecedor'    => '',
                    'nfe'           => '',
                ];
            }
        }

        // Gerar PDF
        $pdf = PDF::loadView(
            'etiqueta.imprimir',
            compact('etiquetas')
        )->setOption('margin-top', 0)
            ->setOption('margin-bottom', 0)
            ->setOption('margin-left', 0)
            ->setOption('margin-right', 0)
            ->setOption('page-width', '72.56')
            ->setOption('page-height', '40.04')
            ->setOption('orientation', 'portrait')
            ->setOption('enable-local-file-access', true);

        return $pdf->download('etiquetas_op.pdf');
    }
}
