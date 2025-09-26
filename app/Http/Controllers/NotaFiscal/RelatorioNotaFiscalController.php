<?php

namespace App\Http\Controllers\NotaFiscal;

use App\Http\Controllers\Controller;
use App\Models\NotaFiscal;
use App\Services\CanService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use PDF;


class RelatorioNotaFiscalController extends Controller
{
    public function __construct()
    {
        $this->middleware('auth');
    }

    public function imprimir(Request $request)
    {
        if (!CanService::canPermissionLoja('Notas Fiscais', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Notas Fiscais!");
        }

        $data_inicio = Carbon::parse($request->has('data_inicio') ? $request->get('data_inicio') : session('inicio'));
        $data_final = Carbon::parse($request->has('data_final') ? $request->get('data_final') : session('final'));
        session(['inicio' => $data_inicio->format('Y-m-d'), 'final' => $data_final->format('Y-m-d')]);

        $num_nfe = $request->get('num_nfe');
        $fornecedor = $request->get('fornecedor') ?? '';
        $produto = $request->get('produto') ?? '';
        $tipo = $request->get('tipo') ?? '';
        $status = $request->get('status') ?? '';

        $notasfiscais = NotaFiscal::where('loja_id', auth()->user()->current_loja_id)
            ->with(['nfItems', 'nfItems.produto'])
            ->whereBetween('d_emissao_nfe', [$data_inicio->format('Y-m-d'), $data_final->format('Y-m-d')])
            ->when($num_nfe, function ($query) use ($num_nfe) {
                return $query->where('c_numero_nfe', 'like', '%' . $num_nfe . '%');
            })->when($fornecedor, function ($query) use ($fornecedor) {
                return $query->where('c_nome', 'like', '%' . $fornecedor . '%');
            })->when($status, function ($query) use ($status) {
                if ($status == "C") {
                    return $query->where('c_etapa', '=', '60');
                } elseif ($status == "P") {
                    return $query->where('c_etapa', '<>', '60');
                }
            })->when($produto, function ($query) use ($produto) {
                return $query->whereHas('nfItems', function ($qHas) use ($produto) {
                    $qHas->where('c_descricao_produto', 'like', '%' . $produto . '%')
                        ->orWhere('nfs.c_codigo_produto', 'like', '%' . $produto . '%');
                });
            })->when($tipo, function ($query) use ($tipo) {
                return $query->whereHas('nfItems.produto', function ($qHas) use ($tipo) {
                    $qHas->where('tipo_item', $tipo)
                        ->where('loja_id', auth()->user()->current_loja_id);
                });
            })
            ->orderBy('d_emissao_nfe', 'asc')
            ->get();

        $pdf = PDF::loadView('notafiscal.relatorio.pdf', ['notasfiscais' => $notasfiscais, 'loja' => Auth::user()->loja, 'params' => $request->all()]);
        return $pdf->inline("relatorios-notas-fiscais.pdf");
    }
}
