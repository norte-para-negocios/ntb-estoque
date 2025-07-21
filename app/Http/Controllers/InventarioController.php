<?php

namespace App\Http\Controllers;

use App\Jobs\InventarioAjustesJob;
use App\Jobs\InventarioItensJob;
use App\Models\Inventario;
use App\Models\InventarioItem;
use App\Models\Movimento;
use App\Models\Produto;
use App\Services\CanService;
use App\Services\OmieService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;

class InventarioController extends Controller
{
    private $omie;

    public function __construct()
    {
        $this->middleware('auth');
        $this->omie = new OmieService();
    }

    public function index(Request $request)
    {
        // Lógica para exibir a lista de inventários
        if (!CanService::canPermissionLoja('Inventário', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Inventário!");
        }

        $data_inicio = $request->filled('data_inicio') ? Carbon::parse($request->get('data_inicio'))->format('Y-m-d') : Carbon::now()->format('Y-m-d');
        $data_final = $request->filled('data_final') ? Carbon::parse($request->get('data_final'))->format('Y-m-d') : Carbon::now()->format('Y-m-d');

        session([
            'data_inicio' => $data_inicio,
            'data_final' => $data_final,
        ]);

        $inventarios = Inventario::where('loja_id', Auth::user()->current_loja_id)
            ->whereBetween('data', [Carbon::parse($data_inicio)->startOfDay(), Carbon::parse($data_final)->endOfDay()])
            ->orderBy('id', 'desc')
            ->paginate(20)
            ->withQueryString();

        $locaisEstoque = $this->omie->getLocaisEstoque();

        return view('inventario.index', compact('data_inicio', 'data_final', 'inventarios', 'locaisEstoque'));
    }

    public function store(Request $request)
    {
        // Lógica para armazenar um novo inventário e redirecionar para tela de contagem
        if (!CanService::canPermissionLoja('Inventário', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Inventário!");
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
        ]);

        $produtos = Produto::where('loja_id', Auth::user()->current_loja_id)
            ->orderBy('descricao_familia', 'asc')
            ->orderBy('descricao', 'asc')
            ->get();

        foreach ($produtos as $produto) {
            $inventario->items()->create([
                'loja_id' => Auth::user()->current_loja_id,
                'produto_codigo_produto' => $produto->codigo_produto,
                'produto_codigo' => $produto->codigo ?? '',
                'produto_descricao' => $produto->descricao ?? '',
                'produto_familia' => $produto->descricao_familia ?? '',
                'quan' => null,
                'valor' => null,
            ]);
        }
        dispatch(new InventarioItensJob($inventario));

        $localEstoque = $this->omie->getLocalEstoque($request->input('estoque_origem'));

        return view('inventario.contagem', compact('inventario', 'localEstoque'));
    }

    public function finish(Inventario $inventario)
    {
        foreach ($inventario->items()->whereNotNull('inventario_items.quan')->get() as $inventarioItem) {
            dispatch(new InventarioAjustesJob($inventarioItem));
        }
        $inventario->finalizado = Carbon::now();
        $inventario->save();
        return redirect()->route('inventario.index', ['data_inicio' => $inventario->data->format('Y-m-d'), 'data_final' => $inventario->data->format('Y-m-d')]);
    }

    public function contagem(Inventario $inventario)
    {
        $localEstoque = $this->omie->getLocalEstoque($inventario->codigo_local_estoque);
        return view('inventario.contagem', compact('inventario', 'localEstoque'));
    }

    public function setQuantidade(InventarioItem $inventarioItem, Request $request)
    {
        // Lógica para atualizar a quantidade de um item no inventário
        if (!CanService::canPermissionLoja('Inventário', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Inventário!");
        }

        $request->validate([
            'quantidade' => 'required|numeric|min:0.001',
        ]);

        $inventarioItem->update(['quan' => $request->input('quantidade')]);

        return response()->json(['success' => true]);
    }

    public function destroy(Inventario $inventario)
    {
        if (!CanService::canPermissionLoja('Transferência', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Transferência!");
        }

        // Verifica se o movimento já foi processado
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
