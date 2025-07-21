<?php

namespace App\Http\Controllers;

use App\Models\Nf;
use App\Services\CanService;
use Carbon\Carbon;
use App\Services\OmieService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
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

        $notasfiscais = [];
        $nfes = $this->omie->getNotasFiscais($data_inicio, $data_final);

        if ($request->filled("num_nfe") || $request->filled("fornecedor") || $request->filled("produto") || $request->filled("tipo") || $request->filled("status")) {
            foreach ($nfes as $nfe) {
                if (
                    $request->filled("num_nfe") &&
                    ((int)$nfe->cabec->cNumeroNFe == (int)$num_nfe) &&
                    (!in_array($nfe, $notasfiscais))
                ) {
                    array_push($notasfiscais, $nfe);
                }

                if (
                    $request->filled("fornecedor") &&
                    (stripos($nfe->cabec->cNome, $fornecedor) !== false) &&
                    (!in_array($nfe, $notasfiscais))
                ) {
                    array_push($notasfiscais, $nfe);
                }

                if (
                    $request->filled("status") &&
                    (
                        (((int)$nfe->cabec->cEtapa === 60) && ($status == "C")) ||
                        (((int)$nfe->cabec->cEtapa !== 60) && ($status == "P"))
                    ) &&
                    (!in_array($nfe, $notasfiscais))
                ) {
                    array_push($notasfiscais, $nfe);
                }

                if ($request->filled("produto")) {
                    foreach ($nfe->itensRecebimento as $item) {
                        if (
                            ((stripos($item->itensCabec->cDescricaoProduto, $produto) !== false) || (stripos($item->itensCabec->cCodigoProduto, $produto) !== false)) &&
                            (!in_array($nfe, $notasfiscais))
                        ) {
                            array_push($notasfiscais, $nfe);
                        }
                    }
                }

                if ($request->filled("tipo")) {
                    foreach ($nfe->itensRecebimento as $item) {
                        $prod = $this->omie->getConsultaProduto($item->itensCabec->nIdProduto);
                        if (
                            isset($prod->tipoItem) &&
                            ((int)$prod->tipoItem == (int)$tipo) &&
                            (!in_array($nfe, $notasfiscais))
                        ) {
                            array_push($notasfiscais, $nfe);
                        }
                    }
                }
            }
        } else {
            $notasfiscais = $nfes;
        }
        return view('notafiscal.index', compact('notasfiscais', 'data_inicio', 'data_final', 'num_nfe', 'fornecedor', 'produto', 'tipo', 'status'));
    }

    public function itens(Request $request, $nIdReceb)
    {
        if (!CanService::canPermissionLoja('Notas Fiscais', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Notas Fiscais!");
        }

        $recebimento = $this->omie->getConsultarRecebimento($nIdReceb);
        return view('notafiscal.itens', compact("recebimento"));
    }

    public function setQuantidade(Request $request, string $nIdReceb, string $codigo)
    {
        if (!CanService::canPermissionLoja('Notas Fiscais', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Notas Fiscais!");
        }

        $nf = Nf::where('n_id_receb', $nIdReceb)->where('produto_codigo', $codigo)->first();

        if ($nf && isset($nf->quantidade) && $nf->$nf == $request->get('quantidade')) {
            return $nf;
        } else {
            return Nf::updateOrCreate(
                [
                    'loja_id' => Auth::user()->current_loja_id,
                    'n_id_receb' => $nIdReceb,
                    'produto_codigo' => $codigo,
                ],
                [
                    'quantidade' => $request->get('quantidade')
                ]
            );
        }
    }

    public function imprimir(Request $request, $nIdReceb, $nIdProduto = "")
    {
        if (!CanService::canPermissionLoja('Notas Fiscais', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Notas Fiscais!");
        }

        $etiquetas = [];
        $recebimento = $this->omie->getConsultarRecebimento($nIdReceb);

        foreach ($recebimento->itensRecebimento as $it) {
            if ($it->itensCabec->nIdProduto > 0) {
                $produto = $this->omie->getConsultaProduto($it->itensCabec->nIdProduto);
                $nf = Nf::where('n_id_receb', $nIdReceb)->where('produto_codigo', $it->itensCabec->nIdProduto)->first();
                $qtde = ($produto->unidade = 'UN') ? ($nf->quantidade ?? 1) : 1;
                if (($it->itensCabec->nIdProduto == $nIdProduto && $nIdProduto !== '') || $nIdProduto == '') {
                    // for ($i = 1; $i <= $qtde; $i++) {
                        if ($produto->unidade == 'UN') {
                            $quantidade = number_format($qtde, 0, '', '') . '(' . ($produto->unidade ?? '') . ')';
                        } else {
                            $quantidade = number_format($it->itensAjustes->nQtdeRecebida, 3, ',' . '.') . ' (' . ($produto->unidade ?? '') . ')';
                        }

                        $etiquetas[] = [
                            'codigo_produto' => $produto->codigo ?? '',
                            'descricao' => $it->itensCabec->cDescricaoProduto ?? '',
                            'lote' => "",
                            'quantidade' => '',
                            'qtde_nf' => $it->itensAjustes->nQtdeRecebida . '(' . ($produto->unidade ?? '') . ')',
                            'qtde_etiqueta' => $quantidade,
                            'validade' => $it->itensCabec->nIdValidade ?? '',
                            'inclusao' => $it->infoCadastro->dRec ?? '15/05/2025',
                            'produzido' => '',
                            'fornecedor' => $recebimento->cabec->cNome ?? '',
                            'nfe' => intval($recebimento->cabec->cNumeroNFe),
                        ];
                    // }
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

        if (config('app.env') === 'local') {
            return $pdf->inline("etiquetas_nfe_{$recebimento->cabec->cNumeroNFe}.pdf");
        }
        return $pdf->download("etiquetas_nfe_{$recebimento->cabec->cNumeroNFe}.pdf");
    }
}
