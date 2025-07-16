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

        $ops = [];

        $ordem_producao = $request->get('ordem_producao');
        $data_producao = $request->get('data_producao') ?? '';
        $tipo_produto = $request->get('tipo_produto') ?? '';
        $op_produto = $request->get('op_produto');

        session([
            'ordem_producao' => $ordem_producao,
            'data_producao' => $data_producao,
            'tipo_produto' => $tipo_produto,
            'op_produto' => $op_produto,
        ]);

        $queryOrdemProducao = OrdemProducao::where('loja_id', Auth::user()->current_loja_id)
            ->when($data_producao, function ($query) use ($data_producao) {
                return $query->whereBetween('adicionais_d_dt_conclusao', [Carbon::parse($data_producao)->startOfDay(), Carbon::parse($data_producao)->endOfDay()]);
            })
            ->orderBy('adicionais_d_dt_conclusao', 'desc');

        if ($request->filled("ordem_producao")) {
            $queryOrdemProducao->where('num_ordem', $ordem_producao);
        }
        if ($request->filled("tipo_produto")) {
            $queryOrdemProducao->where('produto_tipo_item', $tipo_produto);
        }
        if ($request->filled("op_produto")) {
            $queryOrdemProducao->where(function ($query) use ($op_produto) {
                $query->where('produto_codigo', 'like', '%' . $op_produto . '%')
                    ->orWhere('produto_descricao', 'like', '%' . $op_produto . '%');
            });
        }

        $ordenspro = $queryOrdemProducao->paginate(20);

        return view('ordemproducao.index', compact('ordenspro', 'ordem_producao', 'data_producao', 'tipo_produto', 'op_produto'));
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


    public function imprimir(Request $request, OrdemProducao $ordemProducao)
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

            if ($produto && ($produto->tipoItem ?? "" == "03") && ((($ordem_producao !== "") && ($op->identificacao->cNumOP == $ordem_producao)) || $ordem_producao == "")) {
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
                    'quantidade'    => 1,
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
