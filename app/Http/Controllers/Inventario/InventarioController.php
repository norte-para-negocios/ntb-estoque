<?php

namespace App\Http\Controllers\Inventario;

use App\Http\Controllers\Controller;
use App\Jobs\InventarioJob;
use App\Models\Inventario;
use App\Models\InventarioItem;
use App\Models\LocalEstoque;
use App\Models\Loja;
use App\Models\PosicaoEstoque;
use App\Models\Produto;
use App\Services\CanService;
use App\Services\PosicaoEstoqueService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use PDF;

class InventarioController extends Controller
{
    public function __construct()
    {
        $this->middleware('auth');
    }

    public function index(Request $request)
    {
        // Lógica para exibir a lista de inventários
        if (!CanService::canPermissionLoja('Inventários - Ver', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Inventários - Ver!");
        }

        $data_inicio = Carbon::parse($request->has('data_inicio') ? $request->get('data_inicio') : session('inicio'));
        $data_final = Carbon::parse($request->has('data_final') ? $request->get('data_final') : session('final'));
        session(['inicio' => $data_inicio->format('Y-m-d'), 'final' => $data_final->format('Y-m-d')]);

        $inventarios = Inventario::where('loja_id', Auth::user()->current_loja_id)
            ->whereBetween('data', [Carbon::parse($data_inicio)->startOfDay(), Carbon::parse($data_final)->endOfDay()])
            ->orderBy('id', 'desc')
            ->paginate(20)
            ->withQueryString();

        $locaisEstoque = LocalEstoque::where('loja_id', Auth::user()->current_loja_id)->orderBy('descricao', 'asc')->get();

        return view('inventario.index', compact('data_inicio', 'data_final', 'inventarios', 'locaisEstoque'));
    }

    public function store(Request $request)
    {
        if (!CanService::canPermissionLoja('Inventários - Criar', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Inventários - Criar!");
        }

        $request->validate([
            'estoque_origem' => 'required|integer',
            'data' => 'required|date',
            'motivo' => 'required|in:INV,INI',
        ]);

        $inventario = Inventario::create([
            'loja_id' => Auth::user()->current_loja_id,
            'codigo_local_estoque' => $request->input('estoque_origem'),
            'data' => Carbon::parse($request->input('data')),
            'tipo' => 'SLD',
            'origem' => 'AJU',
            'motivo' => $request->input('motivo'),
            'status' => 'Em contagem',
        ]);

        $produtos = Produto::where('loja_id', Auth::user()->current_loja_id)
            ->where('full_object->inativo', "N")
            ->orderBy('descricao_familia', 'asc')
            ->orderBy('descricao', 'asc')
            ->get();

        foreach ($produtos as $produto) {

            $posicaoEstoque = PosicaoEstoque::where('loja_id', $inventario->loja_id)
                ->where('codigo_local_estoque', $inventario->codigo_local_estoque)
                ->where('n_cod_prod', $produto->codigo_produto)
                ->where('data_posicao', $inventario->data->format('Y-m-d'))
                ->first();

            $inventario->items()->create([
                'loja_id' => Auth::user()->current_loja_id,
                'produto_codigo_produto' => $produto->codigo_produto,
                'produto_codigo' => $produto->codigo ?? '',
                'produto_descricao' => $produto->descricao ?? '',
                'produto_familia' => $produto->descricao_familia ?? '',
                'quan' => null,
                'valor' => $posicaoEstoque->n_cmc ?? -1,
            ]);

        }

        return redirect()->route('inventario.contagem', $inventario->id);
    }

    public function pdf(Request $request, Inventario $inventario)
    {
        if (!CanService::canPermissionLoja('Inventários - Ver', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Inventários - Ver!");
        }
        $pdf = PDF::loadView('inventario.pdf', ['inventario' => $inventario, 'loja' => Auth::user()->loja, 'params' => $request->all()]);
        return $pdf->inline("inventario-{$inventario->id}.pdf");
    }

    public function finish(Inventario $inventario)
    {
        if (!CanService::canPermissionLoja('Inventários - Criar', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Inventários - Criar!");
        }
        (new PosicaoEstoqueService(Loja::find($inventario->loja_id)))->fetchAll($inventario->codigo_local_estoque, $inventario->data->format('d/m/Y'));
        $inventario->status = 'Processando no Omie';
        $inventario->save();
        InventarioJob::dispatch($inventario, auth()->user());
        return redirect()
            ->route('inventario.index', [
                    'data_inicio' => $inventario->data->format('Y-m-d'),
                    'data_final' => $inventario->data->format('Y-m-d')]
            )->with('success', 'Inventário processando no Omie, só aguardar a finalização do processamento. :)');
    }

    public function contagem(Inventario $inventario)
    {
        if (!CanService::canPermissionLoja('Inventários - Criar', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Inventários - Criar!");
        }

        $localEstoque = LocalEstoque::where('loja_id', Auth::user()->current_loja_id)
            ->where('codigo_local_estoque', $inventario->codigo_local_estoque)
            ->first();

        return view('inventario.contagem', compact('inventario', 'localEstoque'));
    }

    public function setQuantidade(InventarioItem $inventarioItem, Request $request)
    {
        if (!CanService::canPermissionLoja('Inventários - Criar', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Inventários - Criar!");
        }

        $request->validate([
            'quantidade' => 'required|numeric|min:0',
        ]);

        $inventarioItem->update(['quan' => $request->input('quantidade')]);

        return response()->json(['success' => true]);
    }

    public function editQuantidade(InventarioItem $inventarioItem, Request $request)
    {
        if (!CanService::canPermissionLoja('Inventários - Editar', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Inventários - Editar!");
        }

        $request->validate([
            'quantidade' => 'required|numeric|min:0',
        ]);

        if ($inventarioItem->id_ajuste !== null) {
            $loja = $inventarioItem->inventario->loja;
            $url = 'https://app.omie.com.br/api/v1/estoque/ajuste/';
            $data = [
                "call" => "ExcluirAjusteEstoque",
                "app_key" => $loja->omie_app_key,
                "app_secret" => $loja->omie_app_secret,
                "param" => [
                    [
                        "id_ajuste" => $inventarioItem->id_ajuste,
                    ]
                ]
            ];
            Http::withHeaders([
                'Content-Type' => 'application/json'
            ])->connectTimeout(60)->timeout(60)->post($url, $data);
        }

        $inventarioItem->update([
            'response' => null,
            'codigo_status' => null,
            'descricao_status' => null,
            'id_movest' => null,
            'id_ajuste' => null,
            'status' => null,
            'quan' => $request->input('quantidade')
        ]);

        InventarioJob::dispatch($inventarioItem->inventario, auth()->user());

        return response()->json(['success' => true]);
    }

    public function reprocessa(Inventario $inventario)
    {
        if (!CanService::canPermissionLoja('Inventários - Editar', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Inventários - Editar!");
        }

        foreach ($inventario->items as $item) {
            if ($item->id_ajuste !== null) {
                $loja = $inventario->loja;
                $url = 'https://app.omie.com.br/api/v1/estoque/ajuste/';
                $data = [
                    "call" => "ExcluirAjusteEstoque",
                    "app_key" => $loja->omie_app_key,
                    "app_secret" => $loja->omie_app_secret,
                    "param" => [
                        [
                            "id_ajuste" => $item->id_ajuste,
                        ]
                    ]
                ];
                Http::withHeaders([
                    'Content-Type' => 'application/json'
                ])->connectTimeout(60)->timeout(60)->post($url, $data);
            }

            $item->update([
                'response' => null,
                'codigo_status' => null,
                'descricao_status' => null,
                'id_movest' => null,
                'id_ajuste' => null,
                'status' => null,
                'valor' => null
            ]);
        }

        InventarioJob::dispatch($inventario, auth()->user());

        return response()->json(['success' => true]);
    }

    public function destroy(Inventario $inventario)
    {
        if (!CanService::canPermissionLoja('Inventários - Excluir', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Inventários - Excluir!");
        }

        foreach ($inventario->items as $inventarioItem) {
            if ($inventarioItem->id_ajuste !== null) {
                $loja = $inventario->loja;
                $url = 'https://app.omie.com.br/api/v1/estoque/ajuste/';
                $data = [
                    "call" => "ExcluirAjusteEstoque",
                    "app_key" => $loja->omie_app_key,
                    "app_secret" => $loja->omie_app_secret,
                    "param" => [
                        [
                            "id_ajuste" => $inventarioItem->id_ajuste,
                        ]
                    ]
                ];
                Http::withHeaders([
                    'Content-Type' => 'application/json'
                ])->connectTimeout(60)->timeout(60)->post($url, $data);
            }
            $inventarioItem->delete();
        }
        $inventario->delete();
        return redirect()->route('inventario.index', ['data_inicio' => $inventario->data->format('Y-m-d'), 'data_final' => $inventario->data->format('Y-m-d')])->with('success', 'Inventário cancelado com sucesso!');
    }
}
