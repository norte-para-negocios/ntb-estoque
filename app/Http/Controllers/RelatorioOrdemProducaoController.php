<?php

namespace App\Http\Controllers;

use App\Exports\RelatorioOrdemProducaoExport;
use App\Models\OrdemProducao;
use App\Services\CanService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Maatwebsite\Excel\Facades\Excel;
use PDF;

class RelatorioOrdemProducaoController extends Controller
{
    public function __construct()
    {
        $this->middleware('auth');
    }

    public function index(Request $request)
    {
        if (!CanService::canPermissionLoja('Relatório - Ordens de Produção', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Relatório - Ordens de Produção!");
        }

        return view('ordemproducao.relatorio.index');
    }

    public function imprimir(Request $request)
    {
        if (!CanService::canPermissionLoja('Relatório - Ordens de Produção', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Relatório - Ordens de Produção!");
        }
        
        $ordem_producao = $request->get('ordem_producao');
        $data_producao = $request->get('data_producao') ?? '';
        $tipo_produto = $request->get('tipo_produto') ?? '';
        $op_produto = $request->get('op_produto');
        $op_concluido = $request->get('op_concluido');

        //dd($ordem_producao, $data_producao, $tipo_produto, $op_produto, $op_concluido);

        session([
            'ordem_producao' => $ordem_producao,
            'data_producao' => $data_producao,
            'tipo_produto' => $tipo_produto,
            'op_produto' => $op_produto,
            'op_concluido' => $op_concluido,
        ]);

        $queryOrdemProducao = OrdemProducao::where('loja_id', Auth::user()->current_loja_id)
            ->when($data_producao, function ($query) use ($data_producao) {
                return $query->whereBetween('adicionais_d_dt_conclusao', [Carbon::parse($data_producao)->startOfDay(), Carbon::parse($data_producao)->endOfDay()]);
            })
            ->orderBy('adicionais_d_dt_conclusao', 'desc');

            //dd($queryOrdemProducao);

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

        if (in_array($op_concluido, ['S', 'N'])) {
            $queryOrdemProducao->where(function ($query) use ($op_concluido) {
                $query->where('full_object->outrasInf->cConcluida', '=', $op_concluido);
            });
        }

        $ordenspro = $queryOrdemProducao->get(); //Alterado de get para dd

        //dd($ordenspro);

        $pdf = PDF::loadView('ordemproducao.relatorio.pdf', ['ordenspro' => $ordenspro, 'loja' => Auth::user()->loja, 'params' => $request->all()])
            ->setOption('enable-local-file-access', true);
            //dd($pdf);

        return $pdf->inline("relatorios-ordem-producao.pdf");
    }

    public function excel(Request $request)
    {
        if (!CanService::canPermissionLoja('Relatório - Ordens de Produção', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Relatório - Ordens de Produção!");
        }

        $ordem_producao = $request->get('ordem_producao');
        $data_producao = $request->get('data_producao') ?? '';
        $tipo_produto = $request->get('tipo_produto') ?? '';
        $op_produto = $request->get('op_produto');
        $op_concluido = $request->get('op_concluido');

        //dd($ordem_producao, $data_producao, $tipo_produto, $op_produto, $op_concluido);

        session([
            'ordem_producao' => $ordem_producao,
            'data_producao' => $data_producao,
            'tipo_produto' => $tipo_produto,
            'op_produto' => $op_produto,
            'op_concluido' => $op_concluido,
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
        if (in_array($op_concluido, ['S', 'N'])) {
            $queryOrdemProducao->where(function ($query) use ($op_concluido) {
                $query->where('full_object->outrasInf->cConcluida', '=', $op_concluido);
            });
        }

        $ordenspro = $queryOrdemProducao->get();

        return Excel::download(new RelatorioOrdemProducaoExport($ordenspro, Auth::user()->loja, $request->all()), "relatorio-ordens-de-producao" . date('YmdHis') . '.xlsx');
    }
}
