<?php

namespace App\Http\Controllers\Inventario;

use App\Http\Controllers\Controller;
use App\Jobs\InventarioJob;
use App\Models\Inventario;
use App\Models\InventarioItem;
use App\Models\LocalEstoque;
use App\Models\PosicaoEstoque;
use App\Models\Produto;
use App\Services\CanService;
use App\Services\IntegrationAttemptsTrait;
use App\Services\PosicaoEstoqueService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use PDF;

class InventarioController extends Controller
{
    use IntegrationAttemptsTrait;

    public function __construct()
    {
        $this->middleware('auth');
    }

    public function index(Request $request)
    {
        // Lógica para exibir a lista de inventários
        if (! CanService::canPermissionLoja('Inventários - Ver', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Inventários - Ver!');
        }

        $data_inicio = Carbon::parse($request->has('data_inicio') ? $request->get('data_inicio') : session('inicio', Carbon::now()->subDays(30)));
        $data_final = Carbon::parse($request->has('data_final') ? $request->get('data_final') : session('final', Carbon::now()));
        $tipo = $request->get('tipo', null);
        session([
            'inicio' => $data_inicio->format('Y-m-d'),
            'final' => $data_final->format('Y-m-d'),
            'tipo' => $tipo,
            'familia' => $request->get('familia', null),
        ]);

        $inventarios = Inventario::where('loja_id', auth()->user()->current_loja_id)
            ->whereBetween('data', [Carbon::parse($data_inicio)->startOfDay(), Carbon::parse($data_final)->endOfDay()])
            ->when($request->get('familia'), function ($familia) use ($request) {
                $familia->whereHas('items', function ($items) use ($request) {
                    $items->where('inventario_items.produto_familia', $request->get('familia'));
                });
            })
            ->when($request->get('tipo'), function ($q) use ($request) {
                $q->whereHas('items', function ($items) use ($request) {
                    $items->whereHas('produto', function ($produto) use ($request) {
                        $produto->where('tipo_item', $request->get('tipo'));
                    });
                });
            })
            ->orderBy('id', 'desc')
            ->paginate(20)
            ->withQueryString();

        $locaisEstoque = LocalEstoque::where('loja_id', auth()->user()->current_loja_id)->orderBy('descricao', 'asc')->get();

        return view('inventario.index', compact('data_inicio', 'data_final', 'inventarios', 'locaisEstoque', 'tipo'));
    }

    public function store(Request $request)
    {
        if (! CanService::canPermissionLoja('Inventários - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Inventários - Criar!');
        }

        $emContagem = Inventario::where('status', 'Em contagem')
            ->where('codigo_local_estoque', $request->input('estoque_origem'))
            ->where('loja_id', auth()->user()->current_loja_id)
            ->first();

        if ($emContagem) {
            return redirect()->route('inventario.index')->with('info', "Inventário nº $emContagem->id ainda em contagem, finalize-o antes de iniciar um novo inventario!");
        }

        $request->validate([
            'estoque_origem' => 'required|integer',
            'data' => 'required|date',
            'motivo' => 'required|in:INV,INI',
        ]);

        $inventario = Inventario::create([
            'loja_id' => auth()->user()->current_loja_id,
            'codigo_local_estoque' => $request->input('estoque_origem'),
            'data' => Carbon::parse($request->input('data')),
            'tipo' => 'SLD',
            'origem' => 'AJU',
            'motivo' => $request->input('motivo'),
            'status' => 'Em contagem',
        ]);

        return redirect()->route('inventario.contagem', $inventario->id);
    }

    public function storeItem(Request $request, Inventario $inventario)
    {
        if (! CanService::canPermissionLoja('Inventários - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Inventários - Criar!');
        }

        $request->validate([
            'codigo' => 'required|string|max:60',
            'quantidade' => 'required|numeric',
        ]);

        $produto = Produto::where('loja_id', $inventario->loja_id)
            ->where('full_object', '!=', null)
            ->where(function ($query) {
                $query->where('full_object', 'like', '%"inativo":"N"%')
                    ->orWhereNull('full_object');
            })
            ->where('codigo', $request->get('codigo'))
            ->first();

        if (! $produto || json_decode($produto->full_object)->inativo === 'S') {
            return response(['mensagem' => 'Produto não encontrado ou INATIVO, não foi possível inserir o item!'], 400);
        }

        $posicaoEstoque = PosicaoEstoque::where('loja_id', $inventario->loja_id)
            ->where('codigo_local_estoque', $inventario->codigo_local_estoque)
            ->where('n_cod_prod', $produto->codigo_produto)
            ->where('data_posicao', $inventario->data->format('Y-m-d'))
            ->first();

        if (! $posicaoEstoque || ($posicaoEstoque->n_cmc === 0) || ($posicaoEstoque->n_cmc === null)) {
            $posicaoService = new PosicaoEstoqueService($inventario->loja);
            $posicaoProd = $posicaoService->fetchPosicaoProduto($inventario->codigo_local_estoque, $produto->codigo_produto, $inventario->data->format('d/m/Y'));
            $posicaoService->savePosicao($posicaoProd, $inventario->data->format('d/m/Y'));
            $posicaoEstoque = PosicaoEstoque::where('loja_id', $inventario->loja_id)
                ->where('codigo_local_estoque', $inventario->codigo_local_estoque)
                ->where('n_cod_prod', $produto->codigo_produto)
                ->where('data_posicao', $inventario->data->format('Y-m-d'))
                ->first();
        }

        try {

            $item = $inventario->items()->create([
                'loja_id' => $inventario->loja_id,
                'produto_codigo_produto' => $produto->codigo_produto,
                'produto_codigo' => $produto->codigo ?? '',
                'produto_descricao' => $produto->descricao ?? '',
                'produto_familia' => $produto->descricao_familia ?? '',
                'quan' => $request->get('quantidade'),
                'valor' => ($posicaoEstoque?->n_cmc > 0) ? $posicaoEstoque->n_cmc : 0,
                'status' => ($posicaoEstoque?->n_cmc > 0) ? null : 'Sem CMC',
            ]);

            return response([
                'key' => $item->id,
                'id' => $produto->codigo,
                'nome' => $produto->descricao,
                'unidade' => $produto->unidade,
            ], 201);
        } catch (\Exception $e) {
            return response(['mensagem' => "Não foi possível inserir o item, erro: {$e->getMessage()}"], 500);
        }
    }

    public function pdf(Request $request, Inventario $inventario)
    {
        if (! CanService::canPermissionLoja('Inventários - Ver', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Inventários - Ver!');
        }
        $pdf = PDF::loadView('inventario.pdf', ['inventario' => $inventario, 'loja' => auth()->user()->loja, 'params' => $request->all()]);

        return $pdf->inline("inventario-{$inventario->id}.pdf");
    }

    public function finish(Request $request, Inventario $inventario)
    {
        if (! CanService::canPermissionLoja('Inventários - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Inventários - Criar!');
        }

        $inventario->status = 'Processando no Omie';
        $inventario->save();

        InventarioJob::dispatch($inventario, auth()->user())->delay(10);

        return redirect()
            ->route('inventario.index', [
                'data_inicio' => $inventario->data->format('Y-m-d'),
                'data_final' => $inventario->data->format('Y-m-d')]
            )->with('success', 'Inventário processando no Omie, só aguardar a finalização do processamento. :)');
    }

    public function contagem(Inventario $inventario)
    {
        if (! CanService::canPermissionLoja('Inventários - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Inventários - Criar!');
        }

        $localEstoque = LocalEstoque::where('loja_id', auth()->user()->current_loja_id)
            ->where('codigo_local_estoque', $inventario->codigo_local_estoque)
            ->first();

        return view('inventario.contagem', compact('inventario', 'localEstoque'));
    }

    public function setQuantidade(InventarioItem $inventarioItem, Request $request)
    {
        if (! CanService::canPermissionLoja('Inventários - Criar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Inventários - Criar!');
        }

        $request->validate([
            'quantidade' => 'required|numeric|min:0',
        ]);

        $inventarioItem->update(['quan' => $request->input('quantidade')]);

        $response = $this->createAjuste($inventarioItem);
        if ($response) {
            $inventarioItem->response = json_encode($response);
            $inventarioItem->codigo_status = $response->codigo_status;
            $inventarioItem->descricao_status = $response->descricao_status;
            $inventarioItem->id_movest = $response->id_movest;
            $inventarioItem->id_ajuste = $response->id_ajuste;
            $inventarioItem->status = 'Concluído';
        }
        $inventarioItem->save();

        return response()->json(['success' => true]);
    }

    public function editQuantidade(InventarioItem $inventarioItem, Request $request)
    {
        if (! CanService::canPermissionLoja('Inventários - Editar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Inventários - Editar!');
        }

        $request->validate([
            'quantidade' => 'required|numeric|min:0',
        ]);

        if ($inventarioItem->id_ajuste !== null) {
            $loja = $inventarioItem->inventario->loja;
            $url = 'https://app.omie.com.br/api/v1/estoque/ajuste/';
            $data = [
                'call' => 'ExcluirAjusteEstoque',
                'app_key' => $loja->omie_app_key,
                'app_secret' => $loja->omie_app_secret,
                'param' => [
                    [
                        'id_ajuste' => $inventarioItem->id_ajuste,
                    ],
                ],
            ];
            Http::withHeaders([
                'Content-Type' => 'application/json',
            ])->connectTimeout(60)->timeout(60)->post($url, $data);
        }

        $inventarioItem->update([
            'response' => null,
            'codigo_status' => null,
            'descricao_status' => null,
            'id_movest' => null,
            'id_ajuste' => null,
            'status' => null,
            'quan' => $request->input('quantidade'),
        ]);

        $response = $this->createAjuste($inventarioItem);

        if ($response) {
            $inventarioItem->response = json_encode($response);
            $inventarioItem->codigo_status = $response->codigo_status;
            $inventarioItem->descricao_status = $response->descricao_status;
            $inventarioItem->id_movest = $response->id_movest;
            $inventarioItem->id_ajuste = $response->id_ajuste;
            $inventarioItem->status = 'Concluído';
            $inventarioItem->save();
        }

        return response()->json(['success' => true]);
    }

    public function duplicar(Request $request, Inventario $inventario)
    {
        $clone = $inventario->replicate();
        $clone->data = $request->get('data');
        $clone->finalizado = null;
        $clone->status = 'Em contagem';
        $clone->save();

        foreach ($inventario->items as $item) {
            $clonedItem = $item->replicate();
            $clonedItem->inventario_id = $clone->id;
            $clonedItem->quan = null;
            $clonedItem->valor = null;
            $clonedItem->response = null;
            $clonedItem->codigo_status = null;
            $clonedItem->descricao_status = null;
            $clonedItem->id_movest = null;
            $clonedItem->id_ajuste = null;
            $clonedItem->status = null;
            $clonedItem->save();
        }

        return redirect()->route('inventario.contagem', $clonedItem->inventario)
            ->with('success', 'Inventario duplicado com sucesso!');
    }

    public function destroy(Inventario $inventario)
    {
        if (! CanService::canPermissionLoja('Inventários - Excluir', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Inventários - Excluir!');
        }

        foreach ($inventario->items as $inventarioItem) {
            if ($inventarioItem->id_ajuste !== null) {
                $loja = $inventario->loja;
                $url = 'https://app.omie.com.br/api/v1/estoque/ajuste/';
                $data = [
                    'call' => 'ExcluirAjusteEstoque',
                    'app_key' => $loja->omie_app_key,
                    'app_secret' => $loja->omie_app_secret,
                    'param' => [
                        [
                            'id_ajuste' => $inventarioItem->id_ajuste,
                        ],
                    ],
                ];
                Http::withHeaders([
                    'Content-Type' => 'application/json',
                ])->connectTimeout(60)
                    ->timeout(60)
                    ->post($url, $data);
            }
            $inventarioItem->delete();
        }
        $inventario->delete();

        return redirect()->route('inventario.index', ['data_inicio' => $inventario->data->format('Y-m-d'), 'data_final' => $inventario->data->format('Y-m-d')])->with('success', 'Inventário cancelado com sucesso!');
    }

    public function destroyItem(InventarioItem $inventarioItem)
    {
        if (! CanService::canPermissionLoja('Inventários - Editar', auth()->user()->current_loja_id) && auth()->user()->perfil !== 'Admin') {
            abort(403, 'Você não possui a permissão: Inventários - Editar!');
        }

        if ($inventarioItem->id_ajuste !== null) {
            $loja = $inventarioItem->inventario->loja;
            $url = 'https://app.omie.com.br/api/v1/estoque/ajuste/';
            $data = [
                'call' => 'ExcluirAjusteEstoque',
                'app_key' => $loja->omie_app_key,
                'app_secret' => $loja->omie_app_secret,
                'param' => [
                    [
                        'id_ajuste' => $inventarioItem->id_ajuste,
                    ],
                ],
            ];
            Http::withHeaders([
                'Content-Type' => 'application/json',
            ])->connectTimeout(60)
                ->timeout(60)
                ->post($url, $data);
        }
        $inventarioItem->delete();

        return redirect()->back()->with('success', 'Item excluído com sucesso!');
    }

    private function createAjuste(InventarioItem $inventarioItem): ?object
    {
        if (($inventarioItem->quan >= 0)
            && (in_array(! $inventarioItem->status, [null, 'Erro', 'Sem CMC']))
            && ($inventarioItem->id_ajuste === null)
            && $inventarioItem->valor > 0
        ) {
            $inventarioItem->status = 'Iniciado';
            $inventarioItem->save();
            $loja = $inventarioItem->inventario->loja;
            $url = 'https://app.omie.com.br/api/v1/estoque/ajuste/';
            $data = [
                'call' => 'IncluirAjusteEstoque',
                'app_key' => $loja->omie_app_key,
                'app_secret' => $loja->omie_app_secret,
                'param' => [
                    [
                        'codigo_local_estoque' => $inventarioItem->inventario->codigo_local_estoque,
                        'id_prod' => $inventarioItem->produto_codigo_produto,
                        'cod_int_ajuste' => 'ITEM'.$inventarioItem->id,
                        'data' => $inventarioItem->inventario->data->format('d/m/Y'),
                        'quan' => $inventarioItem->quan,
                        'valor' => $inventarioItem->valor,
                        'obs' => 'NTB - Estoque|Usuário:'.auth()->user()->name,
                        'origem' => $inventarioItem->inventario->origem,
                        'tipo' => $inventarioItem->inventario->tipo,
                        'motivo' => $inventarioItem->inventario->motivo,
                    ],
                ],
            ];

            // Inicializando Log de integração
            $this->loja_id = $loja->id;
            $this->model = 'InventarioItem';
            $this->request = json_encode(['method' => 'POST', 'path' => $url, 'payload' => $data]);
            $this->beforeAttemptLog();

            try {
                try {
                    $response = Http::withHeaders([
                        'Content-Type' => 'application/json',
                    ])->connectTimeout(60)->timeout(60)->post($url, $data);

                    // Log de integração
                    $this->response = $response->getBody()->getContents();
                    $this->code = $response->getStatusCode();

                    if ($response->status() === 200) {
                        return $response->object();
                    } elseif ($response->status() === 429) {
                        $inventarioItem->status = 'Erro';
                        $inventarioItem->response = $response->body();
                        $inventarioItem->descricao_status = 'Rate limit atingido, aguarde 60 segundos e tente novamente!';
                        $inventarioItem->save();
                    } elseif ($response->status() === 425) {
                        $inventarioItem->status = 'Erro';
                        $inventarioItem->response = $response->body();
                        $inventarioItem->descricao_status = 'Rate limit atingido, aguarde 60 segundos e tente novamente!';
                        $inventarioItem->save();
                        preg_match('/Tente novamente em \[(\d+)\]/', $response->object()->faultstring, $matches);
                        $idAjuste = isset($matches[1]) ? $matches[1] : '';
                    } elseif ($response->status() === 500 && stripos($response->object()->faultcode, 'SOAP-ENV:Client-1035') !== false) {
                        preg_match('/com o ID \[(\d+)\]/', $response->object()->faultstring, $matches);
                        $idAjuste = isset($matches[1]) ? $matches[1] : '';
                        $obj = new stdClass;
                        $obj->codigo_status = '0';
                        $obj->descricao_status = 'Ajuste realizado';
                        $obj->id_movest = '';
                        $obj->id_ajuste = $idAjuste;

                        return $obj;
                    } else {
                        $inventarioItem->status = 'Erro';
                        $inventarioItem->response = $response->body();
                        $inventarioItem->descricao_status = $response->body();
                        $inventarioItem->save();
                    }
                } catch (Throwable $th) {

                    $inventarioItem->status = 'Erro';
                    $inventarioItem->response = $response->body();
                    $inventarioItem->descricao_status = $response->body();
                    $inventarioItem->save();

                    $this->error_message = json_encode($th->getMessage());
                    $this->code = $th->getCode();
                    $this->error = true;
                    Log::critical($th->getMessage(), [
                        'Code' => $th->getCode(),
                        'File' => $th->getFile(),
                        'Line' => $th->getLine(),
                    ]);
                }
            } finally {
                $this->afterAttemptLog();
            }
        } elseif ($inventarioItem->valor <= 0 || $inventarioItem->valor === null) {
            $inventarioItem->valor = 0;
            $inventarioItem->status = 'Sem CMC';
            $inventarioItem->save();
        }

        return null;
    }
}
