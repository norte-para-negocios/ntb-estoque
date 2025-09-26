<?php

namespace App\Http\Controllers\OrdemProducao;

use App\Exports\RelatorioOrdemProducaoExport;
use App\Http\Controllers\Controller;
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

    public function imprimir(Request $request)
    {
        if (!CanService::canPermissionLoja('Ordens de Produção', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Ordens de Produção!");
        }

        $ordem_producao = $request->get('ordem_producao');
        $data_producao = $request->get('data_producao') ?? '';
        $tipo_produto = $request->get('tipo_produto') ?? '';
        $op_produto = $request->get('op_produto');
        $op_concluido = $request->get('op_concluido');

        session([
            'ordem_producao' => $ordem_producao,
            'data_producao' => $data_producao,
            'tipo_produto' => $tipo_produto,
            'op_produto' => $op_produto,
            'op_concluido' => $op_concluido,
        ]);

        $ordensProducao = OrdemProducao::where('loja_id', Auth::user()->current_loja_id)
            ->when($data_producao, function ($query) use ($data_producao) {
                return $query->whereBetween('adicionais_d_dt_conclusao', [Carbon::parse($data_producao)->startOfDay(), Carbon::parse($data_producao)->endOfDay()]);
            })->when($ordem_producao, function ($query) use ($ordem_producao) {
                $query->where('num_ordem', $ordem_producao);
            })->when($tipo_produto, function ($query) use ($tipo_produto) {
                $query->where('produto_tipo_item', $tipo_produto);
            })->when($op_produto, function ($query) use ($op_produto) {
                $query->where(function ($q) use ($op_produto) {
                    $q->where('produto_codigo', 'like', '%' . $op_produto . '%')
                        ->orWhere('produto_descricao', 'like', '%' . $op_produto . '%');
                });
            })->when(in_array($op_concluido, ['S', 'N']), function ($query) use ($op_concluido) {
                $query->where(function ($query) use ($op_concluido) {
                    $query->where('full_object->outrasInf->cConcluida', '=', $op_concluido);
                });
            })
            ->orderBy('adicionais_d_dt_conclusao', 'asc')
            ->get();

        $pdf = PDF::loadView('ordemproducao.relatorio.pdf', ['ordensProducao' => $ordensProducao, 'loja' => Auth::user()->loja, 'params' => $request->all()]);
        return $pdf->inline("relatorios-ordem-producao.pdf");
    }

    public function excel(Request $request)
    {
        if (!CanService::canPermissionLoja('Relatório - Ordens de Produção', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Relatório - Ordens de Produção!");
        }

        $ordem_producao = $request->get('ordem_producao');
        $data_producao = $request->get('data_producao') ?? '';
        $tipo_produto = $request->get('tipo_produto') ?? '';
        $op_produto = $request->get('op_produto');
        $op_concluido = $request->get('op_concluido');


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
