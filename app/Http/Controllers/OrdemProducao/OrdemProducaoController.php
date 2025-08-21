<?php

namespace App\Http\Controllers\OrdemProducao;

use App\Http\Controllers\Controller;
use App\Models\OrdemProducao;
use App\Services\CanService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use PDF;

class OrdemProducaoController extends Controller
{
    public function __construct()
    {
        $this->middleware('auth');
    }

    public function index(Request $request)
    {
        if (!CanService::canPermissionLoja('Ordens de Produção', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Ordens de Produção!");
        }

        $ordem_producao = $request->get('ordem_producao');
        $data_producao = $request->get('data_producao') !== null ? $request->get('data_producao') : date('Y-m-d');
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
            ->orderBy('adicionais_d_dt_conclusao', 'desc')
            ->paginate(20)
            ->withQueryString();

        return view('ordemproducao.index', compact('ordensProducao', 'ordem_producao', 'data_producao', 'tipo_produto', 'op_produto'));
    }

    public function setValidade(Request $request, OrdemProducao $ordemProducao)
    {
        if (!CanService::canPermissionLoja('Ordens de Produção', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Ordens de Produção!");
        }

        if ($request->filled('validade')) {
            $ordemProducao->validade = Carbon::parse($request->get('validade'));
        } else {
            $ordemProducao->validade = null;
        }
        $ordemProducao->save();
    }


    public function imprimir(Request $request, OrdemProducao $ordemProducao)
    {
        if (!CanService::canPermissionLoja('Ordens de Produção', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Ordens de Produção!");
        }

        $etiquetas = [];
        $qtde = ($ordemProducao->produto_unidade == 'UN') ? ($ordemProducao->identificacao_n_qtde ?? '1') : 1;

        for ($i = 1; $i <= $qtde; $i++) {
            if ($ordemProducao->produto_unidade == 'UN') {
                $quantidade = $i . ' de ' . number_format($qtde, 0, '', '') . ' (UN)';
            } else {
                $quantidade = number_format($ordemProducao->identificacao_n_qtde, 3, ',' . '.') . ' (' . ($ordemProducao->produto_unidade ?? '') . ')';
            }

            $etiquetas[] = [
                'codigo_produto' => $ordemProducao->produto_codigo ?? '',
                'descricao' => $ordemProducao->produto_descricao ?? '',
                'lote' => $ordemProducao->identificacao_c_num_op ?? '',
                'quantidade' => $quantidade,
                'qtde_nf' => '',
                'qtde_etiqueta' => '',
                'inclusao' => '',
                'validade' => $ordemProducao->validade !== null ? $ordemProducao->validade->format('d/m/Y') : '-',
                'produzido' => json_decode($ordemProducao->full_object)->outrasInf->dConclusao !== "" ? json_decode($ordemProducao->full_object)->outrasInf->dConclusao : Carbon::now()->format('d/m/Y'),
                'fornecedor' => '',
                'nfe' => '',
            ];
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
            ->setOption('orientation', 'portrait');

        if (config('app.env') === 'local-estoque') {
            return $pdf->inline('etiquetas_op.pdf');
        }
        return $pdf->download('etiquetas_op.pdf');
    }
}
