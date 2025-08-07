@extends('layouts.app')

@section('content')
    <div class="container">

        <h2 class="mb-3">{{ __('Notas fiscais - Itens') }}: <small>{{ auth()->user()->loja->nome_fantasia }}</small></h2>

        <div class="card card-body">
            <h5>{{ __($recebimento->cabec->cNome ?? '') }}</h5>
            <h6>N° NFe.: {{ $recebimento->cabec->cNumeroNFe ?? '' }} | Emissão: {{ $recebimento->cabec->dEmissaoNFe ?? '' }}
            </h6>
            <a href="{{ route('notafiscal.imprimir', $recebimento->cabec->nIdReceb, [], false) }}"
                class="btn btn-secondary btn-sm text-start">
                <i class="fa-solid fa-print me-2"></i> Imprimir Tudo
            </a>
        </div>

        <div class="card card-body mt-4">
            <table class="table table-hover table-borderless">
                <tbody>
                    @if (isset($recebimento) && !empty($recebimento))
                        @foreach ($recebimento->itensRecebimento as $it)
                            @php
                                $produto = '';
                                if ($it->itensCabec->nIdProduto > 0) {
                                    $produto = \App\Models\Produto::where(
                                        'codigo_produto',
                                        $it->itensCabec->nIdProduto,
                                    )->first();
                                }
                            @endphp
                            <tr>
                                <td class="px-2">
                                    <div class="container">
                                        <div class="row">
                                            <div class="col-12 p-0">
                                                <div class="card card-body m-0" style="background-color: #e4e9f5;">
                                                    <h6>
                                                        <small>Produto:</small> {{ $produto->codigo ?? '' }} -
                                                        {{ $it->itensCabec->cDescricaoProduto }}
                                                        {{ $produto->tipoItem ?? '' }}
                                                    </h6>
                                                    @if ($it->itensCabec->nIdProduto > 0)
                                                        <div class="mb-3">
                                                            <label for="quantidade"
                                                                class="form-label mb-0">Quantidade ({{ $produto->unidade ?? "-" }}):</label>
                                                            <input type="number" class="form-control" id="quantidade"
                                                                name="quantidade"
                                                                value="{{ \App\Models\Nf::where('n_id_receb', $recebimento->cabec->nIdReceb)->where('produto_codigo', $it->itensCabec->nIdProduto)->first()->quantidade ?? 1 }}"
                                                                onblur="setQuantidade(this,'{{ route('notafiscal.setQuantidade', [$recebimento->cabec->nIdReceb, $it->itensCabec->nIdProduto]) }}')">
                                                        </div>
                                                        <p class="my-1">
                                                            <a href="{{ route('notafiscal.imprimir', [$recebimento->cabec->nIdReceb, $it->itensCabec->nIdProduto]) }}"
                                                                class="btn btn-secondary btn-sm">
                                                                <i class="fa-solid fa-print me-2"></i> Imprimir
                                                            </a>
                                                        </p>
                                                    @else
                                                        <p class="text-danger">Produto não está cadastrado no estoque</p>
                                                    @endif
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        @endforeach
                    @else
                        <tr>
                            <td class="text-center">Nenhum item encontrado</td>
                        </tr>
                    @endif
                </tbody>
            </table>
        </div>
    </div>

    <script>
        function setQuantidade(el, url) {
            axios.post(url, {
                "quantidade": el.value
            })
        }
    </script>
@endsection
