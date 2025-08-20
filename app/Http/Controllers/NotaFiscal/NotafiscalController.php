<?php

namespace App\Http\Controllers\NotaFiscal;

use App\Http\Controllers\Controller;
use App\Models\NotaFiscal;
use App\Models\NotaFiscalItem;
use App\Models\Produto;
use App\Services\CanService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use PDF;

class NotafiscalController extends Controller
{
    public function __construct()
    {
        $this->middleware('auth');
    }

    public function index(Request $request)
    {
        if (!CanService::canPermissionLoja('Notas Fiscais', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
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
            ->orderBy('d_emissao_nfe', 'desc')
            ->paginate(20)
            ->withQueryString();

        return view('notafiscal.index', compact('notasfiscais', 'data_inicio', 'data_final', 'num_nfe', 'fornecedor', 'produto', 'tipo', 'status'));
    }

    public function itens(Request $request, NotaFiscal $notaFiscal)
    {
        if (!CanService::canPermissionLoja('Notas Fiscais', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Notas Fiscais!");
        }

        return view('notafiscal.itens', compact("notaFiscal"));
    }

    public function setQuantidade(Request $request, NotaFiscalItem $notaFiscalItem)
    {
        if (!CanService::canPermissionLoja('Notas Fiscais', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Notas Fiscais!");
        }

        if (($notaFiscalItem->quantidade !== null) && $notaFiscalItem->quantidade == $request->get('quantidade')) {
            return $notaFiscalItem;
        } else {
            $notaFiscalItem->quantidade = $request->get('quantidade') ?? null;
            $notaFiscalItem->save();
        }
    }

    public function imprimir(Request $request, NotaFiscal $notaFiscal, $nIdProduto = "")
    {
        if (!CanService::canPermissionLoja('Notas Fiscais', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Notas Fiscais!");
        }

        $etiquetas = [];

        foreach ($notaFiscal->nfItems as $item) {
            if ($item->produto) {
                $qtde = ($item->produto->unidade == 'UN') ? ($item->quantidade ?? 1) : 1;
                if (($item->n_id_produto == $nIdProduto && $nIdProduto !== '') || $nIdProduto == '') {
                    if ($item->produto->unidade == 'UN') {
                        $quantidade = number_format($qtde, 0, ',', '.') . '(' . ($item->produto->unidade ?? '') . ')';
                    } else {
                        $quantidade = number_format((float)json_decode($item->full_object)->itensAjustes->nQtdeRecebida ?? 0, 3, ',', '.') . ' (' . ($item->produto->unidade ?? '') . ')';
                    }

                    $etiquetas[] = [
                        'codigo_produto' => $item->produto->codigo ?? '',
                        'descricao' => $item->c_descricao_produto ?? '',
                        'lote' => "",
                        'quantidade' => '',
                        'qtde_nf' => json_decode($item->full_object)->itensAjustes->nQtdeRecebida . '(' . ($item->produto->unidade ?? '') . ')',
                        'qtde_etiqueta' => $quantidade,
                        'validade' => json_decode($item->full_object)->itensCabec->nIdValidade ?? '',
                        'inclusao' => json_decode($item->full_object)->infoCadastro->dRec ?? '15/05/2025',
                        'produzido' => '',
                        'fornecedor' => $notaFiscal->c_nome ?? '',
                        'nfe' => intval($notaFiscal->c_numero_nfe),
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
            ->setOption('orientation', 'portrait');

        if (config('app.env') === 'local-estoque') {
            return $pdf->inline("etiquetas_nfe_{$notaFiscal->c_numero_nfe}.pdf");
        }

        if ($nIdProduto !== '') {
            $prod = Produto::where('loja_id', auth()->user()->current_loja_id)->where('codigo_produto', $nIdProduto)->first();
            $arquivo_nome = Str::slug("etiqueta_nfe_" . $notaFiscal->c_numero_nfe . "_" . ($prod->descricao ?? $nIdProduto)) . ".pdf";
        } else {
            $arquivo_nome = Str::slug("etiquetas_nfe_" . $notaFiscal->c_numero_nfe) . "_" . ($notaFiscal->c_nome ?? '') . ".pdf";
        }
        return $pdf->download($arquivo_nome);
    }
}
